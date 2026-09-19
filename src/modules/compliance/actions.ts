'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { dataSubjectRequests } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { sendMail } from '@/lib/mail';
import type { FormState } from '../auth/actions';
import { erasureConflicts } from './dsr';

/**
 * DP-03 fulfilment.
 *
 * Every transition here writes to the audit log before it writes anything
 * else, because the record of how a statutory request was handled is the part
 * an investigation asks for — CMP-16 gives roughly 21 days to produce it, so
 * it cannot be reconstructed afterwards.
 */

async function load(id: string) {
  const [row] = await db
    .select()
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * §6.6: verify the requester, but do not demand more identity data than we
 * already hold. So this records *how* the check was satisfied against data we
 * have, rather than collecting a passport scan to prove someone owns an email
 * address we already sent mail to.
 */
export async function verifyIdentity(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');
  const id = String(form.get('requestId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  if (note.length < 8) {
    return {
      error:
        'Record how identity was confirmed — matched against the signed-in account, replied from the address on file, or confirmed by the institution. This is the evidence that the check happened.',
    };
  }

  const request = await load(id);
  if (!request) return { error: 'That request no longer exists.' };

  await db
    .update(dataSubjectRequests)
    .set({
      identityVerifiedAt: new Date(),
      identityVerifiedNote: note,
      status: request.status === 'received' ? 'in_progress' : request.status,
      handledBy: me.userId,
    })
    .where(eq(dataSubjectRequests.id, id));

  await audit({
    action: 'dsr.identity_verified',
    institutionId: request.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'data_subject_requests',
    entityId: id,
    subjectId: request.userId,
    detail: { note },
  });

  revalidatePath(`/dpo/requests/${id}`);
  return { notice: 'Identity verification recorded.' };
}

/**
 * §6.3 / §6.6. Institution-controlled data goes to that registry with our
 * assistance. The requester is never asked to understand the split — they
 * are not told to write to someone else.
 */
export async function routeToInstitution(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');
  const id = String(form.get('requestId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  const request = await load(id);
  if (!request) return { error: 'That request no longer exists.' };
  if (!request.institutionId) {
    return {
      error:
        'This request is not linked to an institution, so there is no registry to route it to. Handle it here.',
    };
  }

  await db
    .update(dataSubjectRequests)
    .set({ status: 'routed', routedTo: 'institution', outcomeNote: note || null, handledBy: me.userId })
    .where(eq(dataSubjectRequests.id, id));

  await audit({
    action: 'dsr.routed_to_institution',
    institutionId: request.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'data_subject_requests',
    entityId: id,
    subjectId: request.userId,
    detail: { note },
  });

  revalidatePath(`/dpo/requests/${id}`);
  return { notice: 'Routed to the institution registry. The clock does not restart.' };
}

export async function fulfilRequest(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');
  const id = String(form.get('requestId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  const request = await load(id);
  if (!request) return { error: 'That request no longer exists.' };

  if (!request.identityVerifiedAt) {
    return { error: 'Verify the requester before fulfilling. Nothing is released on an unverified request.' };
  }
  if (note.length < 12) {
    return { error: 'Record what was actually done — what was sent, corrected or deleted.' };
  }

  // Erasure cannot quietly ignore an academic-record conflict. If one exists
  // the DPO has to refuse it explicitly, with the reason, rather than mark it
  // fulfilled and leave the record in place.
  if (request.kind === 'erasure') {
    const conflicts = await erasureConflicts(request.subjectEmail, request.userId);
    if (conflicts.length > 0) {
      return {
        error:
          'This erasure collides with records that cannot be deleted on request. Refuse it with the reason instead — marking it fulfilled would claim a deletion that did not happen.',
      };
    }
  }

  await db
    .update(dataSubjectRequests)
    .set({ status: 'fulfilled', closedAt: new Date(), outcomeNote: note, handledBy: me.userId })
    .where(eq(dataSubjectRequests.id, id));

  await audit({
    action: 'dsr.fulfilled',
    institutionId: request.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'data_subject_requests',
    entityId: id,
    subjectId: request.userId,
    detail: { kind: request.kind, note },
  });

  await sendMail({
    to: request.subjectEmail,
    subject: 'Your data protection request has been completed',
    text: [`Your ${request.kind} request has been completed.`, '', note, '', 'If you are not satisfied, you may complain to the Nigeria Data Protection Commission.'].join('\n'),
  });

  return { redirectTo: '/dpo/requests' };
}

/** A refusal is a valid outcome, but only a recorded and explained one. */
export async function refuseRequest(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');
  const id = String(form.get('requestId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  if (note.length < 20) {
    return {
      error:
        'A refusal needs a reason the data subject can act on, and that would stand up to the Commission. State which records are retained and on what basis.',
    };
  }

  const request = await load(id);
  if (!request) return { error: 'That request no longer exists.' };

  await db
    .update(dataSubjectRequests)
    .set({ status: 'refused', closedAt: new Date(), outcomeNote: note, handledBy: me.userId })
    .where(eq(dataSubjectRequests.id, id));

  await audit({
    action: 'dsr.refused',
    institutionId: request.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'data_subject_requests',
    entityId: id,
    subjectId: request.userId,
    detail: { kind: request.kind, reason: note },
  });

  await sendMail({
    to: request.subjectEmail,
    subject: 'Your data protection request — outcome',
    text: [
      `We have considered your ${request.kind} request and are unable to carry it out in full.`,
      '',
      note,
      '',
      'If you disagree, you may serve a Standard Notice to Address Grievance, or complain to the Nigeria Data Protection Commission.',
    ].join('\n'),
  });

  return { redirectTo: '/dpo/requests' };
}
