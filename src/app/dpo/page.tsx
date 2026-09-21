import Link from 'next/link';
import { desc, isNull, sql } from 'drizzle-orm';
import { db, readAcrossTenants } from '@/db';
import { breaches, consentRecords, dataSubjectRequests, documents, grievanceNotices, retentionRules } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { StaffBand, Panel, Banner, cx } from '@/components/ui';
import { breachClock, formatClock } from '@/modules/compliance/breach-clock';

/**
 * DP-01 DPO console.
 *
 * The DPO is a statutory role with statutory clocks, so this screen leads with
 * the clocks rather than with totals. §5.5 SLA clock: days remaining as a Plex
 * Mono numeral, ink-700 above 10 days, --warning at 10 or fewer, --danger at 3
 * or fewer or overdue, and overdue rows sort to the top.
 *
 * This console is platform-wide (the DPO is a platform role under §6.3), so it
 * is not tenant-scoped and reads shared tables directly.
 */
export default async function DpoConsole() {
  const me = await requireRole('dpo', 'super_admin');

  const requests = await db
    .select()
    .from(dataSubjectRequests)
    .where(isNull(dataSubjectRequests.closedAt))
    .orderBy(dataSubjectRequests.dueAt);

  const openBreaches = await db
    .select()
    .from(breaches)
    .orderBy(desc(breaches.discoveredAt))
    .limit(5);

  const rules = await db.select().from(retentionRules);

  // DP-04. Open means not yet answered substantively.
  const [{ openSnags }] = await db
    .select({ openSnags: sql<number>`count(*) filter (where ${grievanceNotices.status} = 'open')::int` })
    .from(grievanceNotices);

  // documents is tenant-scoped, and the DPO is a platform-wide statutory role
  // (§6.3) whose whole job is to see overdue purges wherever they are.
  const [{ overdue }] = await readAcrossTenants('dpo-console', (tx) =>
    tx
      .select({ overdue: sql<number>`count(*)::int` })
      .from(documents)
      .where(sql`${documents.purgeAfter} < now() and ${documents.purgedAt} is null`),
  );

  const [{ consents }] = await db
    .select({ consents: sql<number>`count(*)::int` })
    .from(consentRecords);

  function clockClass(dueAt: Date) {
    const days = Math.ceil((dueAt.getTime() - Date.now()) / 86_400_000);
    if (days <= 3) return { cls: 'text-danger', days };
    if (days <= 10) return { cls: 'text-warning', days };
    return { cls: 'text-ink-700', days };
  }

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform — Data Protection Officer" role={me.roles.join(', ')} />

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <h1 className="t-h1 m-0 text-ink-900">Data protection</h1>
        <p className="t-body mt-2 mb-8 text-ink-700">
          Statutory clocks first. Everything below is evidence you can be asked for without notice.
        </p>

        {/* CMP-10. An overdue purge is a live compliance failure, not a chore. */}
        {overdue > 0 ? (
          <div className="mb-8">
            <Banner tone="danger" title="Documents are past their deletion date">
              <p>
                {overdue} {overdue === 1 ? 'document is' : 'documents are'} past the date they should
                have been deleted. The purge job has either not run or has failed.{' '}
                <Link href="/dpo/retention" className="text-ink-900 underline underline-offset-2">
                  Open the retention report
                </Link>
                .
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section>
            <h2 className="t-h2 m-0 text-ink-900">Data subject requests</h2>
            <p className="t-body-sm mt-1 mb-4 text-ink-700">
              Thirty days from receipt, per CMP-07. Overdue sorts to the top.
            </p>

            {requests.length === 0 ? (
              <div className="rounded-md border border-ink-300 p-6">
                <p className="t-body m-0 text-ink-700">No requests are open.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Open data subject requests by due date</caption>
                  <thead>
                    <tr className="border-b border-ink-500">
                      {['Subject', 'Right exercised', 'Routed to', 'Status', 'Days left', ''].map((h) => (
                        <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => {
                      const { cls, days } = clockClass(r.dueAt);
                      return (
                        <tr
                          key={r.id}
                          className={cx(
                            'border-b border-ink-300',
                            days <= 0 && 'border-l-[3px] border-l-danger',
                          )}
                        >
                          <td className="t-body-sm px-3 py-3 text-ink-900">{r.subjectEmail}</td>
                          <td className="t-body-sm px-3 py-3 text-ink-900">{r.kind}</td>
                          <td className="t-body-sm px-3 py-3 text-ink-700">{r.routedTo}</td>
                          <td className="t-body-sm px-3 py-3 text-ink-700">
                            {r.status.replace(/_/g, ' ')}
                          </td>
                          <td className={cx('t-data px-3 py-3', cls)}>
                            {days <= 0 ? `${Math.abs(days)} overdue` : days}
                          </td>
                          <td className="px-3 py-3">
                            <Link
                              href={`/dpo/requests/${r.id}`}
                              className="t-body-sm font-semibold text-authority underline underline-offset-2"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h2 className="t-h2 mt-12 mb-4 text-ink-900">Breach register</h2>
            {openBreaches.length === 0 ? (
              <div className="rounded-md border border-ink-300 p-6">
                <p className="t-body m-0 text-ink-700">
                  Nothing recorded. An empty register is only credible if the tabletop exercise has
                  been run — see the launch gate in §6.13.
                </p>
              </div>
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {openBreaches.map((b) => {
                  // The register's own clock, so the two screens cannot
                  // disagree about how long is left.
                  const clock = breachClock({
                    discoveredAt: b.discoveredAt,
                    ndpcNotifiedAt: b.ndpcNotifiedAt,
                  });
                  const notified = clock.state === 'notified';
                  return (
                    <li key={b.id} className="rounded-md border border-ink-300 p-4">
                      <p className="t-h4 m-0 text-ink-900">{b.title}</p>
                      <p className="t-body-sm mt-1 mb-0 text-ink-700">
                        {b.severity} · discovered {b.discoveredAt.toLocaleString('en-NG')} ·{' '}
                        {b.affectedSubjectCount ?? 'unscoped'} subjects
                      </p>
                      <p
                        className={cx(
                          't-data mt-2 mb-0',
                          notified
                            ? 'text-verified-text'
                            : clock.state === 'running'
                              ? 'text-warning'
                              : 'text-danger',
                        )}
                      >
                        {notified
                          ? `NDPC notified ${b.ndpcNotifiedAt?.toLocaleString('en-NG')}${clock.late ? ', late' : ''}`
                          : `${formatClock(clock.hoursLeft)} to notify the NDPC`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="t-body-sm mt-4 mb-0">
              <Link href="/dpo/breaches" className="text-ink-900 underline underline-offset-2">
                Open the breach register
              </Link>
            </p>
          </section>

          <aside className="space-y-6">
            <Panel title="Retention schedule">
              <ul className="m-0 list-none space-y-3 p-0">
                {rules.map((r) => (
                  <li key={r.id} className="t-body-sm">
                    <span className="block text-ink-900">{r.entity}</span>
                    <span className="t-caption text-ink-700">
                      {r.condition} · {r.retainDays} days · last run{' '}
                      {r.lastRunAt?.toLocaleDateString('en-NG') ?? 'never'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="t-body-sm mt-4 mb-0">
                <Link href="/dpo/retention" className="text-ink-900 underline underline-offset-2">
                  Retention and purge report
                </Link>
              </p>
            </Panel>

            <Panel title="Consent records">
              <p className="t-body-sm m-0 text-ink-700">
                {consents.toLocaleString('en-NG')} decisions recorded, each bound to the privacy
                notice version in force when it was given.
              </p>
              <Link href="/dpo/consents" className="t-body-sm text-ink-900 underline underline-offset-2">
                See the consent records
              </Link>
            </Panel>

            <Panel title="Grievance notices">
              <p className="t-body-sm m-0 mb-3 text-ink-700">
                {openSnags === 0
                  ? 'No SNAG is waiting for a response.'
                  : `${openSnags} waiting for a substantive response.`}{' '}
                GAID Article 40(2): accept the violation and state the remedy, or explain why none
                occurred.
              </p>
              <Link href="/dpo/snag" className="t-body-sm text-ink-900 underline underline-offset-2">
                Open the SNAG register
              </Link>
            </Panel>

            <Panel title="Where requests come from">
              <p className="t-body-sm m-0 mb-3 text-ink-700">
                §6.6 wants most requests self-served and never becoming tickets. A student can
                download their own data and change their own consents without asking. What arrives
                here is what genuinely needed a person.
              </p>
              <Link href="/dpo/request" className="t-body-sm text-ink-900 underline underline-offset-2">
                The public intake form
              </Link>
            </Panel>

            <Panel title="Evidence export">
              <p className="t-body-sm m-0 mb-3 text-ink-700">
                CMP-16: RoPA, consent records, DPIA, audit log and breach register, in one archive,
                for a DPCO audit or an NDPC investigation.
              </p>
              <Link href="/dpo/evidence" className="t-body-sm text-ink-900 underline underline-offset-2">
                Prepare an export
              </Link>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
