import Link from 'next/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { dataSubjectRequests, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { slaClass, slaFor } from '@/modules/compliance/dsr';
import { Banner, EmptyState, Panel, StaffBand, cx } from '@/components/ui';

/**
 * DP-02 data subject request queue (CMP-07).
 *
 * Filterable by right exercised and by controller, per the flow. Sorted by
 * due date ascending — the queue is a clock, so the thing closest to breaching
 * is always first, regardless of when it arrived.
 */
const OPEN_STATES = ['received', 'verifying', 'in_progress', 'routed'] as const;

const KINDS = ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection'] as const;

export default async function RequestQueue({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; controller?: string; show?: string }>;
}) {
  const me = await requireRole('dpo', 'super_admin');
  const { kind, controller, show } = await searchParams;

  const rows = await db
    .select({ request: dataSubjectRequests, institution: institutions.name })
    .from(dataSubjectRequests)
    .leftJoin(institutions, eq(institutions.id, dataSubjectRequests.institutionId))
    .where(show === 'closed' ? undefined : inArray(dataSubjectRequests.status, [...OPEN_STATES]))
    .orderBy(asc(dataSubjectRequests.dueAt));

  const filtered = rows.filter(
    (r) =>
      (!kind || r.request.kind === kind) && (!controller || r.request.routedTo === controller),
  );

  const breached = filtered.filter((r) => slaFor(r.request).level === 'overdue');
  const escalating = filtered.filter((r) => ['day20', 'day27'].includes(slaFor(r.request).level));

  function href(next: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { kind, controller, show, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return q ? `/dpo/requests?${q}` : '/dpo/requests';
  }

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform — Data Protection Officer" role={me.roles.join(', ')} />

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-body-sm m-0">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Back to the console
          </Link>
        </p>

        <h1 className="t-h1 mt-4 text-ink-900">Data subject requests</h1>
        <p className="t-body mt-2 mb-6 text-ink-700">
          Thirty days from receipt. Alerts escalate at day 20 and again at day 27, and the queue is
          ordered by how close each one is to breaching rather than by when it arrived.
        </p>

        {/* DP-01/DP-02: an SLA breach must be impossible to miss. */}
        {breached.length > 0 ? (
          <div className="mb-6">
            <Banner tone="danger" title="Statutory deadline missed">
              <p>
                {breached.length} {breached.length === 1 ? 'request is' : 'requests are'} past the
                30-day response window. This is a reportable failure, not a backlog — respond, and
                record why it was late.
              </p>
            </Banner>
          </div>
        ) : escalating.length > 0 ? (
          <div className="mb-6">
            <Banner tone="warning" title="Approaching the deadline">
              <p>
                {escalating.length} {escalating.length === 1 ? 'request is' : 'requests are'} past
                day 20. Fulfilment often needs the institution, so the remaining time is not all
                yours.
              </p>
            </Banner>
          </div>
        ) : null}

        <Panel className="mb-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="t-label m-0 mb-2 text-ink-900">Right exercised</p>
              <div className="flex flex-wrap gap-3">
                <Link href={href({ kind: undefined })} className={cx('t-body-sm no-underline', !kind ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700')}>
                  Any
                </Link>
                {KINDS.map((k) => (
                  <Link key={k} href={href({ kind: k })} className={cx('t-body-sm no-underline', kind === k ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700')}>
                    {k}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="t-label m-0 mb-2 text-ink-900">Controller</p>
              <div className="flex flex-wrap gap-3">
                {[
                  [undefined, 'Either'],
                  ['platform', 'Platform'],
                  ['institution', 'Institution'],
                ].map(([value, label]) => (
                  <Link key={label} href={href({ controller: value as string | undefined })} className={cx('t-body-sm no-underline', controller === value ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700')}>
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <p className="t-label m-0 mb-2 text-ink-900">Show</p>
              <div className="flex flex-wrap gap-3">
                <Link href={href({ show: undefined })} className={cx('t-body-sm no-underline', show !== 'closed' ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700')}>
                  Open
                </Link>
                <Link href={href({ show: 'closed' })} className={cx('t-body-sm no-underline', show === 'closed' ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700')}>
                  Everything
                </Link>
              </div>
            </div>
          </div>
        </Panel>

        {filtered.length === 0 ? (
          <EmptyState heading="No requests match">
            Requests that cannot be self-served arrive here. Most never should — a student can
            download their own data and correct their own profile without asking anyone.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Data subject requests, soonest deadline first</caption>
              <thead>
                <tr className="border-b border-ink-500">
                  {['Subject', 'Right', 'Controller', 'Identity', 'Status', 'Days left', ''].map((h) => (
                    <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ request, institution }, i) => {
                  const sla = slaFor(request);
                  const closed = Boolean(request.closedAt);
                  return (
                    <tr
                      key={request.id}
                      className={cx(
                        'border-b border-ink-300',
                        i % 2 === 1 && 'bg-ink-100/40',
                        !closed && sla.level === 'overdue' && 'border-l-[3px] border-l-danger',
                        !closed && sla.level === 'day27' && 'border-l-[3px] border-l-danger',
                        !closed && sla.level === 'day20' && 'border-l-[3px] border-l-warning',
                      )}
                    >
                      <td className="t-body-sm px-3 py-3 text-ink-900">{request.subjectEmail}</td>
                      <td className="t-body-sm px-3 py-3 text-ink-900">{request.kind}</td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">
                        {request.routedTo === 'institution' ? (institution ?? 'Institution') : 'Platform'}
                      </td>
                      <td className="t-body-sm px-3 py-3">
                        {request.identityVerifiedAt ? (
                          <span className="text-verified-text">Verified</span>
                        ) : (
                          <span className="text-ink-700">Not verified</span>
                        )}
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">
                        {request.status.replace(/_/g, ' ')}
                      </td>
                      <td className={cx('t-data px-3 py-3', closed ? 'text-ink-500' : slaClass(sla.level))}>
                        {closed
                          ? 'closed'
                          : sla.daysLeft <= 0
                            ? `${Math.abs(sla.daysLeft)} overdue`
                            : sla.daysLeft}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/dpo/requests/${request.id}`}
                          className="t-body-sm font-semibold text-authority underline underline-offset-2"
                        >
                          Open
                          <span className="sr-only"> request from {request.subjectEmail}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
