import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { memberships, refunds, transactions, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, DataString, EmptyState, Field, Input, Naira, Panel, Record } from '@/components/ui';
import { DecideRefund, RequestRefund } from '@/components/refund-panels';
import { REFUND_REASONS, type RefundReason } from '@/modules/payments/refund-rules';

/**
 * PAY-12 refunds — `{school}./admin/refunds`.
 *
 * The approval chain is the screen's organising idea: a request sits here
 * until a *different* administrator decides it, and the page says plainly
 * when there is nobody who can. An institution with one administrator can
 * request refunds from its registry but can never approve one its own
 * administrator asked for — which is the control working, and the page points
 * at IA-05 rather than leaving a request waiting on a person who cannot exist.
 */
export default async function Refunds({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; requested?: string; decided?: string }>;
}) {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');
  const { ref, requested, decided } = await searchParams;
  const isAdmin = me.roles.includes('institution_admin');

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({ refund: refunds, txn: transactions })
      .from(refunds)
      .innerJoin(transactions, eq(transactions.id, refunds.transactionId))
      .where(eq(refunds.institutionId, institution.id))
      .orderBy(desc(refunds.createdAt))
      .limit(100),
  );

  // `users` is shared: names for requesters, deciders and payers.
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.refund.requestedBy, r.refund.decidedBy, r.txn.userId]).filter(Boolean),
    ),
  ] as string[];
  const people = ids.length
    ? await db
        .select({ id: users.id, name: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const who = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? (p.name ?? p.email) : 'Unknown';
  };

  const admins = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(eq(memberships.institutionId, institution.id), eq(memberships.role, 'institution_admin')),
    );

  // The request form, when somebody arrived with a payment reference.
  const [lookup] = ref
    ? await withTenant(institution.id, (tx) =>
        tx.select().from(transactions).where(eq(transactions.reference, ref.trim())).limit(1),
      )
    : [];

  const waiting = rows.filter((r) => r.refund.status === 'requested');
  const done = rows.filter((r) => r.refund.status !== 'requested');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Refunds</h1>
        <p className="t-caption m-0 text-ink-700">
          {waiting.length} waiting for a decision
        </p>
      </div>

      <p className="t-body measure mt-0 mb-8 text-ink-700">
        Every refund needs two people: one to ask for it and a different administrator to approve
        it. That second person is the control. Nothing here changes a student&apos;s academic
        standing; a withdrawal itself is a registry decision.
      </p>

      {requested ? (
        <div className="mb-8">
          <Banner tone="info" title={`Refund requested on ${requested}`}>
            <p>It is waiting for a different administrator to approve it. No money has moved.</p>
          </Banner>
        </div>
      ) : null}
      {decided === 'processed' ? (
        <div className="mb-8">
          <Banner tone="verified" title="Refund processed">
            <p>The money is on its way back, and the decision is in the audit log with both names.</p>
          </Banner>
        </div>
      ) : null}
      {decided === 'rejected' ? (
        <div className="mb-8">
          <Banner tone="info" title="Refund rejected">
            <p>The person who asked can see your reason.</p>
          </Banner>
        </div>
      ) : null}
      {decided === 'failed' ? (
        <div className="mb-8">
          <Banner tone="danger" title="Paystack refused the refund">
            <p>
              Nothing was returned. The reason is on the refund below; a new request can be made
              once it is resolved.
            </p>
          </Banner>
        </div>
      ) : null}

      {admins.length <= 1 ? (
        <div className="mb-8">
          <Banner tone="warning" title="There is only one administrator here">
            <p>
              A refund the administrator asks for can never be approved, because nobody else can
              approve it. Refunds requested by the registry still work.{' '}
              <Link href="/admin/staff" className="text-ink-900 underline underline-offset-2">
                Appoint a second administrator
              </Link>{' '}
              if refunds need to come from the administrator too.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        <div>
          <h2 className="t-h2 mt-0 mb-4 text-ink-900">Waiting for a decision</h2>
          {waiting.length === 0 ? (
            <EmptyState heading="Nothing waiting">
              Requested refunds appear here until a second administrator decides them.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-6 p-0">
              {waiting.map(({ refund, txn }) => {
                const mine = refund.requestedBy === me.userId;
                return (
                  <li key={refund.id}>
                    <Record
                      title={`${who(txn.userId)}: ${REFUND_REASONS[refund.reason as RefundReason].label.toLowerCase()}`}
                      meta={`Requested by ${who(refund.requestedBy)}`}
                    >
                      <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Refund</dt>
                          <dd className="m-0 ml-0 text-ink-900">
                            <Naira kobo={refund.amountKobo} />
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Of a payment of</dt>
                          <dd className="m-0 ml-0 text-ink-900">
                            <Naira kobo={txn.amountKobo} />
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Reference</dt>
                          <dd className="m-0 ml-0">
                            <DataString value={txn.reference} label="Payment reference" />
                          </dd>
                        </div>
                      </dl>
                      <p className="t-body-sm measure mt-0 mb-4 text-ink-900">{refund.note}</p>

                      {mine ? (
                        <p className="t-body-sm m-0 text-ink-700">
                          You asked for this one, so a different administrator has to decide it.
                        </p>
                      ) : isAdmin ? (
                        <DecideRefund refundId={refund.id} method={refund.method} />
                      ) : (
                        <p className="t-body-sm m-0 text-ink-700">
                          Waiting for an administrator.
                        </p>
                      )}
                    </Record>
                  </li>
                );
              })}
            </ul>
          )}

          {done.length > 0 ? (
            <>
              <h2 className="t-h2 mt-12 mb-4 text-ink-900">Decided</h2>
              <ul className="m-0 grid list-none gap-4 p-0">
                {done.map(({ refund, txn }) => (
                  <li key={refund.id} className="border-t border-ink-300 pt-4">
                    <p className="t-body-sm m-0 text-ink-900">
                      <Naira kobo={refund.amountKobo} /> to {who(txn.userId)} ·{' '}
                      <span className="text-ink-700">
                        {refund.status === 'processed'
                          ? `processed${refund.method === 'manual_transfer' ? `, bank reference ${refund.bankReference}` : ''}`
                          : refund.status === 'failed'
                            ? `failed: ${refund.failureReason ?? 'no reason given'}`
                            : refund.status}
                      </span>
                    </p>
                    <p className="t-caption mt-1 mb-0 text-ink-700">
                      Asked by {who(refund.requestedBy)}, decided by {who(refund.decidedBy)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Panel title="Request a refund">
            {lookup ? (
              <>
                <p className="t-body-sm mt-0 mb-4 text-ink-700">
                  <DataString value={lookup.reference} label="Payment reference" /> ·{' '}
                  <Naira kobo={lookup.amountKobo} /> ·{' '}
                  {lookup.context === 'application' ? 'application fee' : 'tuition'}
                </p>
                <RequestRefund
                  transactionId={lookup.id}
                  paidNaira={lookup.amountKobo / 100}
                  channel={lookup.channel}
                  doublePaid={Boolean(
                    (lookup.metadata as Record<string, unknown>)?.probableDoublePayment,
                  )}
                />
              </>
            ) : (
              <form method="get">
                {ref ? (
                  <p className="t-body-sm mt-0 mb-4 font-semibold text-danger">
                    <span aria-hidden="true">▲ </span>
                    No payment with that reference at {institution.shortName}.
                  </p>
                ) : null}
                <Field
                  label="Payment reference"
                  name="ref"
                  inputId="refund-ref"
                  required
                  helper="From the receipt, or from the offline payments page."
                >
                  <Input id="refund-ref" name="ref" required />
                </Field>
                <button
                  type="submit"
                  className="t-body-sm text-ink-900 underline underline-offset-2"
                >
                  Find the payment
                </button>
              </form>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
