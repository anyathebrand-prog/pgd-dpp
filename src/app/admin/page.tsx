import Link from 'next/link';
import { eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, feeItems, modules, transactions } from '@/db/schema';
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

  // IA-01: the setup checklist. An institution that has not configured a
  // payout account cannot take money, and the flow is explicit that this must
  // be obvious here rather than discovered at checkout.
  const fees = await withTenant(institution.id, (tx) =>
    tx.select().from(feeItems).where(eq(feeItems.institutionId, institution.id)),
  );
  const publishedModules = await withTenant(institution.id, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(modules).where(eq(modules.published, true)),
  );

  const setup = [
    {
      label: 'Application fee set',
      done: fees.some((f) => f.kind === 'application'),
      href: '/admin/fees',
      why: 'Nobody can submit an application until this exists — the submit step charges it.',
    },
    {
      label: 'Tuition set',
      done: fees.some((f) => f.kind === 'tuition'),
      href: '/admin/fees',
      why: 'An admitted candidate cannot accept their offer without a price to pay.',
    },
    {
      label: 'An intake is open',
      done: intakes.length > 0,
      href: '/admin/cohorts',
      why: 'Your programme page shows nothing to apply to while every intake is draft or closed.',
    },
    {
      label: 'Payout account configured',
      done: Boolean(institution.paystackSubaccountCode),
      href: '/admin/payouts',
      why: 'Without a verified subaccount, money collected has nowhere to settle to. This blocks taking payment at all.',
      blocking: true,
    },
    {
      label: 'Branding set',
      done: institution.brandColour !== '#6B2436',
      href: '/admin/branding',
      why: 'Optional. Your admission letters carry the platform default until you set a colour.',
      optional: true,
    },
    {
      label: 'A module is published',
      done: Number(publishedModules[0]?.n ?? 0) > 0,
      href: '/admin/programme',
      why: 'Enrolled students see an empty programme until something is published.',
    },
  ];

  const blocking = setup.filter((s) => s.blocking && !s.done);
  const outstanding = setup.filter((s) => !s.done && !s.optional && !s.blocking);

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">{institution.name}</h1>
      <p className="t-body mt-2 mb-8 text-ink-700">
        Admissions, fees and settlement for the Post Graduate Diploma in Data Protection &amp;
        Privacy.
      </p>

      {blocking.length > 0 ? (
        <div className="mb-8">
          <Banner tone="danger" title="This institution cannot take payment yet">
            <ul className="m-0 list-disc pl-5">
              {blocking.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="text-ink-900 underline underline-offset-2">
                    {s.label}
                  </Link>{' '}
                  — {s.why}
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : null}

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

      <h2 className="t-h2 mt-12 mb-4 text-ink-900">Setup</h2>
      <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
        {setup.map((s) => (
          <li
            key={s.label}
            className={cx(
              'flex items-start gap-3 rounded-sm border p-3',
              s.done ? 'border-ink-300' : s.blocking ? 'border-danger' : 'border-ink-300',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('t-body-sm', s.done ? 'text-verified-text' : 'text-ink-500')}
            >
              {s.done ? '✓' : '—'}
            </span>
            <span>
              <Link
                href={s.href}
                className={cx(
                  't-body-sm no-underline',
                  s.done ? 'text-ink-700' : 'font-semibold text-ink-900 underline underline-offset-2',
                )}
              >
                {s.label}
                {s.optional && !s.done ? ' (optional)' : ''}
              </Link>
              {!s.done ? <span className="t-caption block text-ink-700">{s.why}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {outstanding.length === 0 && blocking.length === 0 ? (
        <p className="t-body-sm mt-4 text-verified-text">
          Setup is complete. Candidates can apply, pay, and be admitted.
        </p>
      ) : null}

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
