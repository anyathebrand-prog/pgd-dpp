import { asc, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { CohortEditor } from '@/components/admin-panels';
import { Banner, EmptyState, Panel, cx } from '@/components/ui';

/**
 * IA-04 cohort calendar.
 *
 * Capacity is shown against seats already committed, because §5.1 enforces
 * capacity at offer issuance rather than at payment — so "places left" is a
 * number the registry is spending as it admits, not something that resolves
 * itself later at checkout.
 */
export default async function CohortCalendar() {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  const intakes = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).orderBy(asc(cohorts.startsAt)),
  );

  const committed = await withTenant(institution.id, (tx) =>
    tx
      .select({ cohortId: applications.cohortId, n: sql<number>`count(*)::int` })
      .from(applications)
      .where(inArray(applications.status, ['admitted', 'offer_accepted', 'enrolled']))
      .groupBy(applications.cohortId),
  );
  const held = new Map(committed.map((c) => [c.cohortId, Number(c.n)]));

  const open = intakes.filter((c) => c.status === 'open');

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Intakes</h1>
      <p className="t-body measure mt-2 mb-6 text-ink-700">
        An intake has to be open before anyone can apply to it. Offers hold a seat until they are
        accepted or lapse, so the places remaining here already account for outstanding offers.
      </p>

      {open.length === 0 ? (
        <div className="mb-6">
          <Banner tone="warning" title="No intake is open">
            The programme page shows nothing to apply to, and the signup route has no cohort to
            attach an application to. Open one when you are ready to take candidates.
          </Banner>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_420px]">
        <div>
          {intakes.length === 0 ? (
            <EmptyState heading="No intakes yet">
              Create the first one to start taking applications.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Intakes, earliest start first</caption>
                <thead>
                  <tr className="border-b border-ink-500">
                    {['Intake', 'Status', 'Places', 'Applications close', 'Teaching starts', 'Offer expiry'].map(
                      (h) => (
                        <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {intakes.map((c, i) => {
                    const taken = held.get(c.id) ?? 0;
                    const left = c.capacity - taken;
                    return (
                      <tr
                        key={c.id}
                        className={cx(
                          'border-b border-ink-300',
                          i % 2 === 1 && 'bg-ink-100/40',
                          left <= 0 && c.status === 'open' && 'border-l-[3px] border-l-warning',
                        )}
                      >
                        <td className="t-body-sm px-3 py-3 font-semibold text-ink-900">{c.name}</td>
                        <td className="t-body-sm px-3 py-3 text-ink-700">{c.status}</td>
                        <td className="t-data px-3 py-3 text-ink-900">
                          {left} of {c.capacity}
                          {left <= 0 ? (
                            <span className="t-caption block font-sans text-warning">Full</span>
                          ) : null}
                        </td>
                        <td className="t-body-sm px-3 py-3 text-ink-700">
                          {c.applicationClosesAt?.toLocaleDateString('en-NG') ?? '—'}
                        </td>
                        <td className="t-body-sm px-3 py-3 text-ink-700">
                          {c.startsAt?.toLocaleDateString('en-NG') ?? '—'}
                        </td>
                        <td className="t-body-sm px-3 py-3 text-ink-700">
                          {institution.offerExpiryDays} days
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="t-caption mt-6 text-ink-700">
            Offers lapse after {institution.offerExpiryDays} days and release their seat
            automatically — that runs as a job, not as a chore someone remembers.
          </p>
        </div>

        <aside>
          <Panel title={intakes.length ? 'Add or edit an intake' : 'Create the first intake'}>
            <CohortEditor
              intakes={intakes.map((c) => ({
                id: c.id,
                name: c.name,
                capacity: c.capacity,
                status: c.status,
                applicationOpensAt: c.applicationOpensAt?.toISOString().slice(0, 10) ?? '',
                applicationClosesAt: c.applicationClosesAt?.toISOString().slice(0, 10) ?? '',
                startsAt: c.startsAt?.toISOString().slice(0, 10) ?? '',
              }))}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
