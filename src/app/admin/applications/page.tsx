import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { EmptyState, Panel, cx } from '@/components/ui';
import { statusFilter } from '@/modules/admissions/queue-filter';

/**
 * RG-01 application queue.
 *
 * §4.3: staff tables may run the full container width and are exempt from the
 * 68-character measure. Density is the point — a registry officer works this
 * queue for an hour at a time.
 *
 * Rows sort by how long they have been waiting, oldest first, because the
 * residual risk after locking the admission gate (PRD risk 3) is review
 * turnaround becoming the funnel bottleneck. The queue should make the oldest
 * application impossible to miss.
 */
export default async function ApplicationQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');
  const { status } = await searchParams;

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({
        id: applications.id,
        reference: applications.reference,
        status: applications.status,
        submittedAt: applications.submittedAt,
        createdAt: applications.createdAt,
        personal: applications.personal,
        email: users.email,
        fullName: users.fullName,
        cohortName: cohorts.name,
      })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .innerJoin(cohorts, eq(cohorts.id, applications.cohortId))
      // Shared with RG-06, so the export is exactly this view.
      .where(statusFilter(status))
      .orderBy(desc(applications.submittedAt)),
  );

  const waiting = [...rows].sort(
    (a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0),
  );

  const filters = [
    { key: undefined, label: 'Needs action' },
    { key: 'admitted', label: 'Admitted' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'waitlisted', label: 'Waitlisted' },
    { key: 'enrolled', label: 'Enrolled' },
    { key: 'all', label: 'Everything' },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Applications</h1>
        <Link
          href={`/admin/applications/export${status ? `?status=${encodeURIComponent(status)}` : ''}`}
          className="t-body-sm text-ink-700 underline underline-offset-2"
        >
          Export this view as CSV
        </Link>
      </div>

      {/* A filter panel is Paper, never Manila — it is interface, not a record. */}
      <Panel className="mb-6">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-4">
          {filters.map((f) => {
            const active = (status ?? undefined) === f.key;
            return (
              <Link
                key={f.label}
                href={f.key ? `/admin/applications?status=${f.key}` : '/admin/applications'}
                aria-current={active ? 'true' : undefined}
                className={cx(
                  't-body-sm no-underline',
                  active ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-700',
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </Panel>

      {waiting.length === 0 ? (
        <EmptyState heading="Nothing is waiting for you">
          Applications appear here once the candidate has submitted and the application fee has
          settled.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Applications awaiting review, oldest submission first
            </caption>
            <thead>
              <tr className="border-b border-ink-500">
                {['Reference', 'Candidate', 'Cohort', 'Status', 'Waiting', ''].map((h) => (
                  <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waiting.map((r, i) => {
                const days = r.submittedAt
                  ? Math.floor((Date.now() - r.submittedAt.getTime()) / 86_400_000)
                  : null;
                const name =
                  (r.personal as Record<string, string>)?.fullName ?? r.fullName ?? r.email;
                return (
                  <tr
                    key={r.id}
                    className={cx(
                      'border-b border-ink-300',
                      // Zebra on Paper uses ink-100 (§2.2), not a tint of Manila:
                      // Manila means "record", and a table row is not one.
                      i % 2 === 1 && 'bg-ink-100/40',
                      // SLA pressure gets a left rule and never colour alone.
                      days !== null && days >= 10 && 'border-l-[3px] border-l-warning',
                    )}
                  >
                    <td className="t-data px-3 py-3 text-ink-900">{r.reference}</td>
                    <td className="t-body-sm px-3 py-3 text-ink-900">{name}</td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">{r.cohortName}</td>
                    <td className="t-body-sm px-3 py-3 text-ink-900">
                      {r.status.replace(/_/g, ' ')}
                    </td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">
                      {days === null ? '—' : days === 0 ? 'Today' : `${days} days`}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/applications/${r.id}`}
                        className="t-body-sm font-semibold text-authority underline underline-offset-2"
                      >
                        Review
                        <span className="sr-only"> application {r.reference}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
