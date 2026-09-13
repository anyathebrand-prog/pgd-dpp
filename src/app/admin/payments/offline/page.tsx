import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { documents, transactions, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { signedUrl } from '@/lib/storage';
import { Banner, DataString, EmptyState, Naira, Record } from '@/components/ui';
import { OfflineDecision } from '@/components/offline-payment-panels';

/**
 * IA-09 offline payment approvals (PAY-11).
 *
 * The flow's sentence is the whole design: approval "moves the application
 * forward exactly as a webhook would". Nothing on this screen writes an
 * enrolment — approving hands the reference to the same `settleTransaction`
 * the Paystack webhook calls, so there is one path that creates an enrolment
 * rather than two that are supposed to agree.
 *
 * The other rule worth stating on the page: staff verify against the bank
 * statement, not against the attachment. A screenshot of a transfer is the
 * easiest thing in this product to fake, and an approval queue that trains
 * people to click through PDFs is a fraud route with a UI.
 *
 * One other kind of row lands here: a card payment whose settled amount did
 * not match what was charged. PAY-03 parks those for a human rather than
 * resolving the difference silently, and a human deciding about money is
 * exactly this queue. Such a row carries no attachment and says why.
 */
export default async function OfflineApprovals({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string; rejected?: string }>;
}) {
  const { approved, rejected } = await searchParams;
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');

  const queue = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.institutionId, institution.id),
          eq(transactions.status, 'awaiting_approval'),
        ),
      )
      .orderBy(asc(transactions.updatedAt)),
  );

  const proofIds = queue
    .map((t) => (t.metadata.offline as { proofDocumentId?: string } | undefined)?.proofDocumentId)
    .filter((id): id is string => Boolean(id));

  const proofs = proofIds.length
    ? await withTenant(institution.id, (tx) =>
        tx.select().from(documents).where(inArray(documents.id, proofIds)),
      )
    : [];

  // `users` is shared, so this needs no tenant context.
  const payerIds = [...new Set(queue.map((t) => t.userId))];
  const payers = payerIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, payerIds))
    : [];

  // CMP-14: opening a queue of named people's payment evidence is staff access
  // to their records, and is logged as such.
  if (queue.length > 0) {
    await audit({
      action: 'payment.offline_queue_viewed',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'institution_admin',
      entity: 'transactions',
      detail: { count: queue.length },
    });
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Offline payments</h1>
        <p className="t-caption m-0 text-ink-700">Oldest first</p>
      </div>

      {approved ? (
        <div className="mb-6">
          <Banner tone="verified" title={`${approved} approved and settled.`}>
            <p>
              The payment is recorded as settled and the application has moved on exactly as it
              would have on a card payment. The payer has their receipt.
            </p>
          </Banner>
        </div>
      ) : null}

      {rejected ? (
        <div className="mb-6">
          <Banner tone="info" title={`${rejected} rejected, and the payer has been told why.`}>
            <p>
              The charge is still outstanding — they can send better evidence or pay by card, and
              the reason you gave was sent to them verbatim.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="mb-8">
        <Banner tone="warning" title="Check the bank statement, not the attachment">
          <p>
            The file below is what the payer sent, and it proves nothing on its own. Approve only
            once you have found the credit on {institution.shortName}&apos;s statement. Approval
            settles the payment and, for tuition, creates the enrolment and issues a matriculation
            number — exactly as a card payment would.
          </p>
        </Banner>
      </div>

      {queue.length === 0 ? (
        <EmptyState heading="Nothing is waiting">
          Transfers submitted from the payment page arrive here for approval. Card payments settle
          on their own and never appear in this queue.
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-6 p-0">
          {queue.map((txn) => {
            const payer = payers.find((p) => p.id === txn.userId);
            const offline = (txn.metadata.offline ?? {}) as {
              payerName?: string;
              paidOn?: string;
              proofDocumentId?: string;
              submittedAt?: string;
            };
            const proof = proofs.find((d) => d.id === offline.proofDocumentId);
            const mismatch = txn.metadata.amountMismatch as
              | { expected: number; received: number }
              | undefined;

            return (
              <li key={txn.id}>
                <Record
                  title={`${payer?.fullName ?? payer?.email ?? 'Unknown payer'} — ${
                    txn.context === 'application' ? 'application fee' : 'tuition'
                  }`}
                  meta={`Submitted ${
                    offline.submittedAt
                      ? new Date(offline.submittedAt).toLocaleDateString('en-NG')
                      : txn.updatedAt.toLocaleDateString('en-NG')
                  }`}
                >
                  <dl className="m-0 mb-5 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                    <div>
                      <dt className="t-caption m-0 text-ink-700">Amount charged</dt>
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
                    <div>
                      <dt className="t-caption m-0 text-ink-700">Sent from</dt>
                      <dd className="t-body-sm m-0 ml-0 text-ink-900">
                        {offline.payerName ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="t-caption m-0 text-ink-700">Dated</dt>
                      <dd className="t-body-sm m-0 ml-0 text-ink-900">{offline.paidOn ?? '—'}</dd>
                    </div>
                  </dl>

                  {mismatch ? (
                    <div className="mb-5">
                      <Banner tone="danger" title="The amount settled is not the amount charged">
                        <p>
                          Charged ₦{(mismatch.expected / 100).toLocaleString('en-NG')}, settled ₦
                          {(mismatch.received / 100).toLocaleString('en-NG')}. This is a card
                          payment held for a decision, not a transfer — reconcile it with Paystack
                          before approving, and refund the difference through them if it stands.
                        </p>
                      </Banner>
                    </div>
                  ) : null}

                  {mismatch ? null : proof ? (
                    <p className="t-body-sm mt-0 mb-5">
                      {/* CMP-13: short-lived signed URL. The object is never
                          publicly addressable and the link expires whether or
                          not anyone remembers it exists. */}
                      <a
                        href={signedUrl(proof.objectKey)}
                        className="text-authority underline underline-offset-2"
                        target="_blank"
                        rel="noopener"
                      >
                        Open what the payer sent ({proof.filename})
                      </a>
                      <span className="t-caption ml-2 text-ink-700">
                        · link expires in minutes · opening it is recorded
                      </span>
                    </p>
                  ) : (
                    <p className="t-body-sm mt-0 mb-5 text-warning">
                      No file is attached to this submission.
                    </p>
                  )}

                  <OfflineDecision transactionId={txn.id} reference={txn.reference} />
                </Record>
              </li>
            );
          })}
        </ul>
      )}

      <p className="t-body-sm mt-10">
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
