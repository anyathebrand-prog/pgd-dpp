import Link from 'next/link';
import { asc, count, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { applications, institutions, memberships, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { Banner, DataString, EmptyState, Panel, Record, StaffBand, cx } from '@/components/ui';
import { ProvisionForm, TenantStatus } from '@/components/tenant-panels';

/**
 * SA-01 tenant provisioning (§4).
 *
 * The console a super admin lands on — and until now, a 404, which meant the
 * role had nowhere to go at all.
 *
 * Provisioning creates a controller, not a record: a new organisation with
 * its own students, its own money and its own obligations under the NDPA. So
 * the screen leads with what an institution still has to do for itself rather
 * than with a list of what the platform has done. §6.3 puts the institution
 * in the controller's chair, and a platform that configures a university's
 * fees on its behalf has quietly taken that chair back.
 */
export default async function Tenants({
  searchParams,
}: {
  searchParams: Promise<{ provisioned?: string; url?: string }>;
}) {
  await requireRole('super_admin');
  const { provisioned, url } = await searchParams;

  const rows = await db.select().from(institutions).orderBy(asc(institutions.name));

  const admins = await db
    .select({ institutionId: memberships.institutionId, email: users.email, name: users.fullName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.role, 'institution_admin'));

  /*
   * Application counts per institution — the one number a platform admin
   * needs and cannot get from inside a tenant.
   *
   * Deliberately NOT a cross-tenant read. Each count is fetched in that
   * institution's own context, the same mechanism PB-02 uses: the loop is
   * bounded by the number of institutions (target: five), and §6.3's
   * requirement that cross-tenant data be aggregated before it leaves tenant
   * scope is satisfied by never assembling anything but a count.
   */
  const volumes = await Promise.all(
    rows.map(async (institution) => {
      const [row] = await withTenant(institution.id, (tx) =>
        tx
          .select({ n: count() })
          .from(applications)
          .where(eq(applications.institutionId, institution.id)),
      );
      return { institutionId: institution.id, n: Number(row?.n ?? 0) };
    }),
  );

  return (
    <div>
      <StaffBand institution="Platform" role="Super admin" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Institutions</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Every university on the platform. Provisioning one creates a controller under the NDPA —
          their students, their money, their obligations — so the setup that follows is theirs to
          do, not ours.
        </p>

        {provisioned ? (
          <div className="mt-8">
            <Banner tone="verified" title={`${provisioned} is provisioned`}>
              <p>
                The first administrator has an activation link in their inbox. They set their own
                password, then configure fees, an intake and a payout account — the institution
                cannot be taken live until that account is verified.
              </p>
              {url ? (
                <p className="mt-2">
                  Their sign-in is at <DataString value={url} label="Institution URL" />.
                </p>
              ) : null}
            </Banner>
          </div>
        ) : null}

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            {rows.length === 0 ? (
              <EmptyState heading="No institutions yet">
                Provision the first one. It needs a name, a subdomain and one administrator who can
                sign in.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-6 p-0">
                {rows.map((institution) => {
                  const theirAdmins = admins.filter((a) => a.institutionId === institution.id);
                  const applied = volumes.find((v) => v.institutionId === institution.id);
                  const payoutReady = Boolean(
                    institution.paystackSubaccountCode && institution.payoutVerifiedAt,
                  );

                  return (
                    <Record
                      as="li"
                      key={institution.id}
                      title={institution.name}
                      meta={`${institution.slug} · ${institution.shortName} · ${institution.status}`}
                      className={cx(
                        institution.status === 'suspended' && 'border-l-[3px] border-l-danger',
                      )}
                    >
                      <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Applications</dt>
                          <dd className="t-data m-0 ml-0 text-ink-900">
                            {Number(applied?.n ?? 0)}
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Payout account</dt>
                          <dd
                            className={cx(
                              't-body-sm m-0 ml-0',
                              payoutReady ? 'text-verified-text' : 'text-warning',
                            )}
                          >
                            {payoutReady ? 'Verified' : 'Not configured'}
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Administrators</dt>
                          <dd className="t-body-sm m-0 ml-0 text-ink-900">
                            {theirAdmins.length === 0
                              ? 'Nobody'
                              : theirAdmins.map((a) => a.name ?? a.email).join(', ')}
                          </dd>
                        </div>
                      </dl>

                      {theirAdmins.length === 0 ? (
                        <div className="mb-4">
                          <Banner tone="danger" title="Nobody can open this institution">
                            <p>
                              It has no administrator. Somebody at the platform will end up doing
                              its configuration, which is exactly the arrangement the
                              controller/processor split says must not happen.
                            </p>
                          </Banner>
                        </div>
                      ) : null}

                      <TenantStatus
                        institutionId={institution.id}
                        status={institution.status}
                        shortName={institution.shortName}
                      />
                    </Record>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="space-y-6">
            <Panel title="Provision an institution">
              <ProvisionForm />
            </Panel>

            <Panel title="What happens when one leaves">
              {/* §6.3's exiting state. Not built as a button, and saying so is
                  better than a control that does less than its label. */}
              <p className="t-body-sm mt-0 mb-0 text-ink-700">
                An institution exiting the platform triggers a data export obligation under §6.3 —
                their students&apos; records go back to them in a usable form before anything is
                removed. That is a process with a person in it, not a button here, and suspending
                a tenant is not the same thing.
              </p>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
