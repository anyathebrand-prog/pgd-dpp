'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { announcements, assessments, cohorts, modules, questions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { assessmentBlockers, attemptCount } from './assessment-queries';
import type { FormState } from '../auth/actions';

/**
 * FC-02, the "build quizzes" half (LRN-04).
 *
 * Until now assessments existed only in the seed, which meant the whole
 * assessment path — attempt, auto-mark, grade, release — worked on data no
 * facilitator could have created.
 *
 * One rule shapes everything here: **a question freezes the moment someone
 * answers it.** A submission stores answers keyed by question id and a grade
 * is a number out of a total derived from marks. Edit the prompt, change the
 * correct answer, or delete a question afterwards and every existing grade
 * becomes a claim about a paper that no longer exists — silently, with no
 * error anywhere. So the code refuses, and the screen says why rather than
 * greying a control out.
 */

/** Confirms this person may author this assessment's module. */
async function mine(institutionId: string, assessmentId: string, userId: string, isAdmin: boolean) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select({
        assessment: assessments,
        facilitatorId: modules.facilitatorId,
        moduleId: modules.id,
      })
      .from(assessments)
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(eq(assessments.id, assessmentId))
      .limit(1),
  );
  if (!row) return null;
  if (row.facilitatorId !== userId && !isAdmin) return null;
  return row;
}

/* ----------------------------------------------------------- the assessment */

export async function saveAssessment(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');
  const isAdmin = me.roles.includes('institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const assessmentId = String(form.get('assessmentId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const kind = String(form.get('kind') ?? 'quiz') as 'quiz' | 'assignment';
  const instructions = String(form.get('instructions') ?? '').trim();
  const timeLimit = Number(form.get('timeLimitMinutes') ?? 0);
  const attemptLimit = Number(form.get('attemptLimit') ?? 1);
  const passMark = Number(form.get('passMark') ?? 50);

  if (title.length < 3) return { error: 'Give the assessment a title students will recognise.' };
  if (kind !== 'quiz' && kind !== 'assignment') return { error: 'Unknown assessment type.' };
  if (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 10) {
    return { error: 'Allow between one and ten attempts.' };
  }
  if (!Number.isInteger(passMark) || passMark < 1 || passMark > 100) {
    return { error: 'The pass mark is a percentage between 1 and 100.' };
  }
  if (timeLimit && (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 300)) {
    return { error: 'A time limit is between 5 and 300 minutes, or leave it blank for none.' };
  }

  const [module] = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!module) return { error: 'That module does not exist.' };
  if (module.facilitatorId !== me.userId && !isAdmin) {
    return { error: 'You do not teach that module.' };
  }

  if (assessmentId) {
    const existing = await mine(institution.id, assessmentId, me.userId, isAdmin);
    if (!existing) return { error: 'That assessment does not exist.' };

    // Timing and marking rules are part of the paper. Changing the pass mark
    // under someone who has already sat it re-decides an outcome they were
    // told, which is not an edit — it is a regrade, and it belongs to the
    // registry rather than to a form field.
    const attempts = await attemptCount(institution.id, assessmentId);
    if (attempts > 0 && (existing.assessment.passMark !== passMark || existing.assessment.timeLimitMinutes !== (timeLimit || null))) {
      return {
        error: `${attempts} student${attempts === 1 ? ' has' : 's have'} already sat this. The title and instructions can still be corrected, but the time limit and pass mark are fixed once anyone has answered.`,
      };
    }

    await withTenant(institution.id, (tx) =>
      tx
        .update(assessments)
        .set({
          title,
          kind,
          instructions: instructions || null,
          timeLimitMinutes: timeLimit || null,
          attemptLimit,
          passMark,
        })
        .where(eq(assessments.id, assessmentId)),
    );

    await audit({
      action: 'assessment.updated',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'facilitator',
      entity: 'assessments',
      entityId: assessmentId,
    });

    revalidatePath(`/teach/${moduleId}`);
    return { notice: 'Assessment saved.' };
  }

  const [created] = await withTenant(institution.id, (tx) =>
    tx
      .insert(assessments)
      .values({
        institutionId: institution.id,
        moduleId,
        title,
        kind,
        instructions: instructions || null,
        timeLimitMinutes: timeLimit || null,
        attemptLimit,
        passMark,
        published: false,
      })
      .returning({ id: assessments.id }),
  );

  await audit({
    action: 'assessment.created',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'assessments',
    entityId: created.id,
  });

  revalidatePath(`/teach/${moduleId}`);
  return { notice: 'Assessment created. Add its questions before publishing it.' };
}

export async function setAssessmentPublished(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');
  const isAdmin = me.roles.includes('institution_admin');

  const assessmentId = String(form.get('assessmentId') ?? '');
  const publish = String(form.get('publish')) === 'true';

  const row = await mine(institution.id, assessmentId, me.userId, isAdmin);
  if (!row) return { error: 'That assessment does not exist.' };

  if (publish) {
    const blockers = await assessmentBlockers(institution.id, assessmentId);
    if (blockers.length > 0) return { error: blockers[0] };
  } else {
    // Unpublishing a paper people are part-way through takes it off the screen
    // mid-attempt. It is sometimes the right call — a broken question — so it
    // is allowed, but not silently.
    const attempts = await attemptCount(institution.id, assessmentId);
    if (attempts > 0) {
      await audit({
        action: 'assessment.unpublished_after_attempts',
        institutionId: institution.id,
        actorId: me.userId,
        actorRole: 'facilitator',
        entity: 'assessments',
        entityId: assessmentId,
        detail: { attempts },
      });
    }
  }

  await withTenant(institution.id, (tx) =>
    tx.update(assessments).set({ published: publish }).where(eq(assessments.id, assessmentId)),
  );

  revalidatePath(`/teach/${row.moduleId}`);
  return {
    notice: publish
      ? 'Published. Students on this module can attempt it now.'
      : 'Unpublished. Students can no longer see it; existing attempts and grades are untouched.',
  };
}

/* -------------------------------------------------------------- questions */

export async function saveQuestion(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');
  const isAdmin = me.roles.includes('institution_admin');

  const assessmentId = String(form.get('assessmentId') ?? '');
  const questionId = String(form.get('questionId') ?? '');
  const kind = String(form.get('kind') ?? '') as 'mcq' | 'true_false' | 'short_answer';
  const prompt = String(form.get('prompt') ?? '').trim();
  const marks = Number(form.get('marks') ?? 1);

  const row = await mine(institution.id, assessmentId, me.userId, isAdmin);
  if (!row) return { error: 'That assessment does not exist.' };

  const attempts = await attemptCount(institution.id, assessmentId);
  if (attempts > 0) {
    return {
      error: `${attempts} student${attempts === 1 ? ' has' : 's have'} already answered this paper. Questions cannot be changed afterwards — every grade already given is a mark out of these questions. Create a new assessment instead.`,
    };
  }

  if (prompt.length < 5) return { error: 'Write the question.' };
  if (!['mcq', 'true_false', 'short_answer'].includes(kind)) return { error: 'Unknown question type.' };
  if (!Number.isInteger(marks) || marks < 1 || marks > 100) {
    return { error: 'Marks are a whole number between 1 and 100.' };
  }

  let options: { key: string; text: string }[] = [];
  let correctAnswer: string | null = null;

  if (kind === 'mcq') {
    options = ['a', 'b', 'c', 'd']
      .map((key) => ({ key, text: String(form.get(`option_${key}`) ?? '').trim() }))
      .filter((o) => o.text.length > 0);

    if (options.length < 2) return { error: 'A multiple-choice question needs at least two options.' };

    correctAnswer = String(form.get('correctAnswer') ?? '').trim();
    if (!options.some((o) => o.key === correctAnswer)) {
      return { error: 'Mark which option is correct.' };
    }
  }

  if (kind === 'true_false') {
    correctAnswer = String(form.get('correctAnswer') ?? '');
    if (correctAnswer !== 'true' && correctAnswer !== 'false') {
      return { error: 'Choose whether the statement is true or false.' };
    }
  }

  if (kind === 'short_answer') {
    // Deliberately no model answer field: short answers are marked by a
    // person in FC-03, and a stored "correct answer" would invite an
    // auto-marker that fails anyone who phrased it differently.
    correctAnswer = null;
  }

  if (questionId) {
    await withTenant(institution.id, (tx) =>
      tx
        .update(questions)
        .set({ kind, prompt, options, correctAnswer, marks })
        .where(and(eq(questions.id, questionId), eq(questions.assessmentId, assessmentId))),
    );
  } else {
    const [{ next }] = await withTenant(institution.id, (tx) =>
      tx
        .select({ next: sql<number>`coalesce(max(${questions.position}), -1) + 1` })
        .from(questions)
        .where(eq(questions.assessmentId, assessmentId)),
    );

    await withTenant(institution.id, (tx) =>
      tx.insert(questions).values({
        institutionId: institution.id,
        assessmentId,
        position: Number(next),
        kind,
        prompt,
        options,
        correctAnswer,
        marks,
      }),
    );
  }

  await audit({
    action: questionId ? 'question.updated' : 'question.added',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'assessments',
    entityId: assessmentId,
  });

  revalidatePath(`/teach/${row.moduleId}/assessment/${assessmentId}`);
  return { notice: questionId ? 'Question saved.' : 'Question added.' };
}

export async function deleteQuestion(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');
  const isAdmin = me.roles.includes('institution_admin');

  const assessmentId = String(form.get('assessmentId') ?? '');
  const questionId = String(form.get('questionId') ?? '');

  const row = await mine(institution.id, assessmentId, me.userId, isAdmin);
  if (!row) return { error: 'That assessment does not exist.' };

  const attempts = await attemptCount(institution.id, assessmentId);
  if (attempts > 0) {
    return {
      error: 'Someone has already answered this paper. Deleting a question now would change what every existing grade was out of.',
    };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .delete(questions)
      .where(and(eq(questions.id, questionId), eq(questions.assessmentId, assessmentId))),
  );

  // Positions are renumbered so the paper has no gaps, which is what the
  // student-facing numbering is derived from.
  const remaining = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessmentId))
      .orderBy(asc(questions.position)),
  );
  await Promise.all(
    remaining.map((q, i) =>
      withTenant(institution.id, (tx) =>
        tx.update(questions).set({ position: i }).where(eq(questions.id, q.id)),
      ),
    ),
  );

  await audit({
    action: 'question.deleted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'assessments',
    entityId: assessmentId,
  });

  revalidatePath(`/teach/${row.moduleId}/assessment/${assessmentId}`);
  return { notice: 'Question removed.' };
}

/* ----------------------------------------------------------------- LRN-06 */

/**
 * An announcement to a cohort.
 *
 * The dashboard has rendered these since the beginning and nothing could
 * write one, so every cohort's announcements were whatever the seed said.
 *
 * Scoped to a cohort rather than to a module on purpose: a student reads one
 * dashboard, not one per module, and "the January intake" is the group a
 * facilitator actually means when they say "tell everyone". §5.8's scope
 * warning applies — this is an announcement, not a forum, and it deliberately
 * has no replies.
 */
export async function postAnnouncement(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const cohortId = String(form.get('cohortId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();

  if (title.length < 4) return { error: 'Give it a subject line students can scan.' };
  if (body.length < 10) return { error: 'Write the announcement.' };

  // The cohort has to belong to this institution; RLS makes that a matter of
  // the row not being found rather than of a check here.
  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1),
  );
  if (!cohort) return { error: 'That cohort does not exist.' };

  await withTenant(institution.id, (tx) =>
    tx.insert(announcements).values({
      institutionId: institution.id,
      cohortId,
      title,
      body,
      authorId: me.userId,
    }),
  );

  await audit({
    action: 'announcement.posted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'cohorts',
    entityId: cohortId,
    detail: { title },
  });

  revalidatePath('/teach');
  return { notice: 'Posted. Everyone in that cohort sees it on their dashboard.' };
}

/**
 * Removing one, which is not an edit.
 *
 * An announcement people have already read cannot be unsaid, so there is no
 * edit — a correction is a second announcement. Deleting exists for the case
 * that matters: something posted to the wrong cohort, or containing a
 * student's name.
 */
export async function deleteAnnouncement(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');
  const id = String(form.get('announcementId') ?? '');

  const removed = await withTenant(institution.id, (tx) =>
    tx.delete(announcements).where(eq(announcements.id, id)).returning({ id: announcements.id }),
  );
  if (removed.length === 0) return { error: 'That announcement has already gone.' };

  await audit({
    action: 'announcement.deleted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'announcements',
    entityId: id,
  });

  revalidatePath('/teach');
  return { notice: 'Removed. Anyone who already read it has already read it.' };
}
