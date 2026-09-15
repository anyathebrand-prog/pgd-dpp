'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select } from './ui';
import type { ActionState } from './form';
import { attestAccess, inviteStaff, revokeRole } from '@/modules/admin/staff';
import { GRANTABLE, ROLE_COPY, type GrantableRole } from '@/modules/admin/staff-roles';

/** IA-05 — granting a role, and inviting the person if they are new. */
export function InviteForm({ institutionName }: { institutionName: string }) {
  const router = useRouter();
  const [role, setRole] = useState<GrantableRole>('registry');
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    inviteStaff,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not granted">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Their name" name="fullName" inputId="staff-name" required>
        <Input id="staff-name" name="fullName" required autoComplete="off" />
      </Field>

      <Field
        label="Their work email"
        name="email"
        inputId="staff-email"
        required
        helper="The invitation goes here, and it is the address they sign in with."
      >
        <Input id="staff-email" name="email" type="email" required autoComplete="off" />
      </Field>

      <Field label="Role" name="role" inputId="staff-role" required>
        <Select
          id="staff-role"
          name="role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value as GrantableRole)}
        >
          {GRANTABLE.map((r) => (
            <option key={r} value={r}>
              {ROLE_COPY[r].label}
            </option>
          ))}
        </Select>
      </Field>

      {/* What the role can reach, before it is handed out rather than after.
          §5.2 progressive disclosure: one role's scope, the one selected. */}
      <div className="mb-6 rounded-sm border border-ink-300 p-4">
        <p className="t-body-sm m-0 text-ink-700">{ROLE_COPY[role].scope}</p>
        {ROLE_COPY[role].mfa ? (
          <p className="t-caption mt-2 mb-0 text-ink-700">
            This role requires an authenticator app. They set it up on first sign-in and cannot
            open the console until they do.
          </p>
        ) : null}
      </div>

      <p className="t-body-sm mt-0 mb-4 text-ink-700">
        They receive an activation link at {institutionName} and choose their own password. Nobody
        here ever sees it.
      </p>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Granting' : 'Grant access'}
      </Button>
    </form>
  );
}

/**
 * Removing a role. Two steps, because it is destructive and immediate — the
 * person's open sessions end with it — and a single click next to a name in a
 * list is too easy to hit by accident.
 */
export function RevokeRole({
  userId,
  role,
  name,
  roleLabel,
  lastAdmin,
}: {
  userId: string;
  role: GrantableRole;
  name: string;
  roleLabel: string;
  lastAdmin: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    revokeRole,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  /*
   * Not a disabled button. §6: a disabled control with no explanation fails
   * WCAG 3.3.1, and here the explanation is the whole point — there is
   * something the administrator can do about it.
   */
  if (lastAdmin) {
    return (
      <p className="t-body-sm m-0 max-w-[280px] text-ink-700">
        <span aria-hidden="true">▲ </span>
        The last administrator. Appoint another one before removing this.
      </p>
    );
  }

  if (!asking) {
    return (
      <Button type="button" size="dense" variant="secondary" onClick={() => setAsking(true)}>
        Remove
      </Button>
    );
  }

  return (
    <div className="max-w-[320px]">
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-2 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}
      <p className="t-body-sm mt-0 mb-2 text-ink-700">
        Remove {roleLabel} from {name}? Any session they have open here ends immediately.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={formAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="role" value={role} />
          <Button type="submit" size="dense" variant="danger" disabled={pending} aria-busy={pending}>
            {pending ? 'Removing' : 'Remove it'}
          </Button>
        </form>
        <Button type="button" size="dense" variant="tertiary" onClick={() => setAsking(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** CMP-17 quarterly re-attestation. */
export function AttestForm({ count }: { count: number }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    attestAccess,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-3 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}

      <label htmlFor="attest-confirmed" className="t-body-sm mb-4 flex items-start gap-3 text-ink-900">
        <input
          id="attest-confirmed"
          name="confirmed"
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 rounded-sm border border-ink-500"
        />
        <span>
          I have read the {count} {count === 1 ? 'person' : 'people'} listed here and each still
          needs the access they hold.
        </span>
      </label>

      <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Recording' : 'Record the review'}
      </Button>
    </form>
  );
}
