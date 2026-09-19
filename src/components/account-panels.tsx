'use client';

import { useActionState } from 'react';
import { Banner, Button, Field, Input, Panel } from './ui';
import type { ActionState } from './form';
import { changePassword, updateProfile } from '@/modules/auth/account-actions';

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

/** ST-14. */
export function AccountDetailsForm({
  fullName,
  phone,
  email,
  nameLocked,
}: {
  fullName: string;
  phone: string;
  email: string;
  nameLocked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateProfile,
    undefined,
  );

  return (
    <Panel title="Your details">
      <form action={formAction}>
        <Feedback state={state} />

        <Field
          label="Full name"
          name="fullName"
          inputId="account-name"
          required
          helper={
            nameLocked
              ? 'Locked while you are enrolled — this name is on your certificate.'
              : 'The name we use in letters, and the one that will appear on your certificate.'
          }
        >
          <Input
            id="account-name"
            name="fullName"
            required
            defaultValue={fullName}
            readOnly={nameLocked}
            aria-readonly={nameLocked || undefined}
          />
        </Field>

        <Field
          label="Phone number"
          name="phone"
          inputId="account-phone"
          helper="Used for admissions and payment problems. Never for marketing."
        >
          <Input id="account-phone" name="phone" type="tel" defaultValue={phone} />
        </Field>

        {/* Email is the account's identity and the route every reset uses, so
            changing it is a verification flow rather than a text input. It is
            shown because hiding what we hold would be the wrong instinct on
            exactly this page. */}
        <Field
          label="Email address"
          name="email"
          inputId="account-email"
          helper="Your sign-in address. To change it, ask the registry — the new address has to be verified before it can receive a password reset."
        >
          <Input id="account-email" name="email" defaultValue={email} readOnly aria-readonly />
        </Field>

        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving' : 'Save changes'}
        </Button>
      </form>
    </Panel>
  );
}

/** ST-14, AUTH-02. */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    changePassword,
    undefined,
  );

  return (
    <Panel title="Change your password">
      <form action={formAction}>
        <Feedback state={state} />

        <Field label="Current password" name="current" inputId="pw-current" required>
          <Input
            id="pw-current"
            name="current"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>

        <Field
          label="New password"
          name="password"
          inputId="pw-new"
          required
          helper="At least 10 characters, with a letter and a number. Length does more than symbols do."
        >
          <Input
            id="pw-new"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </Field>

        <Field label="New password again" name="confirm" inputId="pw-confirm" required>
          <Input
            id="pw-confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
          />
        </Field>

        <p className="t-body-sm mt-0 mb-5 text-ink-700">
          Changing your password signs out every other device. This one stays signed in.
        </p>

        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Changing' : 'Change password'}
        </Button>
      </form>
    </Panel>
  );
}
