'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { applications, consentRecords, documentQueries, documents } from '@/db/schema';
import { requireUser, clientIp } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { hashIp } from '@/lib/crypto';
import { CONSENT_PURPOSES, currentNoticeVersion } from '@/lib/consent';
import { documentKey, putObject, uploadProblem } from '@/lib/storage';
import { completeness, getOrCreateApplication, REQUIRED_DOCUMENTS } from './application';
import type { FormState } from '../auth/actions';

/** The states in which a candidate may still edit their own application. */
const EDITABLE = new Set(['draft', 'awaiting_application_fee', 'documents_queried']);

async function myApplication() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  if (!app) throw new Error('NO_OPEN_COHORT');
  return { me, institution, app };
}

/* ------------------------------------------------------------ AP-02 to AP-04 */

/**
 * APP-03. Autosave: the candidate can leave and come back. Saving is silent
 * (§6: validation success is silent; only verification uses Signal), and
 * nothing is validated here — a half-filled draft is a legitimate state and
 * blocking it mid-typing is how people abandon applications.
 */
export async function saveStep(_prev: FormState, form: FormData): Promise<FormState> {
  const { me, institution, app } = await myApplication();
  const step = String(form.get('step')) as 'personal' | 'education' | 'experience';
  if (!['personal', 'education', 'experience'].includes(step)) return { error: 'Unknown step.' };

  if (!EDITABLE.has(app.status)) {
    return { error: 'This application has been submitted and can no longer be edited here.' };
  }

  const blob: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key === 'step' || key === '$ACTION_ID' || typeof value !== 'string') continue;
    blob[key] = value.trim();
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(applications)
      .set({ [step]: blob, updatedAt: new Date() })
      .where(eq(applications.id, app.id)),
  );

  await audit({
    action: 'application.step_saved',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'applications',
    entityId: app.id,
    detail: { step },
  });

  const next = { personal: '/apply/education', education: '/apply/experience', experience: '/apply/documents' }[step];
  return { redirectTo: next };
}

/* --------------------------------------------------------------------- AP-05 */

export async function uploadDocument(_prev: FormState, form: FormData): Promise<FormState> {
  const { me, institution, app } = await myApplication();
  if (!EDITABLE.has(app.status)) {
    return { error: 'Documents can no longer be changed on this application.' };
  }

  const kind = String(form.get('kind')) as (typeof REQUIRED_DOCUMENTS)[number]['kind'];
  if (!REQUIRED_DOCUMENTS.some((d) => d.kind === kind)) return { error: 'Unknown document type.' };

  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'Choose a file to upload.' };

  const problem = uploadProblem(file);
  if (problem) return { error: problem };

  const key = documentKey(institution.id, app.id, kind, file.name);
  await putObject(key, Buffer.from(await file.arrayBuffer()));

  await withTenant(institution.id, async (tx) => {
    // Originals are immutable. A replacement supersedes rather than overwrites,
    // so a queried-and-replaced transcript leaves both versions on the record.
    await tx
      .update(documents)
      .set({ status: 'rejected' })
      .where(and(eq(documents.applicationId, app.id), eq(documents.kind, kind)));

    await tx.insert(documents).values({
      institutionId: institution.id,
      applicationId: app.id,
      kind,
      objectKey: key,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      // §7.6: the pipeline is upload → scan → preview → index. The worker moves
      // this to `clean` or `infected`; until then the file is not served.
      scanStatus: 'pending',
      status: 'uploaded',
    });

    // APP-08: replacing the queried document resolves the query.
    await tx
      .update(documentQueries)
      .set({ resolvedAt: new Date() })
      .where(and(eq(documentQueries.applicationId, app.id), eq(documentQueries.documentKind, kind)));
  });

  await audit({
    action: 'document.uploaded',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'documents',
    entityId: app.id,
    detail: { kind, bytes: file.size },
  });

  revalidatePath('/apply/documents');
  return { notice: undefined };
}

/* --------------------------------------------------------------------- AP-07 */

/**
 * CMP-06. Four separate decisions, each recorded against the notice version in
 * force and with the wording the person actually saw. Declining an optional
 * purpose is recorded as a decision too — an absent row and a refusal are not
 * the same fact, and an auditor will ask which one happened.
 */
export async function saveConsent(_prev: FormState, form: FormData): Promise<FormState> {
  const { me, institution } = await myApplication();
  const version = await currentNoticeVersion();
  const h = await headers();

  const required = CONSENT_PURPOSES.filter((c) => c.required);
  for (const purpose of required) {
    if (form.get(purpose.key) !== 'on') {
      return {
        error: `The application cannot proceed without the first consent: ${purpose.title.toLowerCase()}. If you do not want this, close the application instead.`,
      };
    }
  }

  await db.insert(consentRecords).values(
    CONSENT_PURPOSES.map((purpose) => ({
      institutionId: institution.id,
      userId: me.userId,
      purpose: purpose.key,
      granted: form.get(purpose.key) === 'on',
      noticeVersion: version,
      purposeTextShown: `${purpose.title} — ${purpose.text}`,
      ipHash: hashIp(clientIp(h)),
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    })),
  );

  await audit({
    action: 'consent.recorded',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    detail: { noticeVersion: version },
  });

  return { redirectTo: '/apply/review' };
}

/* --------------------------------------------------------------------- AP-08 */

/**
 * §5.1 LOCKED. Submission and the application fee are one event: the fee is
 * charged at submission, it is non-refundable, and that was disclosed before
 * the candidate got here. This action does not mark anything paid — it hands
 * off to checkout, and the webhook decides (PAY-03).
 */
export async function submitApplication(_prev: FormState, _form: FormData): Promise<FormState> {
  const { me, institution, app } = await myApplication();

  const granted = await db
    .select({ purpose: consentRecords.purpose, granted: consentRecords.granted })
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId));
  const consented = new Set(granted.filter((g) => g.granted).map((g) => g.purpose));

  const state = await completeness(app, consented);
  if (state.outstanding.length > 0) return { redirectTo: '/apply/review' };

  await withTenant(institution.id, (tx) =>
    tx
      .update(applications)
      .set({ status: 'awaiting_application_fee', updatedAt: new Date() })
      .where(eq(applications.id, app.id)),
  );

  await audit({
    action: 'application.ready_for_fee',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'applications',
    entityId: app.id,
  });

  return { redirectTo: '/pay/application' };
}
