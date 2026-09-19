'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select } from './ui';
import type { ActionState } from './form';
import { saveBranding, saveCohort, saveFee } from '@/modules/admin/actions';
import { checkBrandColour, PAPER, ratioText } from '@/lib/contrast';

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
        <Banner tone="verified" title="Saved">
          <p>{state.notice}</p>
        </Banner>
      </div>
    );
  }
  return null;
}

/* --------------------------------------------------------------------- IA-03 */

export function FeeEditor({
  kinds,
  intakes,
}: {
  kinds: { kind: string; label: string }[];
  intakes: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveFee, undefined);
  useNav(state);
  const [kind, setKind] = useState(kinds[0]?.kind ?? 'application');

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <Field label="Which fee" name="kind" required>
        <Select id="kind" name="kind" required value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Label candidates see"
        name="label"
        required
        helper="This wording appears on the checkout and the receipt."
      >
        <Input id="label" name="label" required defaultValue={kinds.find((k) => k.kind === kind)?.label} />
      </Field>

      <Field label="Amount in naira" name="amount" required helper="For example 25000, or 25,000.00.">
        <Input id="amount" name="amount" inputMode="decimal" required />
      </Field>

      <Field
        label="Applies to"
        name="cohortId"
        helper="Leave as all intakes unless this one differs."
      >
        <Select id="cohortId" name="cohortId" defaultValue="">
          <option value="">All intakes</option>
          {intakes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : 'Save fee'}
      </Button>
    </form>
  );
}

/* --------------------------------------------------------------------- IA-04 */

type Intake = {
  id: string;
  name: string;
  capacity: number;
  status: string;
  applicationOpensAt: string;
  applicationClosesAt: string;
  startsAt: string;
};

export function CohortEditor({ intakes }: { intakes: Intake[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveCohort, undefined);
  useNav(state);
  const [selected, setSelected] = useState('');
  const editing = intakes.find((c) => c.id === selected);

  return (
    <form action={formAction} key={selected}>
      <Feedback state={state} />

      {intakes.length > 0 ? (
        <Field label="Editing" name="cohortSelect">
          <Select
            id="cohortSelect"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">A new intake</option>
            {intakes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <input type="hidden" name="cohortId" value={selected} />

      <Field label="Name" name="name" required helper="What candidates will see, such as 'January 2027 intake'.">
        <Input id="name" name="name" required defaultValue={editing?.name ?? ''} />
      </Field>

      <Field
        label="Places"
        name="capacity"
        required
        helper="Enforced when an offer is issued, not at payment — so the cohort cannot be oversold."
      >
        <Input id="capacity" name="capacity" inputMode="numeric" required defaultValue={editing?.capacity ?? 40} />
      </Field>

      <Field label="Status" name="status" required>
        <Select id="status" name="status" required defaultValue={editing?.status ?? 'draft'}>
          <option value="draft">Draft — not visible to candidates</option>
          <option value="open">Open — accepting applications</option>
          <option value="closed">Closed — no new applications</option>
          <option value="running">Running — teaching under way</option>
          <option value="completed">Completed</option>
        </Select>
      </Field>

      <Field label="Applications open" name="applicationOpensAt">
        <Input id="applicationOpensAt" name="applicationOpensAt" type="date" defaultValue={editing?.applicationOpensAt ?? ''} />
      </Field>

      <Field label="Applications close" name="applicationClosesAt">
        <Input id="applicationClosesAt" name="applicationClosesAt" type="date" defaultValue={editing?.applicationClosesAt ?? ''} />
      </Field>

      <Field label="Teaching starts" name="startsAt">
        <Input id="startsAt" name="startsAt" type="date" defaultValue={editing?.startsAt ?? ''} />
      </Field>

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : editing ? 'Update intake' : 'Create intake'}
      </Button>
    </form>
  );
}

/* --------------------------------------------------------------------- IA-06 */

/**
 * Branding, with the live contrast check §2.5 requires.
 *
 * The check runs as you type and the save button is disabled while the colour
 * fails — conflict C-04 says block, not warn. The suggestion is offered as a
 * one-click fix, because refusing someone's colour without giving them a
 * usable alternative is just an obstacle.
 */
export function BrandingEditor({
  brandColour,
  logoUrl,
  institutionName,
}: {
  brandColour: string;
  logoUrl: string | null;
  institutionName: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveBranding, undefined);
  useNav(state);
  const [colour, setColour] = useState(brandColour);

  const check = checkBrandColour(colour);
  const preview = check.hex ?? '#000000';

  return (
    <form action={formAction}>
      <Feedback state={state} />

      <Field
        label="Brand colour"
        name="brandColour"
        required
        helper="Used in four places: the header mark, the header band, the admission letter and certificate letterhead, and your card on the platform listing."
      >
        <div className="flex items-center gap-3">
          <Input
            id="brandColour"
            name="brandColour"
            required
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="max-w-[180px]"
          />
          <input
            type="color"
            aria-label="Pick a brand colour"
            value={check.hex ?? '#000000'}
            onChange={(e) => setColour(e.target.value.toUpperCase())}
            className="h-12 w-12 cursor-pointer rounded-sm border border-ink-500 bg-surface p-1"
          />
        </div>
      </Field>

      {/* Live, before saving. The number is the same one the save validates. */}
      {check.hex ? (
        <div className="mb-6">
          {check.passes ? (
            <p className="t-body-sm m-0 text-verified-text">
              {ratioText(check.hex, PAPER)} against the page. That passes.
            </p>
          ) : (
            <Banner tone="danger" title="This colour cannot be saved">
              <p>{check.problem}</p>
              {check.suggestion ? (
                <p className="mt-2">
                  The closest passing colour to yours is{' '}
                  <strong>{check.suggestion}</strong> at {ratioText(check.suggestion, PAPER)}.{' '}
                  <button
                    type="button"
                    onClick={() => setColour(check.suggestion!)}
                    className="font-semibold text-ink-900 underline underline-offset-2"
                  >
                    Use that instead
                  </button>
                </p>
              ) : null}
            </Banner>
          )}
        </div>
      ) : null}

      <Field label="Logo URL" name="logoUrl" helper="Optional. Shown beside your name on your own pages.">
        <Input id="logoUrl" name="logoUrl" type="url" defaultValue={logoUrl ?? ''} />
      </Field>

      <div className="mb-6 rounded-md border border-ink-300 p-4">
        <p className="t-caption m-0 mb-3 text-ink-700">Preview</p>
        <div className="flex items-center gap-2">
          <span className="inline-block h-6 w-1.5" style={{ background: preview }} aria-hidden="true" />
          <span className="t-label text-ink-900">{institutionName}</span>
        </div>
        <div className="mt-4 rounded-md bg-record p-4">
          <div className="mb-2 h-1 w-20" style={{ background: preview }} aria-hidden="true" />
          <p className="t-caption m-0 text-ink-700">Admission letter letterhead</p>
        </div>
      </div>

      <Button type="submit" size="dense" disabled={pending || !check.passes} aria-busy={pending}>
        {pending ? 'Saving' : 'Save branding'}
      </Button>
      {!check.passes ? (
        <p className="t-body-sm mt-3 mb-0 text-ink-700">
          Saving is blocked until the colour passes. This is not a warning that can be dismissed —
          the platform&apos;s accessibility compliance cannot depend on a colour choice.
        </p>
      ) : null}
    </form>
  );
}
