import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { StaffBand } from '@/components/ui';

/**
 * Staff console chrome (§5.3).
 *
 * The Redaction band is permanent and not dismissible. It is the ambient
 * signal that you are operating on other people's data, and the "all access is
 * logged" line inside it is chrome rather than a banner — a banner gets
 * dismissed and then forgotten, which is the opposite of the intent.
 *
 * §4.3: the console container is fluid with 32px margins. Density beats
 * symmetry on a queue someone works through all morning.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const institution = await requireInstitution();
  // AUTH-08 is enforced inside requireRole: these roles cannot reach a console
  // without a TOTP-satisfied session.
  const me = await requireRole('registry', 'institution_admin', 'facilitator');

  /*
   * Staff and payouts are institution_admin only — the pages enforce it, and
   * the nav agrees rather than offering a registry officer two links that
   * bounce them to /no-access. A menu item you are not allowed to open reads
   * as a fault in the product, not as a boundary.
   */
  const isAdmin = me.roles.includes('institution_admin');
  const nav = [
    { href: '/admin/applications', label: 'Applications' },
    { href: '/admin/cohorts', label: 'Cohorts' },
    { href: '/admin/graduation', label: 'Graduation' },
    { href: '/admin/alumni', label: 'Alumni' },
    { href: '/admin/fees', label: 'Fees' },
    { href: '/admin/branding', label: 'Branding' },
    ...(isAdmin
      ? [
          { href: '/admin/programme', label: 'Programme' },
          { href: '/admin/staff', label: 'Staff' },
          { href: '/admin/payouts', label: 'Payouts' },
        ]
      : []),
    { href: '/admin/payments/offline', label: 'Offline payments' },
    { href: '/admin/refunds', label: 'Refunds' },
    { href: '/admin/reconciliation', label: 'Reconciliation' },
    // CMP-17: everybody working on records takes it, so everybody sees it.
    { href: '/security/training', label: 'Training' },
  ];

  return (
    <div className="min-h-screen">
      <StaffBand institution={institution.name} role={me.roles.join(', ')} />

      <nav aria-label="Console" className="border-b border-ink-300">
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

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        {children}
      </main>
    </div>
  );
}
