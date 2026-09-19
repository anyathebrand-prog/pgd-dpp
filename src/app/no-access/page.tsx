import Link from 'next/link';
import { currentPrincipal } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';
import { Banner } from '@/components/ui';

/**
 * SY-02. A role check failed — a real 403, distinct from an expired session.
 *
 * It names the institution and the roles actually held, because the commonest
 * cause is not an attack but someone holding a role at School A and opening a
 * School B link. Telling them that is more useful than "access denied".
 */
export default async function NoAccess() {
  const me = await currentPrincipal();
  const institution = await currentInstitution();

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-24">
      <h1 className="t-h1 m-0 text-ink-900">You do not have access to this</h1>

      <div className="mt-8">
        <Banner tone="warning" title="Your account holds a different role here">
          <p>
            {institution
              ? `At ${institution.name} your account holds ${
                  me?.roles.length ? me.roles.join(', ') : 'no staff role'
                }. This screen needs a role you do not have there.`
              : 'This screen needs a staff role at a specific institution.'}
          </p>
        </Banner>
      </div>

      <p className="t-body mt-8 text-ink-700">
        If you work at more than one institution, check you are on the right address — roles do not
        carry across. Otherwise the institution admin can grant what you need.
      </p>

      <p className="t-body-sm mt-8">
        <Link href="/" className="text-ink-900 underline underline-offset-2">
          Go to the start
        </Link>
      </p>
    </main>
  );
}
