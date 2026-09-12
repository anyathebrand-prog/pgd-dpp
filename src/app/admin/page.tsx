import Link from 'next/link';
import { eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, transactions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, Naira, Panel, cx } from '@/components/ui';

/**
 * IA-01 institution admin home.
 *
 * Leads with the review backlog, because PRD risk 3 identifies registry
 * turnaround as the residual bottleneck now that the admission gate is locked.
 * The oldest waiting application is the number that matters, not the total.
 */
export default async function AdminHome() {
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');

  const queue = await withTenant(institution.id, (tx) =>
    tx
      .select({ status: applications.status, submittedAt: applications.submittedAt })
      .from(applications),
  );

  const actionable = queue.filter((a) =>
    ['submitted', 'under_review', 'documents_queried'].includes(a.status),
  );
  const oldest = actionable
    .map((a) => a.submittedAt?.getTime() ?? Date.now())
    .sort((a, b) => a - b)[0];
  const oldestDays = oldest ? Math.floor((Date.now() - oldest) / 86_400_000) : 0;

  const counts = {
    admitted: queue.filter((a) => a.status === 'admitted' || a.status === 'offer_accepted').length,
    enrolled: queue.filter((a) => a.status === 'enrolled').length,
    lapsed: queue.filter((a) => a.status === 'offer_lapsed').length,
  };

  const intakes = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.status, 'open')),
  );

  const [settled] = await withTenant(institution.id, (tx) =>
    tx
      .select({
        total: sql<number>`coalesce(sum(${transactions.amountKobo}), 0)::int`,
        institutionShare: sql<number>`coalesce(sum(${transactions.institutionShareKobo}), 0)::int`,
      })
      .from(transactions)
      .where(eq(transactions.status, 'success')),
  );

  const [pending] = await withTenant(institution.id, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(inArray(transactions.status, ['pending', 'awaiting_approval'])),
  );

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">{institution.name}</h1>
      <p className="t-body mt-2 mb-8 text-ink-700">
        Admissions, fees and settlement for the Post Graduate Diploma in Data Protection &amp;
        Privacy.
      </p>

      {oldestDays >= 10 ? (
        <div className="mb-8">
          <Banner tone="warning" title="An application has been waiting too long">
            <p>
              The oldest unreviewed application has been in the queue for {oldestDays} days. Review
              turnaround is the part of this funnel candidates notice most.{' '}
              <Link href="/admin/applications" className="text-ink-900 underline underline-offset-2">
                Open the queue
              </Link>
              .
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-3">
        <Panel title="Needs review">
          <p className={cx('t-h1 m-0', actionable.length > 0 ? 'text-ink-900' : 'text-ink-500')}>
            {actionable.length}
          </p>
          <p className="t-body-sm mt-1 mb-0 text-ink-700">
            {actionable.length > 0
              ? `Oldest waiting ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}`
              : 'Nothing outstanding'}
          </p>
          <p className="t-body-sm mt-3 mb-0">
            <Link href="/admin/applications" className="text-ink-900 underline underline-offset-2">
              Open the queue
            </Link>
          </p>
        </Panel>

        <Panel title="Offers and enrolments">
          <dl className="t-body-sm m-0 grid grid-cols-[1fr_auto] gap-y-2 text-ink-900">
            <dt className="text-ink-700">Offers outstanding</dt>
            <dd className="m-0 text-right">{counts.admitted}</dd>
            <dt className="text-ink-700">Enrolled</dt>
            <dd className="m-0 text-right">{counts.enrolled}</dd>
            <dt className="text-ink-700">Offers lapsed</dt>
            <dd className="m-0 text-right">{counts.lapsed}</dd>
          </dl>
          {counts.lapsed > 0 ? (
            <p className="t-caption mt-3 mb-0 text-ink-700">
              Lapsed offers have released their seats back to the cohort.
            </p>
          ) : null}
        </Panel>

        <Panel title="Settlement">
          <p className="t-body-sm m-0 text-ink-700">Collected</p>
          <p className="t-h3 m-0 text-ink-900">
            <Naira kobo={Number(settled?.total ?? 0)} />
          </p>
          <p className="t-body-sm mt-3 mb-0 text-ink-700">Your share at settlement</p>
          <p className="t-body m-0 text-ink-900">
            <Naira kobo={Number(settled?.institutionShare ?? 0)} />
          </p>
          {Number(pending?.n ?? 0) > 0 ? (
            <p className="t-caption mt-3 mb-0 text-warning">
              {pending.n} transactions are unresolved and excluded from these totals.
            </p>
          ) : null}
        </Panel>
      </div>

      <h2 className="t-h2 mt-12 mb-4 text-ink-900">Open intakes</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Cohorts currently open for applications</caption>
          <thead>
            <tr className="border-b border-ink-500">
              {['Cohort', 'Capacity', 'Applications close', 'Teaching starts'].map((h) => (
                <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intakes.map((c) => (
              <tr key={c.id} className="border-b border-ink-300">
                <td className="t-body-sm px-3 py-3 text-ink-900">
                  <Link
                    href={`/admin/cohorts/${c.id}`}
                    className="text-ink-900 underline underline-offset-2"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="t-data px-3 py-3 text-ink-900">{c.capacity}</td>
                <td className="t-body-sm px-3 py-3 text-ink-700">
                  {c.applicationClosesAt?.toLocaleDateString('en-NG') ?? '—'}
                </td>
                <td className="t-body-sm px-3 py-3 text-ink-700">
                  {c.startsAt?.toLocaleDateString('en-NG') ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="t-caption mt-10 text-ink-700">
        Fees, branding, staff and payout settings are configured per institution. Everything you do
        in this console is recorded against your account.
      </p>
    </>
  );
}
