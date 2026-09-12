'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui';
import type { ActionState } from './form';

/**
 * A single-button form whose action navigates.
 *
 * The rule in this codebase is: **server actions never call `redirect()`** —
 * they return `redirectTo` and the client navigates. `redirect()` from an
 * action is unreliable here (the write commits, then the router settles on
 * `/`), and having two mechanisms means remembering which screens use which.
 * One rule, applied everywhere, is worth more than the shorter code.
 *
 * `ActionForm` does this for multi-field forms; this is the same contract for
 * the one-button case — "Submit and pay", "Accept and pay", "Mark complete".
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = 'primary',
  size = 'default',
  disabled,
  className,
  hidden,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'default' | 'dense';
  disabled?: boolean;
  className?: string;
  /** Extra values posted with the action. */
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state?.error ? (
        <p className="t-body-sm mb-3 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant={variant} size={size} disabled={disabled || pending} aria-busy={pending}>
        {pending ? (pendingLabel ?? label) : label}
      </Button>
    </form>
  );
}
