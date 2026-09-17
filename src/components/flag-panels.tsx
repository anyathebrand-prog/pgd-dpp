'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select } from './ui';
import type { ActionState } from './form';
import { setInstitutionFlag, setPlatformFlag } from '@/modules/admin/flags';

/** The platform-wide switch — the one that turns a feature off for everybody. */
export function PlatformSwitch({
  flagKey,
  label,
  enabled,
}: {
  flagKey: string;
  label: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setPlatformFlag,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-2 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="dense"
        variant={enabled ? 'secondary' : 'primary'}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Changing' : enabled ? `Turn ${label} off everywhere` : `Turn ${label} on`}
      </Button>
    </form>
  );
}

/**
 * One institution's setting for one flag.
 *
 * Three values, not a checkbox: on, off, and inherit. A checkbox cannot say
 * "follow the platform", and without that a rollout has to guess what every
 * institution wanted the moment the platform default changes.
 */
export function InstitutionFlag({
  flagKey,
  institutionId,
  institutionName,
  label,
  value,
  resolved,
}: {
  flagKey: string;
  institutionId: string;
  institutionName: string;
  label: string;
  value: 'on' | 'off' | 'inherit';
  resolved: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setInstitutionFlag,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  const id = `flag-${flagKey}-${institutionId}`;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="institutionId" value={institutionId} />
      <label htmlFor={id} className="sr-only">
        {label} at {institutionName}
      </label>
      <Select id={id} name="value" defaultValue={value} className="h-10 w-[150px]">
        <option value="inherit">Follow platform</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </Select>
      <Button type="submit" size="dense" variant="tertiary" disabled={pending} aria-busy={pending}>
        {pending ? 'Applying' : 'Apply'}
      </Button>
      <span className="t-caption text-ink-700">
        Currently {resolved ? 'on' : 'off'} for {institutionName}
      </span>
      {state?.error ? (
        <span className="t-body-sm w-full font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
