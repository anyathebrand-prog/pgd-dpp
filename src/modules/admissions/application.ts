import 'server-only';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, documentQueries, documents } from '@/db/schema';
import { humanCode } from '@/lib/crypto';
import { CONSENT_PURPOSES } from '@/lib/consent';
import { REQUIRED_DOCUMENTS } from './constants';

export type Application = typeof applications.$inferSelect;

export { REQUIRED_DOCUMENTS, APPLICATION_STEPS } from './constants';

/** APP-03. A draft is created on first visit so autosave has somewhere to go. */
export async function getOrCreateApplication(
  institutionId: string,
  userId: string,
  cohortId?: string,
): Promise<Application | null> {
  return withTenant(institutionId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.institutionId, institutionId)))
      .limit(1);
    if (existing) return existing;

    // Without a cohort we cannot create one — AP-04 picks the intake first,
    // because the intake drives fees, requirements and branding thereafter.
    const chosen = cohortId
      ? (await tx.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1))[0]
      : (await tx.select().from(cohorts).where(eq(cohorts.status, 'open')).limit(1))[0];
    if (!chosen) return null;

    const [created] = await tx
      .insert(applications)
      .values({
        institutionId,
        cohortId: chosen.id,
        userId,
        reference: `APP-${new Date().getFullYear()}-${humanCode(6)}`,
      })
      .returning();
    return created;
  });
}

export type Completeness = {
  personal: boolean;
  education: boolean;
  experience: boolean;
  documents: boolean;
  consent: boolean;
  outstanding: { label: string; href: string }[];
};

const REQUIRED_PERSONAL = ['fullName', 'dob', 'gender', 'phone', 'address', 'stateOfOrigin', 'nationality', 'nokName', 'nokPhone'];
const REQUIRED_EDUCATION = ['institution', 'degree', 'classOfDegree', 'yearOfGraduation'];

function filled(blob: Record<string, unknown>, keys: string[]) {
  return keys.every((k) => String(blob?.[k] ?? '').trim().length > 0);
}

/**
 * AP-08 depends on this being specific. A disabled "Submit and pay" with no
 * explanation fails WCAG 3.3.1, so this returns the exact outstanding items as
 * jump links rather than a boolean.
 */
export async function completeness(app: Application, consented: Set<string>): Promise<Completeness> {
  const docs = await withTenant(app.institutionId, (tx) =>
    tx.select().from(documents).where(eq(documents.applicationId, app.id)),
  );

  const present = new Set(docs.filter((d) => d.status !== 'rejected' && d.status !== 'purged').map((d) => d.kind));
  const missingDocs = REQUIRED_DOCUMENTS.filter((d) => !present.has(d.kind));

  const requiredConsents = CONSENT_PURPOSES.filter((c) => c.required);
  const consentDone = requiredConsents.every((c) => consented.has(c.key));

  const state = {
    personal: filled(app.personal, REQUIRED_PERSONAL),
    education: filled(app.education, REQUIRED_EDUCATION),
    experience: true, // APP-02 lists these, but none of them gate a decision.
    documents: missingDocs.length === 0,
    consent: consentDone,
  };

  const outstanding: { label: string; href: string }[] = [];
  if (!state.personal) outstanding.push({ label: 'Personal details are incomplete', href: '/apply/personal' });
  if (!state.education) outstanding.push({ label: 'Education history is incomplete', href: '/apply/education' });
  for (const d of missingDocs) {
    outstanding.push({ label: `${d.label} has not been uploaded`, href: '/apply/documents' });
  }
  if (!state.consent) outstanding.push({ label: 'Consent has not been recorded', href: '/apply/consent' });

  return { ...state, outstanding };
}

export async function openQueries(app: Application) {
  return withTenant(app.institutionId, (tx) =>
    tx
      .select()
      .from(documentQueries)
      .where(and(eq(documentQueries.applicationId, app.id))),
  ).then((rows) => rows.filter((r) => !r.resolvedAt));
}

/**
 * APP-07 status copy. The stepper shows sequence; this sentence carries the
 * meaning, and an anxious candidate reads the sentence first.
 */
export function statusSentence(app: Application): string {
  switch (app.status) {
    case 'draft':
      return 'Your application is a draft. Nothing has been sent to the registry yet.';
    case 'awaiting_application_fee':
      return 'Your application is complete and waiting for the application fee. It reaches the registry once the payment settles.';
    case 'submitted':
      return 'Your application has been received. The registry has not opened it yet.';
    case 'under_review':
      return 'The registry is reviewing your application and your documents.';
    case 'documents_queried':
      return 'The registry needs one or more documents replaced. Everything else stays as it is.';
    case 'admitted':
      return 'You have been offered a place. Accept the offer and pay to enrol.';
    case 'offer_accepted':
      return 'You have accepted your offer. Your place is confirmed once the tuition payment settles.';
    case 'enrolled':
      return 'You are enrolled. Your matriculation number and portal are ready.';
    case 'rejected':
      return 'This application was not successful.';
    case 'waitlisted':
      return 'You are on the waiting list. We will write if a place opens in this cohort.';
    case 'offer_lapsed':
      return 'This offer expired before the acceptance fee was paid, and the place has been released.';
    case 'withdrawn':
      return 'This application has been withdrawn.';
  }
}

export function stepperFor(app: Application) {
  type S = 'complete' | 'current' | 'queried' | 'blocked' | 'pending';
  const order = ['draft', 'submitted', 'under_review', 'decision', 'enrolled'];
  const at = (() => {
    switch (app.status) {
      case 'draft':
      case 'awaiting_application_fee':
        return 0;
      case 'submitted':
        return 1;
      case 'under_review':
      case 'documents_queried':
        return 2;
      case 'admitted':
      case 'offer_accepted':
      case 'rejected':
      case 'waitlisted':
      case 'offer_lapsed':
        return 3;
      default:
        return 4;
    }
  })();

  const labels = ['Draft', 'Submitted', 'Under review', 'Decision', 'Enrolled'];
  return order.map((_, i) => {
    let state: S = i < at ? 'complete' : i === at ? 'current' : 'pending';
    if (i === 2 && app.status === 'documents_queried') state = 'queried';
    if (i === 3 && (app.status === 'rejected' || app.status === 'offer_lapsed')) state = 'blocked';
    return { label: labels[i], state };
  });
}
