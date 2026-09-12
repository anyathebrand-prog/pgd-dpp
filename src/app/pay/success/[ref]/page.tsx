import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { DataString, LinkButton, Naira, Record, Seal } from '@/components/ui';

/**
 * PY-03. Signal appears here — the payment is confirmed, which is exactly and
 * only what Signal is allowed to mean (§1.2).
 */
export default async function SuccessPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [txn] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.reference, ref), eq(transactions.userId, me.userId)))
      .limit(1),
  );

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <div className="flex items-start gap-6">
        <Seal label="Payment confirmed" />
        <div>
          <h1 className="t-h1 m-0 text-ink-900">Payment confirmed</h1>
          <p className="t-body mt-3 text-ink-700">
            Your application is now with the registry at {institution.shortName}. A receipt is on its
            way to {me.email} and stays available in your portal.
          </p>
        </div>
      </div>

      {txn ? (
        <div className="mt-10">
          <Record title="Receipt" meta={txn.paidAt?.toLocaleString('en-NG') ?? undefined}>
            <dl className="t-body-sm m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-ink-900">
              <dt className="text-ink-700">Amount</dt>
              <dd className="m-0"><Naira kobo={txn.amountKobo} /></dd>
              <dt className="text-ink-700">Reference</dt>
              <dd className="m-0"><DataString value={txn.reference} label="Payment reference" /></dd>
            </dl>
          </Record>
        </div>
      ) : null}

      <div className="mt-16 flex flex-wrap gap-4">
        <LinkButton href="/apply">Back to my application</LinkButton>
        <Link href="/billing" className="t-body-sm self-center text-ink-700 underline underline-offset-2">
          All my payments
        </Link>
      </div>
    </main>
  );
}
