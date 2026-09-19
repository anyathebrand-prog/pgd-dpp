'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select, Textarea } from './ui';
import type { ActionState } from './form';
import { addRecording, joinSession, saveSession } from '@/modules/learning/sessions';

/**
 * ST-11 — joining a live session (LRN-07, LRN-10).
 *
 * The join link is never rendered on the page. It is returned by the action
 * that records attendance, so being handed the link and being recorded as
 * having been handed it are the same event. A printed link plus a separate
 * "I attended" button would let either happen without the other, and an
 * accreditation file full of people who clicked a button is worth nothing.
 */
export function JoinButton({ sessionId, label }: { sessionId: string; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    joinSession,
    undefined,
  );

  useEffect(() => {
    // A full navigation, not router.push: the destination is Zoom or Meet,
    // and the App Router has no business trying to render it.
    if (state?.redirectTo) window.location.href = state.redirectTo;
  }, [state?.redirectTo]);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-3 font-semibold text-danger">{state.error}</p>
      ) : null}
      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Opening' : label}
      </Button>
    </form>
  );
}

/** FC — scheduling one (LRN-07). */
export function SessionForm({
  cohorts,
  session,
}: {
  cohorts: { id: string; name: string }[];
  session?: {
    id: string;
    title: string;
    description: string;
    joinUrl: string;
    cohortId: string | null;
    startsAtLocal: string;
    durationMinutes: number;
  };
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveSession,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  const idFor = (field: string) => `session-${session?.id ?? 'new'}-${field}`;

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not scheduled">
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

      {session ? <input type="hidden" name="sessionId" value={session.id} /> : null}

      <Field label="Title" name="title" inputId={idFor('title')} required>
        <Input id={idFor('title')} name="title" required defaultValue={session?.title ?? ''} />
      </Field>

      <Field
        label="Join link"
        name="joinUrl"
        inputId={idFor('url')}
        required
        helper="From Zoom, Meet or Teams. Students never see this link on a page — they are handed it when they join, which is also how attendance is recorded."
      >
        <Input id={idFor('url')} name="joinUrl" required defaultValue={session?.joinUrl ?? ''} />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Starts" name="startsAt" inputId={idFor('starts')} required>
          <Input
            id={idFor('starts')}
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={session?.startsAtLocal ?? ''}
          />
        </Field>
        <Field label="Minutes" name="durationMinutes" inputId={idFor('duration')} required>
          <Input
            id={idFor('duration')}
            name="durationMinutes"
            inputMode="numeric"
            required
            defaultValue={session?.durationMinutes ?? 60}
          />
        </Field>
      </div>

      <Field
        label="Cohort"
        name="cohortId"
        inputId={idFor('cohort')}
        helper="Leave blank for everyone at this institution."
      >
        <Select id={idFor('cohort')} name="cohortId" defaultValue={session?.cohortId ?? ''}>
          <option value="">Every cohort</option>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="What it covers" name="description" inputId={idFor('description')}>
        <Textarea
          id={idFor('description')}
          name="description"
          rows={3}
          defaultValue={session?.description ?? ''}
        />
      </Field>

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : session ? 'Save changes' : 'Schedule it'}
      </Button>
    </form>
  );
}

/** A recording link, after the fact. */
export function RecordingForm({ sessionId, url }: { sessionId: string; url: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addRecording,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Field
        label="Recording link"
        name="recordingUrl"
        inputId={`rec-${sessionId}`}
        helper="Optional. Clear the field to remove it."
      >
        <Input id={`rec-${sessionId}`} name="recordingUrl" defaultValue={url} />
      </Field>
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-3 font-semibold text-danger">{state.error}</p>
      ) : null}
      <Button type="submit" size="dense" variant="secondary" disabled={pending}>
        {pending ? 'Saving' : 'Save the recording link'}
      </Button>
    </form>
  );
}
