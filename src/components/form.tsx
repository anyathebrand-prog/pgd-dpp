'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Banner, Button } from './ui';

export type ActionState = { error?: string; notice?: string } | undefined;
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The one client component the auth and application forms need.
 *
 * §6 loading state: the label is replaced by an indeterminate bar and the
 * width is locked, so the button does not reflow mid-submit — a candidate on a
 * slow connection watching a button change size reads it as a failure.
 *
 * The submit button carries the verb of the outcome (§1.4): "Submit and pay",
 * not "Continue". Callers pass that label.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  secondary,
  outstanding,
}: {
  action: Action;
  submitLabel: string;
  children: ReactNode;
  secondary?: ReactNode;
  /**
   * §6: disabled is the most abused state in this product. A disabled submit
   * with no explanation fails WCAG 3.3.1, so passing a non-empty list here
   * disables the button AND renders exactly what is outstanding, each item a
   * jump link. Passing nothing leaves the button enabled.
   */
  outstanding?: { label: string; href: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const blocked = (outstanding?.length ?? 0) > 0;

  return (
    <form action={formAction} noValidate>
      {state?.error ? (
        <div className="mb-6">
          <Banner tone="danger" title="This could not be saved">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-6">
          <Banner tone="info">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      {children}

      {blocked ? (
        <div className="mb-6">
          <Banner tone="warning" title="Still outstanding">
            <ul className="m-0 list-disc pl-5">
              {outstanding!.map((o) => (
                <li key={o.href}>
                  <a href={o.href} className="text-ink-900 underline underline-offset-2">
                    {o.label}
                  </a>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : null}

      {/* §4.1: 64px before the action bar. */}
      <div className="mt-16 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || blocked} aria-busy={pending} className="min-w-[180px]">
          {pending ? (
            <span className="bar-indeterminate block h-1 w-24 overflow-hidden bg-surface/30">
              <span className="sr-only">Working</span>
            </span>
          ) : (
            submitLabel
          )}
        </Button>
        {secondary}
      </div>
    </form>
  );
}

/**
 * AU-02 / AU-08 code field: six cells, Plex Mono, auto-advance, and paste of
 * the whole code into the first cell works — which is what people actually do
 * when the code is sitting in an email on the same phone.
 */
export function CodeField({ name = 'code', label }: { name?: string; label: string }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="t-label mb-2 p-0 text-ink-900">{label}</legend>
      <input
        id={name}
        name={name}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        aria-describedby={`${name}-helper`}
        className="t-data-lg h-14 w-full max-w-[260px] rounded-sm border border-ink-500 bg-surface px-3 text-center tracking-[0.5em]"
      />
      <p id={`${name}-helper`} className="t-body-sm mt-1.5 text-ink-500">
        Six digits. It expires 15 minutes after it was sent.
      </p>
    </fieldset>
  );
}
