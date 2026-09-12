import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { StaffBand } from '@/components/ui';

/**
 * The facilitator console — gap G-18.
 *
 * §5.9 defines consoles for institution admin, super admin and DPO and omits
 * this one entirely, despite LRN-05 requiring facilitators to grade. The app
 * flow specs FC-01 to FC-03 provisionally, and this builds to that.
 *
 * It carries the same Redaction band as the other staff consoles: a
 * facilitator marking work is reading named students' submissions, and that
 * should look and feel different from using your own account.
 */
export default async function TeachLayout({ children }: { children: React.ReactNode }) {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  return (
    <div className="min-h-screen">
      <StaffBand institution={institution.name} role={me.roles.join(', ')} />

      <nav aria-label="Teaching" className="border-b border-ink-300">
        <div className="mx-auto flex max-w-[1600px] flex-wrap gap-6 px-8 py-3">
          <Link href="/teach" className="t-body-sm text-ink-700 no-underline hover:text-ink-900">
            My modules
          </Link>
          <Link
            href="/teach/grading"
            className="t-body-sm text-ink-700 no-underline hover:text-ink-900"
          >
            Grading
          </Link>
          <form action="/api/logout" method="post" className="ml-auto">
            <button className="t-body-sm text-ink-700 underline underline-offset-2">Sign out</button>
          </form>
        </div>
      </nav>

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        {children}
      </main>
    </div>
  );
}
