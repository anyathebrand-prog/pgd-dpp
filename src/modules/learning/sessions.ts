'use server';

import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { enrollments, liveSessions, sessionAttendance } from '@/db/schema';
import { requireUser, requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import type { FormState } from '../auth/actions';
import { flagEnabled } from '@/lib/flags';

/**
 * LRN-07 live sessions and LRN-10 attendance.
 *
 * §5.5 is explicit that video features are not the differentiator, so this is
 * as thin as it can honestly be: a scheduled link, a calendar invite, and a
 * record of who we handed the link to. We do not host the call and do not
 * pretend to know what happened inside it.
 */

export async function saveSession(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  if (!(await flagEnabled('live_sessions', institution.id))) {
    return { error: 'Live sessions are switched off for this institution.' };
  }

  const sessionId = String(form.get('sessionId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const joinUrl = String(form.get('joinUrl') ?? '').trim();
  const cohortId = String(form.get('cohortId') ?? '').trim();
  const startsAtRaw = String(form.get('startsAt') ?? '').trim();
  const durationMinutes = Number(form.get('durationMinutes') ?? 60);

  if (title.length < 4) return { error: 'Give the session a title students will recognise.' };
  if (!/^https?:\/\//i.test(joinUrl)) {
    return { error: 'Paste the full join link from Zoom, Meet or Teams, starting with https://.' };
  }
  if (!startsAtRaw) return { error: 'Say when it starts.' };

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) return { error: 'That start time is not a real date.' };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return { error: 'A session runs between 15 minutes and eight hours.' };
  }

  const values = {
    institutionId: institution.id,
    cohortId: cohortId || null,
    title,
    description: description || null,
    joinUrl,
    startsAt,
    durationMinutes,
    createdBy: me.userId,
  };

  if (sessionId) {
    await withTenant(institution.id, (tx) =>
      tx.update(liveSessions).set(values).where(eq(liveSessions.id, sessionId)),
    );
  } else {
    await withTenant(institution.id, (tx) => tx.insert(liveSessions).values(values));
  }

  await audit({
    action: sessionId ? 'session.updated' : 'session.scheduled',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'live_sessions',
    entityId: sessionId || undefined,
    detail: { title, startsAt: startsAt.toISOString() },
  });

  return { notice: sessionId ? 'Session updated.' : 'Scheduled. Students on that cohort can see it.' };
}

/** A recording link, added after the fact. */
export async function addRecording(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const sessionId = String(form.get('sessionId') ?? '');
  const recordingUrl = String(form.get('recordingUrl') ?? '').trim();

  if (recordingUrl && !/^https?:\/\//i.test(recordingUrl)) {
    return { error: 'Paste the full link to the recording.' };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(liveSessions)
      .set({ recordingUrl: recordingUrl || null })
      .where(eq(liveSessions.id, sessionId)),
  );

  await audit({
    action: 'session.recording_added',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'live_sessions',
    entityId: sessionId,
  });

  return { notice: recordingUrl ? 'Recording linked.' : 'Recording link removed.' };
}

/**
 * LRN-10 — attendance, recorded at the moment we hand over the link.
 *
 * Returns the join URL rather than rendering it on the page, so the record
 * and the handover are the same event. A link printed on a page and a
 * separate "I attended" button would let either happen without the other,
 * and an accreditation file full of people who clicked a button is worth
 * nothing.
 *
 * What it attests to is exactly that: we gave this person the link at this
 * time. Not that they stayed, which we cannot see.
 */
export async function joinSession(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireUser();
  const sessionId = String(form.get('sessionId') ?? '');

  // SA-03. Joining is what records attendance (LRN-10), so a join that still
  // worked behind a hidden page would write a register for a feature that is
  // switched off.
  if (!(await flagEnabled('live_sessions', institution.id))) {
    return { error: 'Live sessions are not running here at the moment.' };
  }

  const [session] = await withTenant(institution.id, (tx) =>
    tx.select().from(liveSessions).where(eq(liveSessions.id, sessionId)).limit(1),
  );
  if (!session) return { error: 'That session does not exist.' };

  // Enrolled at this institution, on this cohort where the session names one.
  const [enrolment] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, me.userId),
          eq(enrollments.institutionId, institution.id),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1),
  );

  const teaches = me.roles.some((r) => ['facilitator', 'institution_admin'].includes(r));
  if (!enrolment && !teaches) return { error: 'That session is not yours to join.' };
  if (enrolment && session.cohortId && enrolment.cohortId !== session.cohortId) {
    return { error: 'That session is for another cohort.' };
  }

  // Facilitators are not students, so their click is not attendance evidence.
  if (enrolment) {
    await withTenant(institution.id, (tx) =>
      tx
        .insert(sessionAttendance)
        .values({ institutionId: institution.id, sessionId, userId: me.userId })
        .onConflictDoNothing(),
    );

    await audit({
      action: 'session.joined',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'self',
      subjectId: me.userId,
      entity: 'live_sessions',
      entityId: sessionId,
    });
  }

  return { redirectTo: session.joinUrl };
}
