import Link from 'next/link';
import { requireInstitution } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { logIn } from '@/modules/auth/actions';

/**
 * AU-03.
 *
 * SSO-01: Tier 3 — a branded link from the university portal landing here, and
 * the student logging in natively — is what works at launch for every tenant,
 * and it is the only tier built today. SSO-02 (the Tier 2 signed handoff) is
 * Phase 2 and has no endpoint yet; nothing on this page assumes otherwise.
 */
export default async function LoginPage() {
  const institution = await requireInstitution();

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Log in</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">{institution.name}</p>

      <ActionForm action={logIn} submitLabel="Log in">
        <Field label="Email address" name="email" required>
          <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required />
        </Field>

        <Field label="Password" name="password" required>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>

        <label className="t-body-sm flex items-center gap-3 text-ink-900">
          <input type="checkbox" name="remember" className="h-5 w-5 accent-[#6B2436]" />
          Stay logged in on this device for 30 days
        </label>
      </ActionForm>

      <div className="mt-8 space-y-2">
        <p className="t-body-sm m-0">
          <Link href="/forgot" className="text-ink-900 underline underline-offset-2">
            I have forgotten my password
          </Link>
        </p>
        <p className="t-body-sm m-0">
          <Link href="/signup" className="text-ink-900 underline underline-offset-2">
            I have not applied yet
          </Link>
        </p>
      </div>
    </>
  );
}
