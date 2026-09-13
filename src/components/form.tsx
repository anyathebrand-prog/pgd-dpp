'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Banner, Button } from './ui';

/**
 * `redirectTo` exists because `redirect()` does not work from an action driven
 * by `useActionState`: the action runs and its writes commit, but the client
 * router settles on `/` instead of the target. A plain `<form action={fn}>`
 * redirects correctly, so only the actions wired through this component are
 * affected. Those return their destination as state and let the component
 * navigate, which also keeps redirect and error handling on one path.
 */
export type ActionState =
  | { error?: string; notice?: string; redirectTo?: string }
  | undefined;
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
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<Record<string, string> | null>(null);

  /**
   * React 19 resets an uncontrolled form once its action resolves. That is
   * right after a success — the form is done — and badly wrong after a
   * validation error, where it silently erases everything the person typed
   * and leaves them looking at "Enter your date of birth" over an empty
   * eight-field form. So the values are captured on the way in and put back
   * when the action came back with an error.
   */
  const keepValues = async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const values: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') values[key] = value;
    }
    submitted.current = values;
    return action(prev, form);
  };

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    keepValues,
    undefined,
  );
  const router = useRouter();
  const blocked = (outstanding?.length ?? 0) > 0;

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  useEffect(() => {
    if (!state?.error || !submitted.current || !formRef.current) return;
    for (const element of Array.from(formRef.current.elements)) {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLSelectElement)
      ) {
        continue;
      }
      const previous = submitted.current[element.name];
      // A file input cannot be set programmatically, and re-filling a
      // password box from memory is not something to do on a failed submit.
      if (element instanceof HTMLInputElement) {
        if (element.type === 'file' || element.type === 'password') continue;
        if (element.type === 'checkbox' || element.type === 'radio') {
          // A checkbox submits its value (default "on") only when checked, and
          // a radio group submits the one that was chosen — so equality here
          // restores both correctly, and an absent key means unchecked.
          element.checked = previous !== undefined && previous === element.value;
          continue;
        }
      }
      if (previous !== undefined) element.value = previous;
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} noValidate>
      {/*
        This wrapper always renders, even when there is nothing to say.
        Conditionally inserting a sibling BEFORE the fields changes their
        position in the tree, React remounts them, and every uncontrolled
        input resets — so a validation error would silently erase everything
        the person had typed, which is the worst possible moment to do it.
      */}
      <div>
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
      </div>

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
    // A single control, so it takes a real <label for>. A <legend> names the
    // fieldset rather than the input inside it, which leaves the field itself
    // with no accessible name — it reads as "edit text, blank" to a screen
    // reader, on the one screen where getting the value right matters most.
    <div>
      <label htmlFor={name} className="t-label mb-2 block text-ink-900">
        {label}
      </label>
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
    </div>
  );
}
