import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { StaffBand } from '@/components/ui';

/**
 * The platform console's chrome (§5.9).
 *
 * Added with SA-02 and SA-03: with one screen the super admin console needed
 * no navigation, and with three it does. The Redaction band stays on the
 * pages themselves — each declares its own, because `/platform/tenants` was
 * built before this layout existed and moving it would be a change to a
 * screen these two have no business editing.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  // AUTH-08 is enforced inside requireRole; a super admin cannot reach any of
  // this without a TOTP-satisfied session.
  await requireRole('super_admin');

  const nav = [
    { href: '/platform/tenants', label: 'Institutions' },
    { href: '/platform/analytics', label: 'Analytics' },
    { href: '/platform/flags', label: 'Feature flags' },
    { href: '/platform/sso', label: 'University sign-in' },
    { href: '/platform/faculty', label: 'Faculty' },
  ];

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform" role="super_admin" />
      <nav aria-label="Platform console" className="border-b border-ink-300">
        <div className="mx-auto flex max-w-[1600px] flex-wrap gap-6 px-8 py-3">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="t-body-sm text-ink-700 no-underline hover:text-ink-900"
            >
              {n.label}
            </Link>
          ))}
          <form action="/api/logout" method="post" className="ml-auto">
            <button className="t-body-sm text-ink-700 underline underline-offset-2">Sign out</button>
          </form>
        </div>
      </nav>
      {children}
    </div>
  );
}
