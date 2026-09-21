'use server';

import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, breaches, grievanceNotices, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import type { FormState } from '../auth/actions';

/**
 * DP-05 breach register (CMP-09) and DP-04 SNAG register (CMP-08).
 *
 * Both are the DPO's, both are statutory, and both are the evidence a
 * regulator asks for without notice — which is why every change here is
 * written to the append-only audit log as well as to the register row. The
 * row says where things stand; the log says who moved them and when.
 */

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

function parseDate(value: FormDataEntryValue | null) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------- DP-05 */

export async function logBreach(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const title = String(form.get('title') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const severity = String(form.get('severity') ?? '');
  const institutionId = String(form.get('institutionId') ?? '') || null;
  const discoveredAt = parseDate(form.get('discoveredAt'));
  const categories = String(form.get('dataCategories') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (title.length < 6) return { error: 'Give the breach a short title somebody could search for.' };
  if (description.length < 20) {
    return { error: 'Describe what happened. The notification to the Commission is drafted from this.' };
  }
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
    return { error: 'Choose a severity.' };
  }
  /*
   * The clock runs from awareness, so this is required and cannot be later
   * than now. Defaulting it to "now" would be convenient and wrong: a breach
   * logged a day after it was found would quietly gain a day.
   */
  if (!discoveredAt) return { error: 'Enter when the breach was discovered. The 72 hours run from then.' };
  if (discoveredAt.getTime() > Date.now() + 60_000) {
    return { error: 'The discovery time cannot be in the future.' };
  }

  const [created] = await db
    .insert(breaches)
    .values({
      title,
      description,
      severity: severity as (typeof SEVERITIES)[number],
      institutionId,
      discoveredAt,
      dataCategories: categories,
      status: 'open',
    })
    .returning({ id: breaches.id });

  await audit({
    action: 'breach.logged',
    institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'breaches',
    entityId: created.id,
    detail: { severity, discoveredAt: discoveredAt.toISOString() },
  });

  return { redirectTo: `/dpo/breaches?logged=${created.id}` };
}

/**
 * Move a breach along: contained, Commission notified, subjects notified,
 * closed. Each step is a timestamp as well as a status, because "notified" is
 * a claim about *when*, and the 72-hour question is answered by that time.
 */
export async function advanceBreach(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const breachId = String(form.get('breachId') ?? '');
  const step = String(form.get('step') ?? '');
  const at = parseDate(form.get('at')) ?? new Date();

  const [breach] = await db.select().from(breaches).where(eq(breaches.id, breachId)).limit(1);
  if (!breach) return { error: 'That breach is not in the register.' };

  if (at.getTime() < breach.discoveredAt.getTime()) {
    return { error: 'That is before the breach was discovered.' };
  }

  const set: Partial<typeof breaches.$inferInsert> = {};
  if (step === 'contained') {
    set.status = breach.status === 'open' ? 'contained' : breach.status;
  } else if (step === 'ndpc') {
    set.ndpcNotifiedAt = at;
    set.status = 'notified';
  } else if (step === 'subjects') {
    set.subjectsNotifiedAt = at;
  } else if (step === 'close') {
    // Closing a breach the Commission was never told about is closing the
    // file on an unmet obligation. Refused, not warned.
    if (!breach.ndpcNotifiedAt) {
      return {
        error:
          'Record when the Commission was notified before closing this. A breach closed without that record looks, to an auditor, like one that was never reported.',
      };
    }
    set.status = 'closed';
  } else {
    return { error: 'Unknown step.' };
  }

  await db.update(breaches).set(set).where(eq(breaches.id, breach.id));

  await audit({
    action: `breach.${step}`,
    institutionId: breach.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'breaches',
    entityId: breach.id,
    detail: { at: at.toISOString() },
  });

  return { redirectTo: `/dpo/breaches?updated=${breach.id}` };
}

/**
 * CMP-09's engineering requirement: "the ability to scope affected data
 * subjects within hours — if we cannot answer it in hours, the 72-hour clock
 * beats us."
 *
 * The audit log carries `subject_id` on every read or write of somebody's
 * record, indexed for exactly this. So the answer to "who was in scope" is
 * one query: every distinct person whose record was touched at this
 * institution during the window of the incident.
 */
export async function scopeBreach(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const breachId = String(form.get('breachId') ?? '');
  const from = parseDate(form.get('from'));
  const to = parseDate(form.get('to'));

  const [breach] = await db.select().from(breaches).where(eq(breaches.id, breachId)).limit(1);
  if (!breach) return { error: 'That breach is not in the register.' };
  if (!from || !to || to.getTime() < from.getTime()) {
    return { error: 'Give the window the incident covers, with the end after the start.' };
  }

  const conditions = [
    isNotNull(auditLog.subjectId),
    gte(auditLog.at, from),
    lte(auditLog.at, to),
  ];
  if (breach.institutionId) conditions.push(eq(auditLog.institutionId, breach.institutionId));

  const [row] = await db
    .select({ n: sql<number>`count(distinct ${auditLog.subjectId})::int` })
    .from(auditLog)
    .where(and(...conditions));
  const affected = Number(row?.n ?? 0);

  await db.update(breaches).set({ affectedSubjectCount: affected }).where(eq(breaches.id, breach.id));

  await audit({
    action: 'breach.scoped',
    institutionId: breach.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'breaches',
    entityId: breach.id,
    detail: { from: from.toISOString(), to: to.toISOString(), affected },
  });

  return { redirectTo: `/dpo/breaches?scoped=${breach.id}&n=${affected}` };
}

/* ------------------------------------------------------------------- DP-04 */

export async function logGrievance(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const subjectName = String(form.get('subjectName') ?? '').trim();
  const subjectEmail = String(form.get('subjectEmail') ?? '').trim().toLowerCase();
  const grievance = String(form.get('grievance') ?? '').trim();
  const channel = String(form.get('channel') ?? '');
  const institutionId = String(form.get('institutionId') ?? '') || null;
  const receivedAt = parseDate(form.get('receivedAt'));

  if (subjectName.length < 2) return { error: 'Name the person who served the notice.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subjectEmail)) {
    return { error: 'Give an email the response can be sent to.' };
  }
  if (grievance.length < 20) {
    return { error: 'Record the grievance as served. The response has to answer what it actually says.' };
  }
  if (!['email', 'post', 'in_person', 'portal'].includes(channel)) {
    return { error: 'How did the notice arrive?' };
  }
  if (!receivedAt) return { error: 'Enter when the notice was received.' };

  if (institutionId) {
    const [inst] = await db
      .select({ id: institutions.id })
      .from(institutions)
      .where(eq(institutions.id, institutionId))
      .limit(1);
    if (!inst) return { error: 'That institution does not exist.' };
  }

  const [created] = await db
    .insert(grievanceNotices)
    .values({
      subjectName,
      subjectEmail,
      grievance,
      channel: channel as 'email' | 'post' | 'in_person' | 'portal',
      institutionId,
      receivedAt,
      loggedBy: me.userId,
    })
    .returning({ id: grievanceNotices.id });

  await audit({
    action: 'snag.logged',
    institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'grievance_notices',
    entityId: created.id,
    detail: { channel },
  });

  return { redirectTo: `/dpo/snag?logged=${created.id}` };
}

/**
 * The substantive response. Either the violation is accepted and the remedy
 * stated, or it is explained why none occurred. A response that does neither
 * is not a response to a SNAG, so the form will not record one.
 */
export async function respondToGrievance(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const noticeId = String(form.get('noticeId') ?? '');
  const responseType = String(form.get('responseType') ?? '');
  const responseText = String(form.get('responseText') ?? '').trim();
  const remedialAction = String(form.get('remedialAction') ?? '').trim();

  const [notice] = await db
    .select()
    .from(grievanceNotices)
    .where(eq(grievanceNotices.id, noticeId))
    .limit(1);
  if (!notice) return { error: 'That notice is not in the register.' };
  if (notice.status !== 'open') return { error: 'This notice has already been answered.' };

  if (responseType !== 'accepted_violation' && responseType !== 'no_violation') {
    return {
      error:
        'A response to a SNAG either accepts that a violation occurred or explains why none did. Choose which.',
    };
  }
  if (responseText.length < 40) {
    return { error: 'The response has to be substantive. Explain the position in full.' };
  }
  if (responseType === 'accepted_violation' && remedialAction.length < 20) {
    return {
      error: 'Accepting a violation means stating what is being done about it. Describe the remedy.',
    };
  }

  // Conditional on still being open, so two responses cannot both land.
  const [updated] = await db
    .update(grievanceNotices)
    .set({
      responseType,
      responseText,
      remedialAction: responseType === 'accepted_violation' ? remedialAction : null,
      respondedAt: new Date(),
      respondedBy: me.userId,
      status: 'responded',
      updatedAt: new Date(),
    })
    .where(and(eq(grievanceNotices.id, notice.id), eq(grievanceNotices.status, 'open')))
    .returning({ id: grievanceNotices.id });
  if (!updated) return { error: 'Somebody else answered this notice while you had it open.' };

  await audit({
    action: 'snag.responded',
    institutionId: notice.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'grievance_notices',
    entityId: notice.id,
    detail: { responseType },
  });

  return { redirectTo: `/dpo/snag?responded=${notice.id}` };
}

/** The outcome, including escalation — which a regulator will ask about. */
export async function recordGrievanceOutcome(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('dpo', 'super_admin');

  const noticeId = String(form.get('noticeId') ?? '');
  const outcome = String(form.get('outcome') ?? '');
  const outcomeNote = String(form.get('outcomeNote') ?? '').trim();

  const [notice] = await db
    .select()
    .from(grievanceNotices)
    .where(eq(grievanceNotices.id, noticeId))
    .limit(1);
  if (!notice) return { error: 'That notice is not in the register.' };
  if (notice.status === 'open') {
    return { error: 'Respond to the notice before recording how it ended.' };
  }
  if (!['resolved', 'escalated_ndpc', 'civil_proceedings', 'withdrawn'].includes(outcome)) {
    return { error: 'Choose how it ended.' };
  }
  if (outcomeNote.length < 10) return { error: 'Add a note on the outcome.' };

  await db
    .update(grievanceNotices)
    .set({
      outcome: outcome as 'resolved' | 'escalated_ndpc' | 'civil_proceedings' | 'withdrawn',
      outcomeNote,
      outcomeAt: new Date(),
      status: 'closed',
      updatedAt: new Date(),
    })
    .where(eq(grievanceNotices.id, notice.id));

  await audit({
    action: 'snag.outcome',
    institutionId: notice.institutionId,
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'grievance_notices',
    entityId: notice.id,
    detail: { outcome },
  });

  return { redirectTo: `/dpo/snag?closed=${notice.id}` };
}
