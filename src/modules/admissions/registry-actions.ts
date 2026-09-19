'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { applications, certificates, documentQueries, documents, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { humanCode } from '@/lib/crypto';
import { sendMail } from '@/lib/mail';
import { seatsRemaining } from '../payments/settle';
import type { FormState } from '../auth/actions';

/* --------------------------------------------------------------------- RG-02 */

/**
 * Opening an applicant's file is itself an event worth recording. CMP-14 asks
 * for an immutable log of staff access to student records — not only of
 * changes — because "who looked at this" is the question an investigation
 * actually asks.
 */
export async function recordFileAccess(applicationId: string, subjectId: string) {
  const institution = await requireInstitution();
  const me = await requireRole('registry', 'institution_admin');
  await audit({
    action: 'application.viewed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: me.roles.join(','),
    entity: 'applications',
    entityId: applicationId,
    subjectId,
  });
}

/* --------------------------------------------------------------------- RG-03 */

/**
 * APP-08. The query names one document. The candidate is asked to replace that
 * item only — not to resubmit the application — and the note is shown to them
 * verbatim, so a vague note produces a vague re-upload.
 */
export async function raiseDocumentQuery(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('registry', 'institution_admin');

  const applicationId = String(form.get('applicationId') ?? '');
  const documentKind = String(form.get('documentKind') ?? '');
  const note = String(form.get('note') ?? '').trim();

  if (!note) return { error: 'Write what is wrong with the document. The candidate sees this text exactly as you type it.' };
  if (note.length < 12) return { error: 'Be specific enough to act on — "unreadable" alone does not tell the candidate what to change.' };

  const result = await withTenant(institution.id, async (tx) => {
    const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    if (!app) return null;

    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.applicationId, applicationId), eq(documents.kind, documentKind as 'transcript')))
      .limit(1);

    await tx.insert(documentQueries).values({
      institutionId: institution.id,
      applicationId,
      documentId: doc?.id ?? null,
      documentKind,
      note,
      raisedBy: me.userId,
    });

    if (doc) {
      await tx.update(documents).set({ status: 'queried' }).where(eq(documents.id, doc.id));
    }

    await tx
      .update(applications)
      .set({ status: 'documents_queried', updatedAt: new Date() })
      .where(eq(applications.id, applicationId));

    const [candidate] = await tx.select().from(users).where(eq(users.id, app.userId)).limit(1);
    return { app, candidate };
  });

  if (!result) return { error: 'That application could not be found at this institution.' };

  await audit({
    action: 'application.document_queried',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: me.roles.join(','),
    entity: 'applications',
    entityId: applicationId,
    subjectId: result.app.userId,
    detail: { documentKind, note },
  });

  if (result.candidate) {
    await sendMail({
      to: result.candidate.email,
      subject: `One document needs replacing — ${result.app.reference}`,
      text: [
        `The registry at ${institution.name} has asked you to replace one document.`,
        '',
        `${documentKind.replace(/_/g, ' ')}: ${note}`,
        '',
        'Nothing else about your application needs to change. Sign in and replace that one item.',
      ].join('\n'),
    });
  }

  revalidatePath(`/admin/applications/${applicationId}`);
  return { notice: 'The query has been sent to the candidate.' };
}

/* --------------------------------------------------------------------- RG-04 */

/**
 * §5.1 LOCKED. Cohort capacity is enforced HERE, at offer issuance — not at
 * payment. Enforcing it at payment oversells the cohort to whoever pays
 * fastest and leaves the registry to disappoint people who already paid.
 */
export async function issueDecision(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('registry', 'institution_admin');

  const applicationId = String(form.get('applicationId') ?? '');
  const decision = String(form.get('decision') ?? '') as 'admitted' | 'rejected' | 'waitlisted';
  const note = String(form.get('note') ?? '').trim();

  if (!['admitted', 'rejected', 'waitlisted'].includes(decision)) {
    return { error: 'Choose admit, reject or waitlist.' };
  }
  if (decision === 'rejected' && note.length < 12) {
    return { error: 'A rejection needs a reason on the record. The candidate is told this, and an appeal will ask for it.' };
  }

  const app = await withTenant(institution.id, async (tx) => {
    const [row] = await tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    return row ?? null;
  });
  if (!app) return { error: 'That application could not be found at this institution.' };

  /*
   * Only an application that is actually waiting for a decision can get one.
   *
   * There was no check. Admitting a `draft` or `awaiting_application_fee`
   * application skipped the fee that submission charges. Rejecting an
   * `enrolled` one turned a paying student back into a rejected applicant —
   * and started the CMP-10 retention clock below on their documents, which
   * ends in a purge. A stale tab or a misclick was enough.
   *
   * Waitlisted is included: a waitlist exists to be decided later.
   */
  const DECIDABLE = ['submitted', 'under_review', 'documents_queried', 'waitlisted'];
  if (!DECIDABLE.includes(app.status)) {
    return {
      error: `This application is ${app.status.replace(/_/g, ' ')}, so it is not waiting for a decision. Reload the page — it may have changed since you opened it.`,
    };
  }

  if (decision === 'admitted') {
    const seats = await seatsRemaining(app.cohortId);
    if (seats <= 0) {
      return {
        error:
          'This cohort is full — every seat is held by an admitted, accepted or enrolled candidate. Waitlist this application, or raise the cohort capacity first.',
      };
    }
  }

  const offerExpiresAt =
    decision === 'admitted'
      ? new Date(Date.now() + institution.offerExpiryDays * 86_400_000)
      : null;

  await withTenant(institution.id, async (tx) => {
    await tx
      .update(applications)
      .set({
        status: decision,
        decisionAt: new Date(),
        decisionBy: me.userId,
        decisionNote: note || null,
        offerExpiresAt,
        updatedAt: new Date(),
      })
      // Conditional on the status just checked: two registrars deciding the
      // same application at once cannot both win.
      .where(and(eq(applications.id, applicationId), eq(applications.status, app.status)));

    // CMP-10: the retention clock on a rejected applicant's documents starts
    // at the decision, and this is the moment it is set. Rejected applicants
    // outnumber admitted ones, and nobody remembers to delete their files —
    // which is exactly why it is written here rather than left to a habit.
    if (decision === 'rejected') {
      await tx
        .update(documents)
        .set({ purgeAfter: new Date(Date.now() + 180 * 86_400_000) })
        .where(eq(documents.applicationId, applicationId));
    }
  });

  // `users` is a shared table, so this needs no tenant context.
  const [candidate] = await db.select().from(users).where(eq(users.id, app.userId)).limit(1);

  await audit({
    action: `application.${decision}`,
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: me.roles.join(','),
    entity: 'applications',
    entityId: applicationId,
    subjectId: app.userId,
    detail: { note, offerExpiresAt },
  });

  if (decision === 'admitted') {
    // APP-10: the letter carries a unique verification code, so a registrar can
    // check it without ringing anyone.
    await withTenant(institution.id, (tx) =>
      tx
        .insert(certificates)
        .values({
          institutionId: institution.id,
          // The letter is issued against the application: no enrollment row
          // exists until tuition settles.
          applicationId,
          kind: 'admission_letter',
          verificationCode: `ADM-${humanCode(8)}`,
          holderName: String((app.personal as Record<string, string>).fullName ?? candidate?.fullName ?? ''),
          programmeTitle: 'Post Graduate Diploma in Data Protection & Privacy',
        })
        .onConflictDoNothing(),
    );
  }

  if (candidate) {
    await sendMail({
      to: candidate.email,
      subject:
        decision === 'admitted'
          ? `Your application to ${institution.shortName} — offer of admission`
          : `Your application to ${institution.shortName} — decision`,
      text:
        decision === 'admitted'
          ? [
              `${institution.name} has offered you a place.`,
              '',
              `Reference: ${app.reference}`,
              `Accept by: ${offerExpiresAt?.toDateString()}`,
              '',
              'Sign in to read the letter and accept.',
            ].join('\n')
          : [
              `A decision has been recorded on your application ${app.reference}.`,
              '',
              note,
              '',
              'Sign in to read it in full.',
            ].join('\n'),
    });
  }

  revalidatePath('/admin/applications');
  return { redirectTo: '/admin/applications' };
}
