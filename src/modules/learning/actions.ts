'use server';

import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, grades, lessonProgress, questions, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import type { FormState } from '../auth/actions';

/** LRN-03. Called as the student reads or watches; cheap and idempotent. */
export async function recordProgress(lessonId: string, positionSeconds: number, complete: boolean) {
  const me = await requireUser();
  const institution = await requireInstitution();

  await withTenant(institution.id, (tx) =>
    tx
      .insert(lessonProgress)
      .values({
        institutionId: institution.id,
        lessonId,
        userId: me.userId,
        positionSeconds,
        completedAt: complete ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [lessonProgress.lessonId, lessonProgress.userId],
        set: {
          positionSeconds,
          ...(complete ? { completedAt: new Date() } : {}),
          updatedAt: new Date(),
        },
      }),
  );
}

export async function markLessonComplete(formData: FormData) {
  const lessonId = String(formData.get('lessonId') ?? '');
  const next = String(formData.get('next') ?? '');
  await recordProgress(lessonId, 0, true);
  redirect(next || '/programme');
}

/* --------------------------------------------------------------- ST-04/ST-05 */

/**
 * LRN-04. Starting an attempt is a write, not a page view: the attempt limit
 * and the timer both hang off `startedAt`, so a student cannot reload their way
 * to a fresh clock.
 */
export async function startAttempt(formData: FormData) {
  const me = await requireUser();
  const institution = await requireInstitution();
  const assessmentId = String(formData.get('assessmentId') ?? '');

  const result = await withTenant(institution.id, async (tx) => {
    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId))
      .limit(1);
    if (!assessment || !assessment.published) return 'unavailable' as const;
    if (assessment.closesAt && assessment.closesAt < new Date()) return 'closed' as const;

    const prior = await tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.assessmentId, assessmentId), eq(submissions.userId, me.userId)))
      .orderBy(desc(submissions.attempt));

    const open = prior.find((p) => p.status === 'in_progress');
    if (open) return 'resumed' as const;
    if (prior.length >= assessment.attemptLimit) return 'exhausted' as const;

    await tx.insert(submissions).values({
      institutionId: institution.id,
      assessmentId,
      userId: me.userId,
      attempt: prior.length + 1,
    });
    return 'started' as const;
  });

  if (result === 'exhausted' || result === 'closed' || result === 'unavailable') {
    redirect(`/assessment/${assessmentId}?blocked=${result}`);
  }
  redirect(`/assessment/${assessmentId}/attempt`);
}

/**
 * Auto-marking for MCQ and true/false. Short answers and file uploads go to the
 * facilitator's grading queue (FC-03) rather than being guessed at — LRN-04
 * lists them as question types, and §10 puts automated grading out of scope
 * for v1 for good reason.
 */
export async function submitAttempt(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const assessmentId = String(form.get('assessmentId') ?? '');

  const outcome = await withTenant(institution.id, async (tx) => {
    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId))
      .limit(1);
    if (!assessment) return null;

    const [attempt] = await tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.assessmentId, assessmentId),
          eq(submissions.userId, me.userId),
          eq(submissions.status, 'in_progress'),
        ),
      )
      .orderBy(desc(submissions.attempt))
      .limit(1);
    if (!attempt) return null;

    // The timer is enforced server-side. A client-side countdown is a courtesy;
    // it is not a control, and an open dev-tools panel should not buy time.
    if (assessment.timeLimitMinutes) {
      const deadline = attempt.startedAt.getTime() + assessment.timeLimitMinutes * 60_000;
      // A 60-second grace absorbs a slow submit on a bad connection rather
      // than punishing a 3G student for the network.
      if (Date.now() > deadline + 60_000) {
        await tx
          .update(submissions)
          .set({ status: 'submitted', submittedAt: new Date() })
          .where(eq(submissions.id, attempt.id));
        return { expired: true as const };
      }
    }

    const qs = await tx
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessmentId))
      .orderBy(questions.position);

    const answers: Record<string, string> = {};
    for (const q of qs) answers[q.id] = String(form.get(`q-${q.id}`) ?? '');

    const autoMarkable = qs.filter((q) => q.kind !== 'short_answer');
    const autoScore = autoMarkable.reduce(
      (sum, q) =>
        sum + (answers[q.id] && answers[q.id] === q.correctAnswer ? q.marks : 0),
      0,
    );
    const autoMax = autoMarkable.reduce((sum, q) => sum + q.marks, 0);
    const needsHuman = qs.length > autoMarkable.length;

    await tx
      .update(submissions)
      .set({
        answers,
        autoScore,
        submittedAt: new Date(),
        status: needsHuman ? 'submitted' : 'graded',
      })
      .where(eq(submissions.id, attempt.id));

    if (!needsHuman) {
      await tx.insert(grades).values({
        institutionId: institution.id,
        submissionId: attempt.id,
        score: autoScore,
        maxScore: autoMax,
        feedback: null,
      });
    }

    return { expired: false as const, autoScore, autoMax, needsHuman };
  });

  if (!outcome) return { error: 'There is no attempt in progress for this assessment.' };

  await audit({
    action: 'assessment.submitted',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'assessments',
    entityId: assessmentId,
  });

  redirect(`/assessment/${assessmentId}/result`);
}

/* --------------------------------------------------------------------- FC-03 */

/** LRN-05. A grade without feedback is a number; the facilitator writes both. */
export async function gradeSubmission(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();

  const submissionId = String(form.get('submissionId') ?? '');
  const score = Number(form.get('score') ?? NaN);
  const maxScore = Number(form.get('maxScore') ?? NaN);
  const feedback = String(form.get('feedback') ?? '').trim();

  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || score < 0 || score > maxScore) {
    return { error: 'Enter a score between zero and the maximum for this assessment.' };
  }
  if (!feedback) return { error: 'Write feedback. A bare number tells the student nothing they can act on.' };

  await withTenant(institution.id, async (tx) => {
    await tx.insert(grades).values({
      institutionId: institution.id,
      submissionId,
      score,
      maxScore,
      feedback,
      gradedBy: me.userId,
    });
    await tx.update(submissions).set({ status: 'graded' }).where(eq(submissions.id, submissionId));
  });

  await audit({
    action: 'submission.graded',
    institutionId: institution.id,
    actorId: me.userId,
    entity: 'submissions',
    entityId: submissionId,
    detail: { score, maxScore },
  });

  return { notice: 'Grade recorded and released to the student.' };
}
