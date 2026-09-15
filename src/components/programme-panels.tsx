'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select, Textarea, cx } from './ui';
import type { ActionState } from './form';
import {
  addModule,
  moveModule,
  removeModule,
  saveGradingScheme,
  saveProgramme,
  updateModule,
} from '@/modules/admin/programme';
import type { Band } from '@/lib/grading';

type Facilitator = { id: string; name: string | null; email: string };

/** Every form here navigates on success, per the redirectTo contract. */
function useNavigatingAction(action: (prev: ActionState, form: FormData) => Promise<ActionState>) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);
  return { state, formAction, pending };
}

function Problem({ state, title }: { state: ActionState; title: string }) {
  if (!state?.error) return null;
  return (
    <div className="mb-4">
      <Banner tone="danger" title={title}>
        <p>{state.error}</p>
      </Banner>
    </div>
  );
}

function FacilitatorSelect({
  id,
  facilitators,
  defaultValue,
}: {
  id: string;
  facilitators: Facilitator[];
  defaultValue?: string | null;
}) {
  return (
    <Select id={id} name="facilitatorId" defaultValue={defaultValue ?? ''}>
      <option value="">Nobody yet</option>
      {facilitators.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name ?? f.email}
        </option>
      ))}
    </Select>
  );
}

/** The programme record — what PB-03 and the landing page render. */
export function ProgrammeForm({
  programme,
}: {
  programme: {
    title: string;
    summary: string | null;
    entryRequirements: string | null;
    durationMonths: number;
  };
}) {
  const { state, formAction, pending } = useNavigatingAction(saveProgramme);

  return (
    <form action={formAction}>
      <Problem state={state} title="Not saved" />

      <Field label="Title" name="title" inputId="programme-title" required>
        <Input id="programme-title" name="title" required defaultValue={programme.title} />
      </Field>

      <Field
        label="Summary"
        name="summary"
        inputId="programme-summary"
        helper="One paragraph. It appears above the fold on your programme page."
      >
        <Textarea id="programme-summary" name="summary" defaultValue={programme.summary ?? ''} />
      </Field>

      <Field
        label="Entry requirements"
        name="entryRequirements"
        inputId="programme-entry"
        required
        helper="Who may apply. Candidates read this before paying an application fee."
      >
        <Textarea
          id="programme-entry"
          name="entryRequirements"
          defaultValue={programme.entryRequirements ?? ''}
        />
      </Field>

      <Field label="Duration in months" name="durationMonths" inputId="programme-duration" required>
        <Input
          id="programme-duration"
          name="durationMonths"
          type="number"
          min={3}
          max={60}
          required
          defaultValue={programme.durationMonths}
        />
      </Field>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : 'Save the programme'}
      </Button>
    </form>
  );
}

/**
 * The bands. Rows are added and removed in the browser and posted as parallel
 * `bandLabel`/`bandMin` fields; a row emptied of both is how one is deleted.
 */
export function GradingSchemeForm({ bands }: { bands: Band[] }) {
  const { state, formAction, pending } = useNavigatingAction(saveGradingScheme);
  const [rows, setRows] = useState<Band[]>(bands);

  return (
    <form action={formAction}>
      <Problem state={state} title="Scheme not saved" />

      <ul className="m-0 mb-4 grid list-none gap-3 p-0">
        {rows.map((band, i) => (
          <li key={i} className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor={`band-label-${i}`} className="t-label mb-2 block text-ink-900">
                Band {i + 1}
              </label>
              <Input
                id={`band-label-${i}`}
                name="bandLabel"
                defaultValue={band.label}
                aria-label={`Name of band ${i + 1}`}
              />
            </div>
            <div className="w-[110px]">
              <label htmlFor={`band-min-${i}`} className="t-label mb-2 block text-ink-900">
                From %
              </label>
              <Input
                id={`band-min-${i}`}
                name="bandMin"
                type="number"
                min={0}
                max={100}
                defaultValue={band.minPercent}
                aria-label={`Lowest percentage in band ${i + 1}`}
              />
            </div>
            <Button
              type="button"
              size="dense"
              variant="tertiary"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label={`Remove band ${band.label || i + 1}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="dense"
          variant="secondary"
          onClick={() => setRows([...rows, { minPercent: 0, label: '' }])}
        >
          Add a band
        </Button>
        <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving' : 'Save the scheme'}
        </Button>
      </div>
    </form>
  );
}

/** A new module in a semester. */
export function AddModuleForm({
  facilitators,
  semesters,
}: {
  facilitators: Facilitator[];
  semesters: number[];
}) {
  const { state, formAction, pending } = useNavigatingAction(addModule);
  const next = semesters.length > 0 ? Math.max(...semesters) : 1;

  return (
    <form action={formAction}>
      <Problem state={state} title="Not added" />

      <div className="grid gap-x-6 md:grid-cols-[160px_1fr]">
        <Field
          label="Code"
          name="code"
          inputId="module-code"
          required
          helper="DPP 501."
        >
          <Input id="module-code" name="code" required placeholder="DPP 501" />
        </Field>
        <Field label="Title" name="title" inputId="module-title" required>
          <Input id="module-title" name="title" required placeholder="Data Subject Rights" />
        </Field>
      </div>

      <Field
        label="Summary"
        name="summary"
        inputId="module-summary"
        helper="What the module covers, for the student choosing what to read next."
      >
        <Textarea id="module-summary" name="summary" rows={3} />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Semester" name="semester" inputId="module-semester" required>
          <Input
            id="module-semester"
            name="semester"
            type="number"
            min={1}
            max={8}
            required
            defaultValue={next}
          />
        </Field>
        <Field
          label="Facilitator"
          name="facilitatorId"
          inputId="module-facilitator"
          helper="Whoever holds it can add lessons, mark work and publish it."
        >
          <FacilitatorSelect id="module-facilitator" facilitators={facilitators} />
        </Field>
      </div>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Adding' : 'Add the module'}
      </Button>
    </form>
  );
}

/** One module: what it holds, who teaches it, and where it sits. */
export function ModuleRow({
  module,
  facilitators,
  first,
  last,
}: {
  module: {
    id: string;
    code: string;
    title: string;
    summary: string | null;
    semester: number;
    published: boolean;
    facilitatorId: string | null;
    lessons: number;
    assessments: number;
  };
  facilitators: Facilitator[];
  first: boolean;
  last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const edit = useNavigatingAction(updateModule);
  const move = useNavigatingAction(moveModule);
  const remove = useNavigatingAction(removeModule);

  const facilitator = facilitators.find((f) => f.id === module.facilitatorId);

  return (
    <div>
      <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
        <div>
          <dt className="t-caption m-0 text-ink-700">Facilitator</dt>
          <dd
            className={cx(
              't-body-sm m-0 ml-0',
              facilitator ? 'text-ink-900' : 'text-warning',
            )}
          >
            {facilitator ? (facilitator.name ?? facilitator.email) : 'Nobody'}
          </dd>
        </div>
        <div>
          <dt className="t-caption m-0 text-ink-700">Lessons</dt>
          <dd className="t-data m-0 ml-0 text-ink-900">{module.lessons}</dd>
        </div>
        <div>
          <dt className="t-caption m-0 text-ink-700">Assessments</dt>
          <dd className="t-data m-0 ml-0 text-ink-900">{module.assessments}</dd>
        </div>
      </dl>

      {module.summary && !editing ? (
        <p className="t-body-sm measure mt-0 mb-4 text-ink-700">{module.summary}</p>
      ) : null}

      {editing ? (
        <form action={edit.formAction} className="mb-4">
          <Problem state={edit.state} title="Not updated" />
          <input type="hidden" name="moduleId" value={module.id} />

          <Field label="Title" name="title" inputId={`edit-title-${module.id}`} required>
            <Input
              id={`edit-title-${module.id}`}
              name="title"
              required
              defaultValue={module.title}
            />
          </Field>
          <Field label="Summary" name="summary" inputId={`edit-summary-${module.id}`}>
            <Textarea
              id={`edit-summary-${module.id}`}
              name="summary"
              rows={3}
              defaultValue={module.summary ?? ''}
            />
          </Field>
          <div className="grid gap-x-6 md:grid-cols-2">
            <Field label="Semester" name="semester" inputId={`edit-semester-${module.id}`} required>
              <Input
                id={`edit-semester-${module.id}`}
                name="semester"
                type="number"
                min={1}
                max={8}
                required
                defaultValue={module.semester}
              />
            </Field>
            <Field label="Facilitator" name="facilitatorId" inputId={`edit-fac-${module.id}`}>
              <FacilitatorSelect
                id={`edit-fac-${module.id}`}
                facilitators={facilitators}
                defaultValue={module.facilitatorId}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="dense" disabled={edit.pending} aria-busy={edit.pending}>
              {edit.pending ? 'Saving' : 'Save changes'}
            </Button>
            <Button
              type="button"
              size="dense"
              variant="tertiary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="dense" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>

          {!first ? (
            <form action={move.formAction}>
              <input type="hidden" name="moduleId" value={module.id} />
              <input type="hidden" name="direction" value="up" />
              <Button type="submit" size="dense" variant="tertiary" disabled={move.pending}>
                Move up
              </Button>
            </form>
          ) : null}

          {!last ? (
            <form action={move.formAction}>
              <input type="hidden" name="moduleId" value={module.id} />
              <input type="hidden" name="direction" value="down" />
              <Button type="submit" size="dense" variant="tertiary" disabled={move.pending}>
                Move down
              </Button>
            </form>
          ) : null}

          {module.lessons === 0 && module.assessments === 0 && !module.published ? (
            confirming ? (
              <form action={remove.formAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="moduleId" value={module.id} />
                <span className="t-body-sm text-ink-700">Remove {module.code}?</span>
                <Button
                  type="submit"
                  size="dense"
                  variant="danger"
                  disabled={remove.pending}
                  aria-busy={remove.pending}
                >
                  {remove.pending ? 'Removing' : 'Remove it'}
                </Button>
                <Button
                  type="button"
                  size="dense"
                  variant="tertiary"
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                size="dense"
                variant="tertiary"
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
            )
          ) : null}
        </div>
      )}

      {remove.state?.error ? (
        <p className="t-body-sm mt-3 mb-0 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {remove.state.error}
        </p>
      ) : null}
      {move.state?.error ? (
        <p className="t-body-sm mt-3 mb-0 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {move.state.error}
        </p>
      ) : null}
    </div>
  );
}
