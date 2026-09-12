'use client';

import { useActionState } from 'react';
import { Button, cx } from './ui';
import type { ActionState } from './form';

/**
 * AP-05 document slot (§5.5).
 *
 * A Manila tile — it is a filed artefact, or the space where one will be — with
 * a 2px dashed ink-500 border when empty. States: empty, uploading, complete,
 * rejected with the specific reason, and queried with a warning left rule and
 * the registry officer's note verbatim.
 *
 * The rejection reason is always specific ("that file is 7.2MB, the limit is
 * 5MB"), never "upload failed". A candidate photographing a transcript on a
 * phone needs to know which thing to do differently.
 */
export function DocumentSlot({
  action,
  kind,
  label,
  hint,
  existing,
  query,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  kind: string;
  label: string;
  hint: string;
  existing?: { filename: string; sizeBytes: number; scanStatus: string } | null;
  query?: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const inputId = `file-${kind}`;

  return (
    <li
      className={cx(
        'rounded-md bg-record p-5',
        query ? 'border-l-[3px] border-l-warning' : '',
        !existing && !query ? 'border-2 border-dashed border-ink-500 bg-transparent' : '',
      )}
    >
      <div className="mb-3 h-0.5 w-12 bg-authority" aria-hidden="true" />
      <h3 className="t-h4 m-0 text-ink-900">{label}</h3>

      {query ? (
        <p className="t-body-sm mt-2 mb-0 font-semibold text-ink-900">
          <span aria-hidden="true">▲ </span>
          The registry asked for this again: {query}
        </p>
      ) : null}

      {existing ? (
        <p className="t-body-sm mt-2 mb-0 text-ink-700">
          {existing.filename} · {(existing.sizeBytes / 1024).toFixed(0)}KB ·{' '}
          {existing.scanStatus === 'clean'
            ? 'checked and on file'
            : existing.scanStatus === 'infected'
              ? 'rejected by the virus scan — upload a different file'
              : 'waiting to be checked'}
        </p>
      ) : (
        <p className="t-body-sm mt-2 mb-0 text-ink-700">{hint} · PDF, JPG or PNG · up to 5MB</p>
      )}

      {state?.error ? (
        <p className="t-body-sm mt-3 mb-0 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="kind" value={kind} />
        <input
          id={inputId}
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          required
          aria-label={`${label} file`}
          className="t-body-sm max-w-full flex-1 file:mr-3 file:rounded-sm file:border file:border-ink-500 file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-semibold"
        />
        <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
          {pending ? 'Uploading' : existing ? 'Replace' : 'Upload'}
        </Button>
      </form>
    </li>
  );
}
