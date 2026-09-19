'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input } from './ui';
import type { ActionState } from './form';
import { provisionTenant, setTenantStatus } from '@/modules/admin/tenants';

/** SA-01 — creating an institution. */
export function ProvisionForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    provisionTenant,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not provisioned">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Legal name" name="name" inputId="tenant-name" required>
        <Input id="tenant-name" name="name" required placeholder="University of Ibadan" />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field
          label="Short name"
          name="shortName"
          inputId="tenant-short"
          required
          helper="Appears on matriculation numbers and certificates."
        >
          <Input id="tenant-short" name="shortName" required placeholder="UI" />
        </Field>
        <Field
          label="Subdomain"
          name="slug"
          inputId="tenant-slug"
          required
          helper="Where their students sign in. It cannot be changed afterwards without breaking every link."
        >
          <Input id="tenant-slug" name="slug" required placeholder="ui" />
        </Field>
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="City" name="city" inputId="tenant-city">
          <Input id="tenant-city" name="city" placeholder="Ibadan" />
        </Field>
        <Field
          label="Brand colour"
          name="brandColour"
          inputId="tenant-colour"
          helper="Checked for contrast before it is saved, so a university never sees its own branding refused later."
        >
          <Input id="tenant-colour" name="brandColour" defaultValue="#6B2436" />
        </Field>
      </div>

      <div className="mt-8 border-t border-ink-300 pt-6">
        <p className="t-body-sm mt-0 mb-4 text-ink-700">
          The first administrator. They get an activation link, set their own password, and finish
          the setup themselves — fees, cohorts, staff and the payout account are theirs to
          configure, not ours.
        </p>

        <div className="grid gap-x-6 md:grid-cols-2">
          <Field label="Their name" name="adminName" inputId="tenant-admin-name" required>
            <Input id="tenant-admin-name" name="adminName" required />
          </Field>
          <Field label="Their email" name="adminEmail" inputId="tenant-admin-email" required>
            <Input id="tenant-admin-email" name="adminEmail" type="email" required />
          </Field>
        </div>
      </div>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Provisioning' : 'Provision the institution'}
      </Button>
    </form>
  );
}

/** §4 lifecycle: provisioning, live, suspended. */
export function TenantStatus({
  institutionId,
  status,
  shortName,
}: {
  institutionId: string;
  status: string;
  shortName: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setTenantStatus,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <div>
      {state?.error ? (
        <div className="mb-3">
          <Banner tone="danger" title="Not changed">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-3">
          <Banner tone="verified" title="Changed">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {status !== 'live' ? (
          <form action={formAction}>
            <input type="hidden" name="institutionId" value={institutionId} />
            <input type="hidden" name="status" value="live" />
            <Button type="submit" size="dense" disabled={pending}>
              Take {shortName} live
            </Button>
          </form>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="institutionId" value={institutionId} />
            <input type="hidden" name="status" value="suspended" />
            <Button type="submit" size="dense" variant="secondary" disabled={pending}>
              Suspend
            </Button>
          </form>
        )}

        {status === 'suspended' ? (
          <form action={formAction}>
            <input type="hidden" name="institutionId" value={institutionId} />
            <input type="hidden" name="status" value="provisioning" />
            <Button type="submit" size="dense" variant="tertiary" disabled={pending}>
              Back to provisioning
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
