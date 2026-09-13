import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactionLines, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { DataString, EmptyState, Naira, Record } from '@/components/ui';

/**
 * ST-13 payments and receipts.
 *
 * PAY-07 says a receipt is downloadable from the portal forever, so this is
 * not a transient confirmation screen — it is the durable record, and it shows
 * the itemised lines rather than a single total, because that is what a sponsor
 * or an employer reimbursing the fee will ask for.
 */
export default async function Billing() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(eq(transactions.userId, me.userId))
      .orderBy(desc(transactions.createdAt)),
  );

  const lines = await withTenant(institution.id, (tx) =>
    tx.select().from(transactionLines),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Payments and receipts</h1>
        <p className="t-body mt-3 mb-8 text-ink-700">{institution.name}</p>

        {rows.length === 0 ? (
          <EmptyState heading="Nothing has been charged yet">
            Payments you make appear here, with a receipt you can come back to at any time.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {rows.map((t) => {
              const mine = lines.filter((l) => l.transactionId === t.id);
              return (
                <Record
                  as="li"
                  key={t.id}
                  title={t.context === 'application' ? 'Application fee' : t.context === 'tuition' ? 'Acceptance and tuition' : 'Other fees'}
                  meta={
                    t.status === 'success'
                      ? `Paid ${t.paidAt?.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : `${t.status} · started ${t.createdAt.toLocaleDateString('en-NG')}`
                  }
                >
                  {mine.length > 0 ? (
                    <ul className="m-0 list-none space-y-1 p-0">
                      {mine.map((l) => (
                        <li key={l.id} className="t-body-sm flex justify-between gap-4 text-ink-900">
                          <span>{l.label}</span>
                          <Naira kobo={l.amountKobo} />
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="t-data mt-4 mb-0 flex justify-between border-t border-ink-700/20 pt-3 text-ink-900">
                    <span>Total</span>
                    <Naira kobo={t.amountKobo} />
                  </p>

                  <p className="t-caption mt-3 mb-0 text-ink-700">
                    Reference <DataString value={t.reference} label="Payment reference" />
                    {t.status === 'success' ? (
                      <span className="text-verified-text"> · confirmed</span>
                    ) : null}
                  </p>

                  {t.status === 'success' ? (
                    <p className="t-body-sm mt-3 mb-0">
                      <Link
                        href={`/billing/receipt/${encodeURIComponent(t.reference)}`}
                        className="text-ink-900 underline underline-offset-2"
                      >
                        Open the receipt
                      </Link>
                    </p>
                  ) : null}

                  {/* ST-13 lists "offline payments pending approval", because a
                      transfer that has been sent but not yet confirmed is the
                      state people most want to check on. */}
                  {t.status === 'awaiting_approval' ? (
                    <p className="t-body-sm mt-3 mb-0 text-ink-900">
                      Your transfer is with {institution.shortName} for approval. You will be
                      emailed either way.{' '}
                      <Link
                        href={`/pay/offline?ref=${encodeURIComponent(t.reference)}`}
                        className="text-ink-900 underline underline-offset-2"
                      >
                        See what you sent
                      </Link>
                    </p>
                  ) : null}

                  {t.status === 'pending' || t.status === 'failed' || t.status === 'abandoned' ? (
                    <p className="t-body-sm mt-3 mb-0">
                      <Link
                        href={`/pay/offline?ref=${encodeURIComponent(t.reference)}`}
                        className="text-ink-900 underline underline-offset-2"
                      >
                        Pay this by bank transfer
                      </Link>
                    </p>
                  ) : null}
                </Record>
              );
            })}
          </ul>
        )}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
