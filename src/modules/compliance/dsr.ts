import 'server-only';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, readAcrossTenants } from '@/db';
import {
  applications,
  consentRecords,
  dataSubjectRequests,
  documents,
  enrollments,
  grades,
  institutions,
  submissions,
  transactions,
  users,
} from '@/db/schema';

export type DsrKind = (typeof dataSubjectRequests.$inferSelect)['kind'];
export type Dsr = typeof dataSubjectRequests.$inferSelect;

/** §6.6: 30 days, with escalating alerts at day 20 and day 27. */
export const SLA_DAYS = 30;

export function slaFor(request: Pick<Dsr, 'receivedAt' | 'dueAt'>) {
  const msLeft = request.dueAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  const elapsed = SLA_DAYS - daysLeft;

  // The brief's escalation points, expressed as elapsed days rather than as
  // arbitrary colour thresholds, so the rule stays legible against §6.6.
  const level: 'ok' | 'day20' | 'day27' | 'overdue' =
    daysLeft <= 0 ? 'overdue' : elapsed >= 27 ? 'day27' : elapsed >= 20 ? 'day20' : 'ok';

  return { daysLeft, elapsed, level };
}

export function slaClass(level: ReturnType<typeof slaFor>['level']) {
  return level === 'overdue' || level === 'day27'
    ? 'text-danger'
    : level === 'day20'
      ? 'text-warning'
      : 'text-ink-700';
}

/**
 * §6.6, the rule that must not be implemented as a silent no-op:
 *
 *   "Erasure cannot override statutory/academic retention. The product must be
 *    able to explain the refusal clearly and record it, not silently ignore
 *    the request."
 *
 * So this returns the *reason* rather than a boolean. Whatever it says is what
 * the data subject is told and what goes on the record.
 */
export async function erasureConflicts(subjectEmail: string, userId: string | null) {
  if (!userId) return [];

  const conflicts: { holder: string; basis: string; detail: string }[] = [];

  const enrolled = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ matricNumber: enrollments.matricNumber, institution: institutions.name })
      .from(enrollments)
      .innerJoin(institutions, eq(institutions.id, enrollments.institutionId))
      .where(eq(enrollments.userId, userId)),
  );

  for (const e of enrolled) {
    conflicts.push({
      holder: e.institution,
      basis: 'Academic record — retained long-term under NUC and institutional policy',
      detail: `Enrolment ${e.matricNumber}. The award and the record of it cannot be erased on request; this is the legitimate exception to erasure in §6.8.`,
    });
  }

  const paid = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.status, 'success'))),
  );

  if (Number(paid[0]?.n ?? 0) > 0) {
    conflicts.push({
      holder: 'Platform',
      basis: 'Financial records — Nigerian tax and financial record requirements',
      detail: `${paid[0].n} settled payment(s). Retained and access-restricted; the amount and reference stay, the card details were never held.`,
    });
  }

  return conflicts;
}

/**
 * CMP-07 / ST-16. Everything held about one person, in one object.
 *
 * Deliberately assembled from the same tables the rest of the product writes
 * to, rather than from a hand-maintained list — a portability export that
 * drifts from reality is worse than none, because it looks authoritative.
 */
export async function assembleSubjectData(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const consents = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId));

  const apps = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ application: applications, institution: institutions.name })
      .from(applications)
      .innerJoin(institutions, eq(institutions.id, applications.institutionId))
      .where(eq(applications.userId, userId)),
  );

  const docs = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({
        kind: documents.kind,
        filename: documents.filename,
        sizeBytes: documents.sizeBytes,
        uploadedAt: documents.createdAt,
        purgeAfter: documents.purgeAfter,
        purgedAt: documents.purgedAt,
      })
      .from(documents)
      .innerJoin(applications, eq(applications.id, documents.applicationId))
      .where(eq(applications.userId, userId)),
  );

  const enrols = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ enrollment: enrollments, institution: institutions.name })
      .from(enrollments)
      .innerJoin(institutions, eq(institutions.id, enrollments.institutionId))
      .where(eq(enrollments.userId, userId)),
  );

  const payments = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({
        reference: transactions.reference,
        context: transactions.context,
        amountKobo: transactions.amountKobo,
        status: transactions.status,
        paidAt: transactions.paidAt,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId)),
  );

  const results = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({
        score: grades.score,
        maxScore: grades.maxScore,
        feedback: grades.feedback,
        gradedAt: grades.gradedAt,
      })
      .from(grades)
      .innerJoin(submissions, eq(submissions.id, grades.submissionId))
      .where(eq(submissions.userId, userId)),
  );

  return {
    exportedAt: new Date().toISOString(),
    aboutThisExport: [
      'Everything this platform holds about you, in the format it is stored in.',
      'Uploaded files are listed but not included — download them from your application.',
      'Your password is not included: it is stored only as an Argon2id hash and cannot be read back.',
    ],
    account: {
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      twoFactorEnrolled: Boolean(user.totpConfirmedAt),
    },
    consents: consents.map((c) => ({
      purpose: c.purpose,
      granted: c.granted,
      recordedAt: c.recordedAt,
      privacyNoticeVersion: c.noticeVersion,
      wordingShown: c.purposeTextShown,
    })),
    applications: apps.map(({ application, institution }) => ({
      institution,
      reference: application.reference,
      status: application.status,
      submittedAt: application.submittedAt,
      decisionAt: application.decisionAt,
      personal: application.personal,
      education: application.education,
      experience: application.experience,
    })),
    documents: docs,
    enrolments: enrols.map(({ enrollment, institution }) => ({
      institution,
      matricNumber: enrollment.matricNumber,
      status: enrollment.status,
      enrolledAt: enrollment.createdAt,
    })),
    payments,
    results,
  };
}

/** DP-07. What is due, what was purged, and what failed. */
export async function retentionPicture() {
  const overdue = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({
        id: documents.id,
        kind: documents.kind,
        purgeAfter: documents.purgeAfter,
        purgeAttemptedAt: documents.purgeAttemptedAt,
        purgeError: documents.purgeError,
        institution: institutions.name,
      })
      .from(documents)
      .innerJoin(institutions, eq(institutions.id, documents.institutionId))
      .where(and(lt(documents.purgeAfter, new Date()), isNull(documents.purgedAt))),
  );

  const [{ purged }] = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ purged: sql<number>`count(*)::int` })
      .from(documents)
      .where(sql`${documents.purgedAt} is not null`),
  );

  const [{ scheduled }] = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ scheduled: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(sql`${documents.purgeAfter} >= now()`, isNull(documents.purgedAt))),
  );

  return {
    // A failed attempt is a different problem from one that has never run:
    // the first means the object store rejected us, the second means the job
    // is not running at all. DP-07 has to be able to say which.
    failed: overdue.filter((d) => d.purgeAttemptedAt),
    neverAttempted: overdue.filter((d) => !d.purgeAttemptedAt),
    purgedTotal: Number(purged),
    scheduledTotal: Number(scheduled),
  };
}
