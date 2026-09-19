import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactionLines, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { DataString, LinkButton, Naira } from '@/components/ui';

/**
 * PAY-07 receipt, as a document rather than as a row in a table.
 *
 * "Downloadable from the student portal forever" is the requirement, and a
 * receipt someone gives to an employer for reimbursement has to carry what
 * that employer needs: who paid, to whom, for what, when, and a reference the
 * institution can look up.
 *
 * Print-first, because the PDF is this page rendered by a headless browser
 * (§7.2), and everything screen-only is `print:hidden`. There is no second
 * implementation of a receipt to drift from this one.
 */
export default async function Receipt({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [txn] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.reference, decodeURIComponent(ref)),
          // Scoped to the reader: a reference is quotable and guessable enough
          // that it must not be the only thing standing between a stranger and
          // someone else's payment record.
          eq(transactions.userId, me.userId),
        ),
      )
      .limit(1),
  );
  if (!txn) notFound();
  if (txn.status !== 'success') notFound();

  const lines = await withTenant(institution.id, (tx) =>
    tx.select().from(transactionLines).where(eq(transactionLines.transactionId, txn.id)),
  );

  const paid = txn.paidAt ?? txn.updatedAt;

  return (
    <main id="main" className="mx-auto max-w-[720px] px-4 py-12">
      {/* §2.5: the letterhead rule is one of exactly four places the tenant
          brand may appear. */}
      <div className="flex items-center gap-3 border-b border-ink-300 pb-6">
        <span
          className="inline-block h-8 w-2"
          style={{ background: 'var(--tenant-brand)' }}
          aria-hidden="true"
        />
        <div>
          <p className="t-label m-0 text-ink-900">{institution.name}</p>
          <p className="t-caption m-0 text-ink-700">
            Post Graduate Diploma in Data Protection &amp; Privacy
          </p>
        </div>
      </div>

      <h1 className="t-read-h mt-10 mb-0 text-ink-900">Receipt</h1>
      <p className="t-body mt-2 text-ink-700">
        This receipt confirms a payment received and settled. It can be downloaded again at any
        time from your payments page.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6">
        <div>
          <dt className="t-caption m-0 text-ink-700">Paid by</dt>
          <dd className="t-body m-0 ml-0 text-ink-900">{me.fullName ?? me.email}</dd>
        </div>
        <div>
          <dt className="t-caption m-0 text-ink-700">Paid to</dt>
          <dd className="t-body m-0 ml-0 text-ink-900">{institution.name}</dd>
        </div>
        <div>
          <dt className="t-caption m-0 text-ink-700">Date</dt>
          <dd className="t-body m-0 ml-0 text-ink-900">
            {paid.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
          </dd>
        </div>
        <div>
          <dt className="t-caption m-0 text-ink-700">Method</dt>
          <dd className="t-body m-0 ml-0 text-ink-900">
            {txn.channel === 'offline_transfer' ? 'Bank transfer' : 'Card, via Paystack'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="t-caption m-0 text-ink-700">Payment reference</dt>
          <dd className="m-0 ml-0">
            <DataString value={txn.reference} label="Payment reference" />
          </dd>
        </div>
      </dl>

      <table className="mt-10 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink-900">
            <th className="t-caption pb-2 font-semibold text-ink-700">What was paid for</th>
            <th className="t-caption pb-2 text-right font-semibold text-ink-700">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(lines.length > 0
            ? lines.map((l) => ({ label: l.label, amountKobo: l.amountKobo }))
            : [
                {
                  label: txn.context === 'application' ? 'Application fee' : 'Tuition',
                  amountKobo: txn.amountKobo,
                },
              ]
          ).map((line) => (
            <tr key={line.label} className="border-b border-ink-300">
              <td className="t-body py-3 text-ink-900">{line.label}</td>
              <td className="t-body py-3 text-right text-ink-900">
                <Naira kobo={line.amountKobo} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="t-label pt-4 text-ink-900">Total paid</td>
            <td className="t-data-lg pt-4 text-right text-ink-900">
              <Naira kobo={txn.amountKobo} />
            </td>
          </tr>
        </tbody>
      </table>

      {txn.context === 'application' ? (
        <p className="t-body-sm mt-8 text-ink-700">
          The application fee is non-refundable, as disclosed before payment.
        </p>
      ) : null}

      <p className="t-caption mt-12 border-t border-ink-300 pt-6 text-ink-700">
        Issued by {institution.name} through the PGD-DPP platform. Queries about this payment
        should quote the reference above.
      </p>

      {/* The screen-only tail. The PDF renderer loads this page under print
          media, which is also what the reader's own print dialog does. */}
      <div className="mt-12 flex flex-wrap items-center gap-4 print:hidden">
        <LinkButton href={`/api/pdf/receipt/${encodeURIComponent(txn.reference)}`}>
          Download as PDF
        </LinkButton>
        <Link href="/billing" className="t-body-sm self-center text-ink-700 underline underline-offset-2">
          Back to your payments
        </Link>
      </div>
    </main>
  );
}
