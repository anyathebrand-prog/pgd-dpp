import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, count, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, Panel, cx } from '@/components/ui';
import { capacityState, HOLDS_A_SEAT } from '@/modules/admissions/capacity';

/**
 * RG-05 cohort capacity view — `{school}./admin/cohorts/{id}` (§5.1 LOCKED).
 *
 * Seats total, offered, accepted, enrolled, lapsed and available. Counted by
 * the same rule offer issuance enforces, so the number here is the number the
 * registrar can actually give out.
 *
 * Over-committed "should be impossible", in the flow's words, and the page
 * treats it that way: not a softer shade of full but an alarm, because it
 * means somebody who has accepted a place does not have one.
 */
export default async function CohortCapacity({ params }: { params: Promise<{ id: string }> }) {
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');
  const { id } = await params;

  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, id)).limit(1),
  );
  if (!cohort) notFound();

  const byStatus = await withTenant(institution.id, (tx) =>
    tx
      .select({ status: applications.status, n: count() })
      .from(applications)
      .where(and(eq(applications.cohortId, cohort.id)))
      .groupBy(applications.status),
  );
  const n = (s: string) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);

  const offered = n('admitted');
  const accepted = n('offer_accepted');
  const enrolled = n('enrolled');
  const lapsed = n('offer_lapsed');
  const committed = HOLDS_A_SEAT.reduce((sum, s) => sum + n(s), 0);
  const available = cohort.capacity - committed;
  const state = capacityState(cohort.capacity, committed);

  const pct = cohort.capacity > 0 ? Math.min((committed / cohort.capacity) * 100, 100) : 100;

  return (
    <>
      <p className="t-caption m-0">
        <Link href="/admin/cohorts" className="text-ink-700 underline underline-offset-2">
          All intakes
        </Link>
      </p>
      <h1 className="t-h1 mt-2 mb-2 text-ink-900">{cohort.name}</h1>
      <p className="t-body measure mt-0 mb-8 text-ink-700">
        A seat is taken when an offer is made, not when it is paid for, so offering is where
        capacity is spent (§5.1). A lapsed offer gives its seat back.
      </p>

      {state === 'over_committed' ? (
        <div className="mb-8">
          <Banner tone="danger" title="More people hold a seat than the intake has">
            <p>
              {committed} people hold a place in an intake of {cohort.capacity}. This should be
              impossible, because offers are refused once the intake is full. Before anything else,
              work out who was offered a place that did not exist, and raise the capacity or
              contact them.
            </p>
          </Banner>
        </div>
      ) : state === 'full' ? (
        <div className="mb-8">
          <Banner tone="warning" title="The intake is full">
            <p>
              No further offers can be made. A seat comes back if an offer lapses, or if you raise
              the capacity.
            </p>
          </Banner>
        </div>
      ) : state === 'near_capacity' ? (
        <div className="mb-8">
          <Banner tone="warning" title="Nearly full">
            <p>
              {available} {available === 1 ? 'seat is' : 'seats are'} left. From here, each offer is
              a choice about who the last places go to.
            </p>
          </Banner>
        </div>
      ) : null}

      <Panel title="Seats">
        {/* One bar, one dimension, and the number stated beside it. */}
        <div className="mb-6 h-2 w-full rounded-sm bg-ink-100" aria-hidden="true">
          <div
            className={cx(
              'h-2 rounded-sm',
              state === 'over_committed' ? 'bg-danger' : state === 'healthy' ? 'bg-ink-900' : 'bg-warning',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-6">
          {[
            ['Capacity', cohort.capacity],
            ['Offered, not yet accepted', offered],
            ['Accepted', accepted],
            ['Enrolled', enrolled],
            ['Offers lapsed', lapsed],
            ['Available', available],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="t-caption m-0 text-ink-700">{label}</dt>
              <dd
                className={cx(
                  't-h2 m-0 ml-0',
                  label === 'Available' && Number(value) <= 0 ? 'text-danger' : 'text-ink-900',
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="t-caption mt-6 mb-0 text-ink-700">
          Offered, accepted and enrolled each hold a seat: {committed} of {cohort.capacity}. Lapsed
          offers hold none.
        </p>
      </Panel>
    </>
  );
}
