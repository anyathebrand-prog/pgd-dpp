'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import {
  assessmentAccommodations,
  assessments,
  grades,
  lessons,
  modules,
  questions,
  submissions,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import type { FormState } from '../auth/actions';

/**
 * The facilitator console — gap G-18.
 *
 * §5.9 defines consoles for institution admin, super admin and DPO and omits
 * a facilitator console entirely, despite LRN-05 requiring facilitators to
 * grade and LRN-01/02 requiring content to be authored. The app flow specs
 * FC-01 to FC-03 provisionally; this builds to that.
 *
 * Every action here checks the facilitator is assigned to the module. Holding
 * the `facilitator` role is not the same as teaching a particular module, and
 * the console is scoped to what someone actually teaches.
 */

/** Confirms this person teaches this module, at this institution. */
async function moduleITeach(institutionId: string, moduleId: string, userId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!row) return null;
  return row.facilitatorId === userId ? row : null;
}

async function assessmentITeach(institutionId: string, assessmentId: string, userId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select({ assessment: assessments, facilitatorId: modules.facilitatorId })
      .from(assessments)
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(eq(assessments.id, assessmentId))
      .limit(1),
  );
  if (!row) return null;
  return row.facilitatorId === userId ? row.assessment : null;
}

/* --------------------------------------------------------------------- FC-02 */

export async function saveLesson(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const lessonId = String(form.get('lessonId') ?? '') || null;
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const downloadable = form.get('downloadable') === 'on';

  if (!title) return { error: 'Give the lesson a title. Students navigate by it.' };
  if (!body) {
    return {
      error:
        'A lesson needs content. If the material is a video, write a summary too — §8 budgets three seconds on 3G, and plenty of students will read rather than stream.',
    };
  }

  const owned = await moduleITeach(institution.id, moduleId, me.userId);
  if (!owned) return { error: 'You are not assigned to that module.' };

  await withTenant(institution.id, async (tx) => {
    if (lessonId) {
      await tx
        .update(lessons)
        .set({ title, body, downloadable })
        .where(and(eq(lessons.id, lessonId), eq(lessons.moduleId, moduleId)));
    } else {
      const [last] = await tx
        .select({ max: sql<number>`coalesce(max(${lessons.position}), 0)::int` })
        .from(lessons)
        .where(eq(lessons.moduleId, moduleId));
      await tx.insert(lessons).values({
        institutionId: institution.id,
        moduleId,
        title,
        body,
        downloadable,
        position: Number(last?.max ?? 0) + 1,
      });
    }
  });

  await audit({
    action: lessonId ? 'lesson.updated' : 'lesson.created',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'lessons',
    entityId: lessonId ?? title,
    detail: { moduleId },
  });

  revalidatePath(`/teach/${moduleId}`);
  return { notice: lessonId ? 'Lesson updated.' : 'Lesson added.' };
}

/** Ordering is what students walk through, so it is a first-class action. */
export async function moveLesson(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const lessonId = String(form.get('lessonId') ?? '');
  const direction = String(form.get('direction') ?? '') as 'up' | 'down';

  const owned = await moduleITeach(institution.id, moduleId, me.userId);
  if (!owned) return { error: 'You are not assigned to that module.' };

  await withTenant(institution.id, async (tx) => {
    const ordered = await tx
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.position));

    const index = ordered.findIndex((l) => l.id === lessonId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= ordered.length) return;

    // Positions are rewritten wholesale rather than swapped in place, so a
    // list that has drifted out of sequence heals instead of staying broken.
    const reordered = [...ordered];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    for (const [i, lesson] of reordered.entries()) {
      await tx.update(lessons).set({ position: i + 1 }).where(eq(lessons.id, lesson.id));
    }
  });

  revalidatePath(`/teach/${moduleId}`);
  return { notice: 'Order updated.' };
}

/**
 * Publish/unpublish. FC-02 lists "publish blocked by missing required fields"
 * as a state, so the block is explicit and names what is missing rather than
 * disabling a control and leaving the facilitator to guess.
 */
export async function setModulePublished(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const publish = form.get('publish') === 'true';

  const owned = await moduleITeach(institution.id, moduleId, me.userId);
  if (!owned) return { error: 'You are not assigned to that module.' };

  if (publish) {
    const missing = await publishBlockers(institution.id, moduleId);
    if (missing.length > 0) {
      return { error: `Not published. ${missing.join(' ')}` };
    }
  }

  await withTenant(institution.id, (tx) =>
    tx.update(modules).set({ published: publish }).where(eq(modules.id, moduleId)),
  );

  await audit({
    action: publish ? 'module.published' : 'module.unpublished',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'modules',
    entityId: moduleId,
  });

  revalidatePath(`/teach/${moduleId}`);
  return { notice: publish ? 'Published. Students can see it now.' : 'Unpublished.' };
}

/** What stands between this module and being publishable. */
export async function publishBlockers(institutionId: string, moduleId: string) {
  const [module] = await withTenant(institutionId, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  const content = await withTenant(institutionId, (tx) =>
    tx.select().from(lessons).where(eq(lessons.moduleId, moduleId)),
  );

  const missing: string[] = [];
  if (!module?.summary?.trim()) {
    missing.push('The module needs a summary — students see it on the programme page.');
  }
  if (content.length === 0) {
    missing.push('It needs at least one lesson.');
  }
  if (content.some((l) => !l.body?.trim())) {
    missing.push('Every lesson needs content; one or more is empty.');
  }
  return missing;
}

/* --------------------------------------------------------------------- FC-03 */

export async function gradeAndRelease(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const submissionId = String(form.get('submissionId') ?? '');
  const score = Number(form.get('score') ?? NaN);
  const maxScore = Number(form.get('maxScore') ?? NaN);
  const feedback = String(form.get('feedback') ?? '').trim();

  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    return { error: `Enter a score between 0 and ${Number.isFinite(maxScore) ? maxScore : 'the maximum'}.` };
  }
  if (!feedback) {
    return {
      error:
        'Write feedback. A bare number tells a student nothing they can act on, and this is the only thing most of them will read.',
    };
  }

  const ok = await withTenant(institution.id, async (tx) => {
    const [row] = await tx
      .select({ facilitatorId: modules.facilitatorId, userId: submissions.userId })
      .from(submissions)
      .innerJoin(assessments, eq(assessments.id, submissions.assessmentId))
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!row || row.facilitatorId !== me.userId) return null;

    await tx.insert(grades).values({
      institutionId: institution.id,
      submissionId,
      score,
      maxScore,
      feedback,
      gradedBy: me.userId,
    });
    await tx
      .update(submissions)
      .set({ status: 'graded', returnedNote: null })
      .where(eq(submissions.id, submissionId));
    return row;
  });

  if (!ok) return { error: 'That submission is not on a module you teach.' };

  await audit({
    action: 'submission.graded',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'submissions',
    entityId: submissionId,
    subjectId: ok.userId,
    detail: { score, maxScore },
  });

  revalidatePath('/teach/grading');
  return { notice: 'Graded and released to the student.' };
}

/** FC-03 "return for revision" — an outcome that is not a mark. */
export async function returnForRevision(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const submissionId = String(form.get('submissionId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  if (note.length < 12) {
    return { error: 'Say what needs to change. A returned submission without a reason is just a rejection.' };
  }

  const ok = await withTenant(institution.id, async (tx) => {
    const [row] = await tx
      .select({ facilitatorId: modules.facilitatorId, userId: submissions.userId })
      .from(submissions)
      .innerJoin(assessments, eq(assessments.id, submissions.assessmentId))
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!row || row.facilitatorId !== me.userId) return null;

    await tx
      .update(submissions)
      .set({ status: 'returned', returnedNote: note })
      .where(eq(submissions.id, submissionId));
    return row;
  });

  if (!ok) return { error: 'That submission is not on a module you teach.' };

  await audit({
    action: 'submission.returned',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'submissions',
    entityId: submissionId,
    subjectId: ok.userId,
    detail: { note },
  });

  revalidatePath('/teach/grading');
  return { notice: 'Returned to the student for revision.' };
}

/* ------------------------------------------------------------ conflict C-06 */

/**
 * Extended time for one student on one assessment.
 *
 * WCAG 2.2.1 requires that a time limit be adjustable unless the timing is
 * essential. Assessment timing is essential, so the exception applies — but
 * relying on the exception alone leaves a disabled student with no route at
 * all, which is why the resolution puts the accommodation here.
 */
export async function grantExtraTime(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const assessmentId = String(form.get('assessmentId') ?? '');
  const userId = String(form.get('userId') ?? '');
  const extraMinutes = Number(form.get('extraMinutes') ?? NaN);
  const reason = String(form.get('reason') ?? '').trim();

  if (!Number.isInteger(extraMinutes) || extraMinutes < 1 || extraMinutes > 240) {
    return { error: 'Enter the extra minutes to add, between 1 and 240.' };
  }
  if (!reason) {
    return {
      error:
        'Record why. Enough to show the accommodation was considered — not a diagnosis, and not medical detail this platform has no business holding.',
    };
  }

  const owned = await assessmentITeach(institution.id, assessmentId, me.userId);
  if (!owned) return { error: 'That assessment is not on a module you teach.' };

  await withTenant(institution.id, (tx) =>
    tx
      .insert(assessmentAccommodations)
      .values({
        institutionId: institution.id,
        assessmentId,
        userId,
        extraMinutes,
        reason,
        grantedBy: me.userId,
      })
      .onConflictDoUpdate({
        target: [assessmentAccommodations.assessmentId, assessmentAccommodations.userId],
        set: { extraMinutes, reason, grantedBy: me.userId },
      }),
  );

  await audit({
    action: 'assessment.extra_time_granted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'assessments',
    entityId: assessmentId,
    subjectId: userId,
    detail: { extraMinutes, reason },
  });

  revalidatePath(`/teach/grading`);
  return { notice: `${extraMinutes} extra minutes granted.` };
}
