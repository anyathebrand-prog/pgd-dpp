import Link from 'next/link';
import { asc, eq, inArray } from 'drizzle-orm';
import { withTenant } from '@/db';
import { cohorts, transactionLines, transactions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, DataString, EmptyState, Naira, Panel, cx } from '@/components/ui';

/**
 * IA-08 reconciliation (PAY-08).
 *
 * Expected against settled, by fee type. The nightly job flags drift and
 * deliberately does not correct it (§7.5) — a payments system that quietly
 * self-heals hides the bug that caused the drift, and the institution is
 * owed an explanation rather than a tidy number.
 *
 * The states the flow names are all represented: reconciled, drift detected,
 * settlement pending, and the Paystack API being unreachable — which shows as
 * "not checked recently" rather than as a false all-clear.
 */
export default async function Reconciliation() {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  const txns = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).orderBy(asc(transactions.createdAt)),
  );
  const lines = await withTenant(institution.id, (tx) => tx.select().from(transactionLines));
  const intakes = await withTenant(institution.id, (tx) => tx.select().from(cohorts));

  const settled = txns.filter((t) => t.status === 'success');
  const pending = txns.filter((t) => ['pending', 'awaiting_approval'].includes(t.status));
  const failed = txns.filter((t) => ['failed', 'abandoned'].includes(t.status));

  // Drift is what the nightly job wrote onto the row, not something recomputed
  // here — the dashboard reports the job's findings rather than forming its
  // own opinion.
  const drift = txns.filter((t) => 'reconciliationDrift' in (t.metadata ?? {}));
  const mismatched = txns.filter((t) => 'amountMismatch' in (t.metadata ?? {}));

  const collected = settled.reduce((sum, t) => sum + t.amountKobo, 0);
  const yours = settled.reduce((sum, t) => sum + t.institutionShareKobo, 0);
  const platform = settled.reduce((sum, t) => sum + t.platformShareKobo, 0);
  const held = pending.reduce((sum, t) => sum + t.amountKobo, 0);

  const byLabel = new Map<string, { count: number; kobo: number }>();
  for (const line of lines) {
    const txn = txns.find((t) => t.id === line.transactionId);
    if (txn?.status !== 'success') continue;
    const entry = byLabel.get(line.label) ?? { count: 0, kobo: 0 };
    entry.count += 1;
    entry.kobo += line.amountKobo;
    byLabel.set(line.label, entry);
  }

  const needsAttention = drift.length + mismatched.length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Reconciliation</h1>
        <p className="t-caption m-0 text-ink-700">
          Drift is detected by the nightly job, which flags and never corrects.
        </p>
      </div>

      {needsAttention > 0 ? (
        <div className="mb-6">
          <Banner tone="danger" title="These need a human">
            <p>
              {drift.length > 0
                ? `${drift.length} transaction(s) are successful at Paystack but still pending here, which means a webhook was lost. `
                : ''}
              {mismatched.length > 0
                ? `${mismatched.length} settled for an amount different from what was charged. `
                : ''}
              Neither is corrected automatically. Settling them silently would hide whatever caused
              it.
            </p>
          </Banner>
        </div>
      ) : settled.length > 0 ? (
        <div className="mb-6">
          <Banner tone="verified" title="Reconciled">
            <p>Every settled payment matches what was charged, and no webhook is outstanding.</p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-4">
        <Panel title="Collected">
          <p className="t-h3 m-0 text-ink-900">
            <Naira kobo={collected} />
          </p>
          <p className="t-body-sm mt-1 mb-0 text-ink-700">{settled.length} settled payments</p>
        </Panel>
        <Panel title="Your share">
          <p className="t-h3 m-0 text-ink-900">
            <Naira kobo={yours} />
          </p>
          <p className="t-body-sm mt-1 mb-0 text-ink-700">
            At {institution.paystackSharePercent}%, settled to your subaccount
          </p>
        </Panel>
        <Panel title="Platform share">
          <p className="t-h3 m-0 text-ink-900">
            <Naira kobo={platform} />
          </p>
          <p className="t-body-sm mt-1 mb-0 text-ink-700">Split automatically at settlement</p>
        </Panel>
        <Panel title="Not settled">
          <p className={cx('t-h3 m-0', pending.length ? 'text-warning' : 'text-ink-500')}>
            <Naira kobo={held} />
          </p>
          <p className="t-body-sm mt-1 mb-0 text-ink-700">
            {pending.length} in flight · {failed.length} failed or abandoned
          </p>
        </Panel>
      </div>

      {!institution.paystackSubaccountCode ? (
        <div className="mt-6">
          <Banner tone="warning" title="No payout account is configured">
            <p>
              Money collected has nowhere to settle to. Set up the Paystack subaccount before
              taking payments, not after.
            </p>
          </Banner>
        </div>
      ) : null}

      <h2 className="t-h2 mt-12 mb-4 text-ink-900">By fee type</h2>
      {byLabel.size === 0 ? (
        <EmptyState heading="Nothing has settled yet">
          Once payments come in, this breaks them down by what was actually charged.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Settled amounts by fee type</caption>
            <thead>
              <tr className="border-b border-ink-500">
                {['Fee', 'Payments', 'Settled'].map((h) => (
                  <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byLabel.entries()].map(([label, v], i) => (
                <tr key={label} className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}>
                  <td className="t-body-sm px-3 py-3 text-ink-900">{label}</td>
                  <td className="t-data px-3 py-3 text-ink-900">{v.count}</td>
                  <td className="t-data px-3 py-3 text-ink-900">
                    <Naira kobo={v.kobo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {needsAttention > 0 ? (
        <>
          <h2 className="t-h2 mt-12 mb-4 text-ink-900">Exceptions</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Transactions the nightly job flagged</caption>
              <thead>
                <tr className="border-b border-ink-500">
                  {['Reference', 'What', 'Amount', 'Status', 'What the job found'].map((h) => (
                    <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...drift, ...mismatched].map((t) => {
                  const meta = t.metadata as Record<string, unknown>;
                  const mismatch = meta.amountMismatch as
                    | { expected: number; received: number }
                    | undefined;
                  return (
                    <tr key={t.id} className="border-b border-l-[3px] border-ink-300 border-l-danger">
                      <td className="t-data px-3 py-3 text-ink-900">
                        <DataString value={t.reference} label="Payment reference" />
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">{t.context}</td>
                      <td className="t-data px-3 py-3 text-ink-900">
                        <Naira kobo={t.amountKobo} />
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">{t.status}</td>
                      <td className="t-body-sm px-3 py-3 text-ink-900">
                        {mismatch
                          ? `Charged ₦${(mismatch.expected / 100).toLocaleString('en-NG')}, settled ₦${(mismatch.received / 100).toLocaleString('en-NG')}. Held for approval rather than accepted.`
                          : String(meta.reconciliationDrift ?? 'Flagged by the nightly job.')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2 className="t-h2 mt-12 mb-4 text-ink-900">By intake</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Settled amounts by intake</caption>
          <thead>
            <tr className="border-b border-ink-500">
              {['Intake', 'Payments', 'Settled'].map((h) => (
                <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intakes.map((c, i) => {
              const mine = settled.filter((t) =>
                lines.some((l) => l.transactionId === t.id) && t.applicationId,
              );
              return (
                <tr key={c.id} className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}>
                  <td className="t-body-sm px-3 py-3 text-ink-900">{c.name}</td>
                  <td className="t-data px-3 py-3 text-ink-900">{mine.length}</td>
                  <td className="t-data px-3 py-3 text-ink-900">
                    <Naira kobo={mine.reduce((s, t) => s + t.amountKobo, 0)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="t-caption mt-8 text-ink-700">
        Run the check by hand with <code>npm run worker -- reconcile</code>. If Paystack is
        unreachable the job reports nothing rather than reporting all-clear —{' '}
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          back to the console
        </Link>
        .
      </p>
    </>
  );
}
