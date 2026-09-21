import Link from 'next/link';
import { requireInstitution } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { logIn } from '@/modules/auth/actions';
import { oidcConfig } from '@/modules/auth/oidc';

/**
 * AU-03.
 *
 * SSO-01: Tier 3 — a branded link from the university portal landing here, and
 * the student logging in natively — is what works at launch for every tenant.
 * Where the institution has Tier 1 configured (SSO-03), the flow's secondary
 * action is added: sign in through the university's own account. The
 * password form stays, always: it is the route that cannot be misconfigured.
 */
export default async function LoginPage() {
  const institution = await requireInstitution();
  const tier1 = oidcConfig(institution) !== null;

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

      {tier1 ? (
        <div className="mt-8 border-t border-ink-300 pt-8">
          {/* A plain link, not a form: the first leg is a GET redirect. */}
          <a
            href="/sso/oidc/start"
            className="motion-state inline-flex h-12 items-center rounded-sm border border-ink-900 px-5 t-label text-ink-900 no-underline"
          >
            Sign in with your {institution.shortName} account
          </a>
          <p className="t-body-sm mt-2 mb-0 text-ink-700">
            The account you use for university email. Students only; staff sign in above.
          </p>
        </div>
      ) : null}

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
