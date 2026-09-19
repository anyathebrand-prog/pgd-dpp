'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Panel, Select, Textarea } from './ui';
import type { ActionState } from './form';
import {
  deleteQuestion,
  saveAssessment,
  saveQuestion,
  setAssessmentPublished,
} from '@/modules/teaching/assessment-actions';

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
        <Banner tone="verified" title="Saved">
          <p>{state.notice}</p>
        </Banner>
      </div>
    );
  }
  return null;
}

/** FC-02 — the paper's own settings. */
export function AssessmentForm({
  moduleId,
  assessment,
  locked,
}: {
  moduleId: string;
  assessment?: {
    id: string;
    title: string;
    kind: 'quiz' | 'assignment';
    instructions: string;
    timeLimitMinutes: number | null;
    attemptLimit: number;
    passMark: number;
  };
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveAssessment,
    undefined,
  );
  /*
   * Prefixed, because ids are page-wide and this form shares a page with the
   * lesson editor — which also has a "Title" field and also falls back to
   * "new" for a record that does not exist yet. Two inputs with id="new-title"
   * means both labels point at whichever came first, so clicking the
   * assessment's label focuses the lesson's box. A real screen-reader failure,
   * not a cosmetic one.
   */
  const idFor = (field: string) => `assessment-${assessment?.id ?? 'new'}-${field}`;

  return (
    <form action={formAction}>
      <Feedback state={state} />
      <input type="hidden" name="moduleId" value={moduleId} />
      {assessment ? <input type="hidden" name="assessmentId" value={assessment.id} /> : null}

      <Field label="Title" name="title" inputId={idFor('title')} required>
        <Input id={idFor('title')} name="title" required defaultValue={assessment?.title ?? ''} />
      </Field>

      <Field
        label="Type"
        name="kind"
        inputId={idFor('kind')}
        required
        helper="A quiz is answered here and marked partly by machine. An assignment is a file a student uploads for you to read."
      >
        <Select id={idFor('kind')} name="kind" required defaultValue={assessment?.kind ?? 'quiz'}>
          <option value="quiz">Quiz</option>
          <option value="assignment">Assignment</option>
        </Select>
      </Field>

      <Field
        label="Instructions"
        name="instructions"
        inputId={idFor('instructions')}
        helper="Shown before the student starts. Say what is allowed — notes, the Act, a calculator."
      >
        <Textarea
          id={idFor('instructions')}
          name="instructions"
          rows={3}
          defaultValue={assessment?.instructions ?? ''}
        />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-3">
        <Field
          label="Time limit"
          name="timeLimitMinutes"
          inputId={idFor('time')}
          helper="Minutes. Blank for none."
        >
          <Input
            id={idFor('time')}
            name="timeLimitMinutes"
            inputMode="numeric"
            defaultValue={assessment?.timeLimitMinutes ?? ''}
            readOnly={locked}
            aria-readonly={locked || undefined}
          />
        </Field>
        <Field label="Attempts allowed" name="attemptLimit" inputId={idFor('attempts')} required>
          <Input
            id={idFor('attempts')}
            name="attemptLimit"
            inputMode="numeric"
            required
            defaultValue={assessment?.attemptLimit ?? 1}
          />
        </Field>
        <Field label="Pass mark" name="passMark" inputId={idFor('pass')} required helper="Percent.">
          <Input
            id={idFor('pass')}
            name="passMark"
            inputMode="numeric"
            required
            defaultValue={assessment?.passMark ?? 50}
            readOnly={locked}
            aria-readonly={locked || undefined}
          />
        </Field>
      </div>

      {locked ? (
        <div className="mb-6">
          {/* Not a greyed-out box with no explanation: §6 treats that as the
              most abused state in the product. */}
          <Banner tone="info" title="Some of this is fixed now">
            <p>
              Students have already sat this paper. The title and instructions can still be
              corrected, but the time limit and pass mark cannot — changing them would re-decide an
              outcome people have already been told.
            </p>
          </Banner>
        </div>
      ) : null}

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : assessment ? 'Save changes' : 'Create assessment'}
      </Button>
    </form>
  );
}

/** FC-02 — publish, with the blockers stated rather than implied. */
export function AssessmentPublish({
  assessmentId,
  published,
  blockers,
}: {
  assessmentId: string;
  published: boolean;
  blockers: string[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setAssessmentPublished,
    undefined,
  );

  // Publishing changes what the rest of the page says about this paper, and
  // the button itself swaps between Publish and Unpublish. Without the refresh
  // the only thing that moves is a banner, which reads as "nothing happened".
  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="publish" value={published ? 'false' : 'true'} />

      {blockers.length > 0 && !published ? (
        <div className="mb-4">
          <Banner tone="warning" title="Not ready to publish">
            <ul className="m-0 list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : null}

      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not published">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-4">
          <Banner tone="verified" title="Done">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <Button
        type="submit"
        size="dense"
        variant={published ? 'secondary' : 'primary'}
        disabled={pending || (!published && blockers.length > 0)}
        aria-busy={pending}
      >
        {pending ? 'Working' : published ? 'Unpublish' : 'Publish to students'}
      </Button>
    </form>
  );
}

/** FC-02 — one question. */
export function QuestionEditor({
  assessmentId,
  question,
  locked,
}: {
  assessmentId: string;
  question?: {
    id: string;
    kind: 'mcq' | 'true_false' | 'short_answer';
    prompt: string;
    options: { key: string; text: string }[];
    correctAnswer: string | null;
    marks: number;
  };
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveQuestion,
    undefined,
  );
  const [removeState, removeAction] = useActionState<ActionState, FormData>(
    deleteQuestion,
    undefined,
  );
  const [kind, setKind] = useState(question?.kind ?? 'mcq');
  const [open, setOpen] = useState(!question);

  // Prefixed for the same reason the assessment form's ids are.
  const idFor = (field: string) => `question-${question?.id ?? 'new'}-${field}`;

  if (question && !open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="dense" variant="secondary" onClick={() => setOpen(true)}>
          Edit
        </Button>
        {locked ? null : (
          <form action={removeAction}>
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="questionId" value={question.id} />
            <Button type="submit" size="inline" variant="tertiary">
              Remove<span className="sr-only"> — {question.prompt.slice(0, 40)}</span>
            </Button>
          </form>
        )}
        {removeState?.error ? (
          <p className="t-body-sm m-0 font-semibold text-danger">{removeState.error}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction}>
      <Feedback state={state} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {question ? <input type="hidden" name="questionId" value={question.id} /> : null}

      <Field label="Question" name="prompt" inputId={idFor('prompt')} required>
        <Textarea
          id={idFor('prompt')}
          name="prompt"
          rows={3}
          required
          defaultValue={question?.prompt ?? ''}
        />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Type" name="kind" inputId={idFor('kind')} required>
          <Select
            id={idFor('kind')}
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="mcq">Multiple choice</option>
            <option value="true_false">True or false</option>
            <option value="short_answer">Short answer</option>
          </Select>
        </Field>
        <Field label="Marks" name="marks" inputId={idFor('marks')} required>
          <Input
            id={idFor('marks')}
            name="marks"
            inputMode="numeric"
            required
            defaultValue={question?.marks ?? 1}
          />
        </Field>
      </div>

      {kind === 'mcq' ? (
        <fieldset className="m-0 mb-6 border-0 p-0">
          <legend className="t-label mb-2 p-0 text-ink-900">
            Options — fill at least two, and mark the correct one
          </legend>
          {(['a', 'b', 'c', 'd'] as const).map((key) => (
            <div key={key} className="mb-3 flex items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correctAnswer"
                  value={key}
                  defaultChecked={question?.correctAnswer === key}
                  className="h-6 w-6 accent-[#6B2436]"
                />
                <span className="sr-only">Option {key.toUpperCase()} is correct</span>
              </label>
              <Input
                name={`option_${key}`}
                aria-label={`Option ${key.toUpperCase()}`}
                placeholder={`Option ${key.toUpperCase()}`}
                defaultValue={question?.options.find((o) => o.key === key)?.text ?? ''}
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      {kind === 'true_false' ? (
        <Field label="The statement is" name="correctAnswer" inputId={idFor('tf')} required>
          <Select
            id={idFor('tf')}
            name="correctAnswer"
            required
            defaultValue={question?.correctAnswer ?? 'true'}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </Select>
        </Field>
      ) : null}

      {kind === 'short_answer' ? (
        <div className="mb-6">
          <Banner tone="info" title="You will mark this one yourself">
            <p>
              Short answers go to your grading queue. There is deliberately no model answer field —
              a stored &ldquo;correct&rdquo; string turns into an auto-marker that fails anyone who
              phrased it differently.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving' : question ? 'Save question' : 'Add question'}
        </Button>
        {question ? (
          <Button type="button" size="dense" variant="tertiary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** The wrapper the page uses for the "add a question" panel. */
export function AddQuestion({ assessmentId, locked }: { assessmentId: string; locked: boolean }) {
  if (locked) {
    return (
      <Panel title="Add a question">
        <Banner tone="info" title="This paper is closed to changes">
          <p>
            Students have answered it. Every grade already given is a mark out of these questions,
            so adding, editing or removing one would change what those marks were out of. Create a
            new assessment instead.
          </p>
        </Banner>
      </Panel>
    );
  }

  return (
    <Panel title="Add a question">
      <QuestionEditor assessmentId={assessmentId} locked={false} />
    </Panel>
  );
}
