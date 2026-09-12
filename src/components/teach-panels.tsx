'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Textarea } from './ui';
import type { ActionState } from './form';
import {
  gradeAndRelease,
  grantExtraTime,
  moveLesson,
  returnForRevision,
  saveLesson,
  setModulePublished,
} from '@/modules/teaching/actions';

function useNav(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);
}

function Feedback({ state }: { state: ActionState }) {
  if (state?.error) {
    return (
      <div className="mb-4">
        <Banner tone="danger" title="Not saved">
          <p>{state.error}</p>
        </Banner>
      </div>
    );
  }
  if (state?.notice) {
    return (
      <div className="mb-4">
        <Banner tone="verified" title="Done">
          <p>{state.notice}</p>
        </Banner>
      </div>
    );
  }
  return null;
}

/* --------------------------------------------------------------------- FC-02 */

export function LessonEditor({
  moduleId,
  lesson,
  canMoveUp,
  canMoveDown,
}: {
  moduleId: string;
  lesson?: { id: string; title: string; body: string; downloadable: boolean };
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveLesson, undefined);
  const [moveState, moveAction] = useActionState<ActionState, FormData>(moveLesson, undefined);
  useNav(state);
  const [open, setOpen] = useState(!lesson);

  if (lesson && !open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="dense" variant="secondary" onClick={() => setOpen(true)}>
          Edit
        </Button>
        {canMoveUp ? (
          <form action={moveAction}>
            <input type="hidden" name="moduleId" value={moduleId} />
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="direction" value="up" />
            <Button type="submit" size="inline" variant="tertiary">
              Move up<span className="sr-only"> — {lesson.title}</span>
            </Button>
          </form>
        ) : null}
        {canMoveDown ? (
          <form action={moveAction}>
            <input type="hidden" name="moduleId" value={moduleId} />
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="direction" value="down" />
            <Button type="submit" size="inline" variant="tertiary">
              Move down<span className="sr-only"> — {lesson.title}</span>
            </Button>
          </form>
        ) : null}
        {moveState?.error ? (
          <p className="t-body-sm m-0 font-semibold text-danger">{moveState.error}</p>
        ) : null}
      </div>
    );
  }

  const idFor = (field: string) => `${lesson?.id ?? 'new'}-${field}`;

  return (
    <form action={formAction}>
      <Feedback state={state} />
      <input type="hidden" name="moduleId" value={moduleId} />
      {lesson ? <input type="hidden" name="lessonId" value={lesson.id} /> : null}

      <Field label="Title" name="title" inputId={idFor('title')} required>
        <Input id={idFor('title')} name="title" required defaultValue={lesson?.title ?? ''} />
      </Field>

      <Field
        label="Lesson content"
        name="body"
        inputId={idFor('body')}
        required
        helper="Rendered on a reading surface in Literata. Plain paragraphs; blank lines separate them."
      >
        <Textarea id={idFor('body')} name="body" rows={10} required defaultValue={lesson?.body ?? ''} />
      </Field>

      <label className="t-body-sm mb-6 flex items-center gap-3 text-ink-900">
        <input
          type="checkbox"
          name="downloadable"
          defaultChecked={lesson?.downloadable ?? true}
          className="h-5 w-5 accent-[#6B2436]"
        />
        Students may download this for offline reading
      </label>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving' : lesson ? 'Save changes' : 'Add lesson'}
        </Button>
        {lesson ? (
          <Button type="button" size="dense" variant="tertiary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ModulePublish({
  moduleId,
  published,
  blockers,
}: {
  moduleId: string;
  published: boolean;
  blockers: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setModulePublished,
    undefined,
  );
  useNav(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="publish" value={published ? 'false' : 'true'} />
      <Button
        type="submit"
        size="dense"
        variant={published ? 'secondary' : 'primary'}
        // The blockers are listed on the page beside this, so a disabled
        // control is never the only signal (§6).
        disabled={pending || (!published && blockers.length > 0)}
        aria-busy={pending}
      >
        {pending ? 'Working' : published ? 'Unpublish' : 'Publish module'}
      </Button>
      {state?.error ? (
        <p className="t-body-sm mt-2 mb-0 font-semibold text-danger">{state.error}</p>
      ) : null}
    </form>
  );
}

/* --------------------------------------------------------------------- FC-03 */

export function GradePanel({
  submissionId,
  maxScore,
  studentName,
}: {
  submissionId: string;
  maxScore: number;
  studentName: string;
}) {
  const [outcome, setOutcome] = useState<'grade' | 'return'>('grade');
  const action = outcome === 'grade' ? gradeAndRelease : returnForRevision;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  useNav(state);

  const idFor = (field: string) => `${submissionId}-${field}`;

  return (
    <form action={formAction}>
      <Feedback state={state} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="maxScore" value={maxScore} />

      <fieldset className="m-0 mb-4 border-0 p-0">
        <legend className="t-label mb-2 p-0 text-ink-900">
          Outcome<span className="sr-only"> for {studentName}</span>
        </legend>
        {(
          [
            ['grade', 'Grade and release'],
            ['return', 'Return for revision'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="t-body-sm mb-2 flex items-center gap-3 text-ink-900">
            <input
              type="radio"
              name="outcome"
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
              className="h-5 w-5 accent-[#6B2436]"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {outcome === 'grade' ? (
        <>
          <Field label={`Score out of ${maxScore}`} name="score" inputId={idFor('score')} required>
            <Input id={idFor('score')} name="score" inputMode="numeric" required />
          </Field>
          <Field
            label="Feedback"
            name="feedback"
            inputId={idFor('feedback')}
            required
            helper="The student reads this. A bare number tells them nothing they can act on."
          >
            <Textarea id={idFor('feedback')} name="feedback" rows={5} required />
          </Field>
        </>
      ) : (
        <Field
          label="What needs to change"
          name="note"
          inputId={idFor('note')}
          required
          helper="Shown to the student verbatim, and they can attempt again."
        >
          <Textarea id={idFor('note')} name="note" rows={5} required />
        </Field>
      )}

      <Button
        type="submit"
        size="dense"
        variant={outcome === 'return' ? 'secondary' : 'primary'}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Recording' : outcome === 'grade' ? 'Grade and release' : 'Return for revision'}
      </Button>
    </form>
  );
}

/**
 * Conflict C-06. Assessment timing is essential, so WCAG 2.2.1's exception
 * applies — but leaning on the exception alone leaves a disabled student
 * with no route at all. This is the route.
 */
export function ExtraTimePanel({
  assessmentId,
  userId,
  studentName,
  existing,
}: {
  assessmentId: string;
  userId: string;
  studentName: string;
  existing: { extraMinutes: number; reason: string } | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    grantExtraTime,
    undefined,
  );
  useNav(state);
  const idFor = (field: string) => `${assessmentId}-${userId}-${field}`;

  return (
    <form action={formAction}>
      <Feedback state={state} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="userId" value={userId} />

      {existing ? (
        <p className="t-body-sm mt-0 mb-3 text-verified-text">
          {existing.extraMinutes} extra minutes already granted — {existing.reason}
        </p>
      ) : null}

      <Field
        label="Extra minutes"
        name="extraMinutes"
        inputId={idFor('minutes')}
        required
        helper="Added to the assessment's own limit, for this student only."
      >
        <Input
          id={idFor('minutes')}
          name="extraMinutes"
          inputMode="numeric"
          required
          defaultValue={existing?.extraMinutes ?? 15}
        />
      </Field>

      <Field
        label="Reason"
        name="reason"
        inputId={idFor('reason')}
        required
        helper="Enough to show the accommodation was considered. Not a diagnosis — this platform has no business holding medical detail."
      >
        <Input id={idFor('reason')} name="reason" required defaultValue={existing?.reason ?? ''} />
      </Field>

      <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Granting' : `Grant extra time to ${studentName}`}
      </Button>
    </form>
  );
}
