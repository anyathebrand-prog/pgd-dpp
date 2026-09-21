import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Banner, EmptyState, Panel, StaffBand, cx } from '@/components/ui';
import {
  funnel,
  loginMethods,
  moduleCompletion,
  paymentsByChannel,
  tenants,
  timeToDecision,
  zeroResultSearches,
} from '@/modules/admin/analytics';

/**
 * SA-02 platform analytics — `app./platform/analytics` (§9).
 *
 * Every number on this page was aggregated inside the institution it came
 * from and crossed the tenant boundary as a count (§6.3). There is no
 * cross-tenant list of people behind any of it, and no drill-down into one —
 * a platform screen that could name a candidate would be the same leak the
 * whole architecture exists to prevent, wearing a dashboard.
 *
 * Two of the metrics §9 asks for are not here, and the page says which and
 * why rather than filling the space. A dashboard that quietly omits what it
 * cannot measure teaches its reader to trust the parts that are missing.
 */
export default async function Analytics() {
  await requireRole('super_admin');

  const all = await tenants();
  const [steps, decision, payments, learning, logins, searches] = await Promise.all([
    funnel(all),
    timeToDecision(all),
    paymentsByChannel(all),
    moduleCompletion(all),
    loginMethods(),
    zeroResultSearches(),
  ]);

  const worst = [...steps].sort((a, b) => b.dropOffPercent - a.dropOffPercent)[0];

  return (
    <div>
      <StaffBand institution="Platform" role="Super admin" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Platform analytics</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Across {all.length} {all.length === 1 ? 'institution' : 'institutions'}. Every figure was
          counted inside the institution it came from and left tenant scope as a number — there is
          no cross-tenant list of people behind this page, and nothing here can be drilled into one.
        </p>

        {worst && worst.dropOffPercent >= 30 && worst.index > 0 ? (
          <div className="mt-8">
            <Banner tone="warning" title={`The biggest loss is at “${worst.label}”`}>
              <p>
                {worst.dropOffPercent}% of the people who reached the previous step do not reach
                this one — {worst.lost} {worst.lost === 1 ? 'person' : 'people'}. That is the step
                worth a product decision before any other.
              </p>
            </Banner>
          </div>
        ) : null}

        <h2 className="t-h2 mt-12 mb-4 text-ink-900">The admissions funnel</h2>
        <Panel title="Where people stop">
          {steps[0]?.total === 0 ? (
            <EmptyState heading="Nobody has applied yet">
              The funnel fills as candidates arrive. Until then there is nothing here to read.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {steps.map((step) => {
                const width = steps[0].total === 0 ? 0 : (step.total / steps[0].total) * 100;
                return (
                  <li key={step.key}>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="t-body-sm m-0 text-ink-900">{step.label}</p>
                      <p className="t-data m-0 text-ink-900">
                        {step.total}
                        {step.index > 0 && step.dropOffPercent > 0 ? (
                          <span className="t-caption ml-3 text-ink-700">
                            &minus;{step.dropOffPercent}% from the step before
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {/* A bar, not a chart: one dimension, read left to right,
                        and the number is already stated beside it. */}
                    <div className="mt-2 h-2 w-full rounded-sm bg-ink-100">
                      <div
                        className="h-2 rounded-full bg-accent"
                        style={{ width: `${Math.max(width, 1)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Panel title="Time to decision">
            {decision.median === null ? (
              <p className="t-body-sm m-0 text-ink-700">
                No application has been decided yet, so there is no turnaround to report.
              </p>
            ) : (
              <>
                <p className="t-h1 m-0 text-ink-900">
                  {decision.median} <span className="t-body text-ink-700">days, median</span>
                </p>
                <p className="t-body-sm mt-2 mb-0 text-ink-700">
                  Across {decision.decided} decided{' '}
                  {decision.decided === 1 ? 'application' : 'applications'}. The slowest took{' '}
                  {decision.slowest} days.
                </p>
                <p className="t-caption mt-3 mb-0 text-ink-700">
                  Median rather than mean: one application that sat over a holiday moves a mean
                  enough to hide a queue that is otherwise healthy.
                </p>
              </>
            )}
          </Panel>

          <Panel title="How people sign in">
            {logins.total === 0 ? (
              <p className="t-body-sm m-0 text-ink-700">
                No sign-ins in the last 30 days.
              </p>
            ) : (
              <>
                <dl className="t-body-sm m-0 grid grid-cols-[1fr_auto] gap-y-2 text-ink-900">
                  <dt className="text-ink-700">Password</dt>
                  <dd className="m-0 text-right">{logins.password}</dd>
                  <dt className="text-ink-700">University portal (SSO)</dt>
                  <dd className="m-0 text-right">{logins.sso}</dd>
                </dl>
                <p className="t-body-sm mt-3 mb-0 text-ink-700">
                  {logins.ssoPercent}% arrive through their university&apos;s own portal, over the
                  last 30 days.
                </p>
                {logins.ssoRejected > 0 ? (
                  <p className="t-caption mt-2 mb-0 text-warning">
                    <span aria-hidden="true">▲ </span>
                    {logins.ssoRejected} handoff{logins.ssoRejected === 1 ? '' : 's'} refused. A
                    rising count here is a portal misconfigured, not an attack.
                  </p>
                ) : null}
              </>
            )}
          </Panel>
        </div>

        <h2 className="t-h2 mt-12 mb-4 text-ink-900">Money</h2>
        <Panel title="Payment success by channel">
          {payments.length === 0 ? (
            <p className="t-body-sm m-0 text-ink-700">No payment has been attempted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Payment attempts and outcomes by channel</caption>
                <thead>
                  <tr className="border-b border-ink-500">
                    {['Channel', 'Attempts', 'Succeeded', 'Abandoned', 'Awaiting approval', 'Success rate'].map(
                      (h) => (
                        <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((row, i) => (
                    <tr
                      key={row.channel}
                      className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}
                    >
                      <td className="t-body-sm px-3 py-3 text-ink-900">
                        {row.channel === 'paystack' ? 'Card and bank (Paystack)' : 'Bank transfer'}
                      </td>
                      <td className="t-data px-3 py-3 text-ink-900">{row.attempts}</td>
                      <td className="t-data px-3 py-3 text-ink-900">{row.success}</td>
                      <td className="t-data px-3 py-3 text-ink-700">{row.abandoned}</td>
                      <td className="t-data px-3 py-3 text-ink-700">{row.awaiting}</td>
                      <td className="t-data px-3 py-3 text-ink-900">{row.successPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="t-caption mt-4 mb-0 text-ink-700">
            The two channels fail differently and the split matters: an abandoned card payment is
            the candidate&apos;s to resume, while a transfer awaiting approval is an institution&apos;s
            queue and somebody has already sent money.
          </p>
        </Panel>

        <h2 className="t-h2 mt-12 mb-4 text-ink-900">Learning and the library</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Module completion">
            <p className="t-h1 m-0 text-ink-900">
              {learning.percent}
              <span className="t-body text-ink-700">%</span>
            </p>
            <p className="t-body-sm mt-2 mb-0 text-ink-700">
              {learning.completions} lessons completed of {learning.possible} available to{' '}
              {learning.learners} active {learning.learners === 1 ? 'student' : 'students'}.
            </p>
          </Panel>

          <Panel title="Searches the library could not answer">
            {searches.searches === 0 ? (
              <p className="t-body-sm m-0 text-ink-700">
                Nobody has searched the collection in the last 90 days.
              </p>
            ) : (
              <>
                <p className="t-h1 m-0 text-ink-900">
                  {searches.emptyPercent}
                  <span className="t-body text-ink-700">%</span>
                </p>
                <p className="t-body-sm mt-2 mb-4 text-ink-700">
                  {searches.empty} of {searches.searches} searches returned nothing, over 90 days.
                  This is the collection&apos;s only demand signal for what to acquire next.
                </p>
                {searches.top.length > 0 ? (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {searches.top.map((row) => (
                      <li
                        key={row.query}
                        className="flex items-baseline justify-between gap-4 border-t border-ink-300 pt-2"
                      >
                        <span className="t-body-sm text-ink-900">{row.query}</span>
                        <span className="t-data shrink-0 text-ink-700">{row.n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="t-caption mt-4 mb-0 text-ink-700">
                  Queries only. Who searched is not recorded — a search history on this product is a
                  record of what a named privacy professional was researching.
                </p>
              </>
            )}
          </Panel>
        </div>

        <h2 className="t-h2 mt-12 mb-4 text-ink-900">What this page cannot tell you</h2>
        <Panel title="Two metrics §9 asks for that do not exist yet">
          {/* Named rather than omitted. A dashboard that silently drops what it
              cannot measure teaches its reader to trust the gaps. */}
          <p className="t-body-sm mt-0 mb-3 text-ink-700">
            <strong className="text-ink-900">Support categories.</strong> There is no support desk
            in this product — no ticket, no queue, no category to count. The reference on every
            transaction exists so a candidate can quote it to a human, and that human is currently
            reachable only outside this system.
          </p>
          <p className="t-body-sm m-0 text-ink-700">
            <strong className="text-ink-900">Login method beyond these two.</strong> SSO Tier 1
            (SAML/OIDC) is not built, so the distribution above is complete only because there are
            just two ways in. It will stop being complete the day a third is added, and this panel
            is the reminder.
          </p>
        </Panel>

        <p className="t-body-sm mt-10">
          <Link href="/platform/tenants" className="text-ink-700 underline underline-offset-2">
            Back to institutions
          </Link>
        </p>
      </main>
    </div>
  );
}
