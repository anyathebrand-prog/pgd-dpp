'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { dataSubjectRequests, institutions, users } from '@/db/schema';
import { currentInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { sendMail } from '@/lib/mail';
import { rateLimit } from '@/lib/ratelimit';
import { SLA_DAYS } from './dsr';
import type { FormState } from '../auth/actions';

/** The intake page renders on both the platform host and a tenant host. */
export async function requireInstitutionOrNull() {
  return currentInstitution();
}

const KINDS = [
  'access',
  'rectification',
  'erasure',
  'portability',
  'restriction',
  'objection',
] as const;

/**
 * Logs a data subject request and starts the statutory clock.
 *
 * Unauthenticated by design — the people most likely to need this are
 * rejected applicants whose documents we still hold, and making them sign in
 * to ask for deletion would be absurd. Identity is verified by the DPO before
 * anything is released (§6.6), which is the right place for it: it keeps the
 * barrier off the person asking and puts the check before disclosure.
 */
export async function submitDsr(_prev: FormState, form: FormData): Promise<FormState> {
  const subjectEmail = String(form.get('subjectEmail') ?? '').trim().toLowerCase();
  const kind = String(form.get('kind') ?? '') as (typeof KINDS)[number];
  const detail = String(form.get('detail') ?? '').trim();
  const institutionSlug = String(form.get('institutionSlug') ?? '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subjectEmail)) {
    return { error: 'Enter the email address we hold for you, in the form name@example.com.' };
  }
  if (!KINDS.includes(kind)) return { error: 'Choose what you are asking for.' };

  // An open intake needs a brake, but the message must not reveal whether the
  // address matches an account.
  if (!rateLimit(`dsr:${subjectEmail}`, 3, 24 * 3_600_000).allowed) {
    return {
      error:
        'Several requests have already been logged for this address. The Data Protection Officer will respond to those first.',
    };
  }

  const [subject] = await db.select().from(users).where(eq(users.email, subjectEmail)).limit(1);

  const [institution] = institutionSlug
    ? await db.select().from(institutions).where(eq(institutions.slug, institutionSlug)).limit(1)
    : [];

  const dueAt = new Date(Date.now() + SLA_DAYS * 86_400_000);

  const [created] = await db
    .insert(dataSubjectRequests)
    .values({
      institutionId: institution?.id ?? null,
      userId: subject?.id ?? null,
      subjectEmail,
      kind,
      detail: detail || null,
      // §6.3: an academic-record request belongs to the institution, and the
      // rest to the platform. The DPO can re-route; this is only the opening
      // assumption so the queue is filterable from the moment it arrives.
      routedTo:
        institution && ['erasure', 'rectification'].includes(kind) ? 'institution' : 'platform',
      dueAt,
    })
    .returning({ id: dataSubjectRequests.id });

  await audit({
    action: 'dsr.received',
    institutionId: institution?.id ?? null,
    subjectId: subject?.id ?? null,
    entity: 'data_subject_requests',
    entityId: created.id,
    detail: { kind, selfServed: false },
  });

  await sendMail({
    to: subjectEmail,
    subject: 'We have received your data protection request',
    text: [
      `We have logged your ${kind} request.`,
      '',
      `We will respond by ${dueAt.toDateString()}, which is within the 30 days the NDPA allows.`,
      '',
      'We may contact you to confirm the request is yours. We will not ask you for identity',
      'documents we do not already hold.',
    ].join('\n'),
  });

  // The DPO is told, because a queue nobody looks at is not a queue.
  await sendMail({
    to: process.env.DPO_EMAIL ?? 'dpo@example.ng',
    subject: `New ${kind} request — due ${dueAt.toDateString()}`,
    text: `A ${kind} request was logged by ${subjectEmail}. The 30-day clock has started.`,
  });

  return { redirectTo: '/dpo/request?sent=1' };
}
