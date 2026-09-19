import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { institutions, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { flagEnabled } from '@/lib/flags';
import { FeatureOff } from '@/components/feature-off';
import { TopBar, Footer } from '@/components/shell';
import { ActionForm } from '@/components/form';
import { Banner, DataString, Field, Input, Naira, Panel, Record } from '@/components/ui';
import { submitOfflineProof } from '@/modules/payments/offline';

/**
 * PY-06 offline payment proof upload (PAY-11).
 *
 * §5.2 calls bank transfer "how a great many Nigerian sponsors actually pay",
 * and it is usually not the candidate paying: an employer settles tuition for
 * its compliance officer, or a state agency for its staff. So the form asks
 * whose account the money came from — without it, an admin is matching an
 * unfamiliar name on a statement against nothing at all.
 *
 * The reference is the load-bearing part of this screen. A transfer that
 * arrives without one is a payment the institution cannot attribute, so it is
 * rendered as data, in mono, twice, and said to be required.
 */
export default async function OfflinePaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; submitted?: string }>;
}) {
  const me = await requireUser();
  const institution = await requireInstitution();
  const { ref, submitted } = await searchParams;

  // SA-03. The consequence named on the flags console: turning this off
  // strands anyone mid-transfer, so the copy here points them at the channel
  // that still works rather than at a closed door.
  if (!(await flagEnabled('offline_payments', institution.id))) {
    return (
      <FeatureOff title="Pay by bank transfer" institution={institution.shortName}>
        <p>
          Bank transfer is not being accepted here at the moment. You can still pay by card, and if
          you have already sent a transfer it is still in the queue to be approved — it has not
          been lost.
        </p>
      </FeatureOff>
    );
  }

  const owed = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, me.userId),
          inArray(transactions.status, ['pending', 'awaiting_approval', 'failed', 'abandoned']),
        ),
      )
      .orderBy(desc(transactions.createdAt)),
  );

  const txn = ref ? owed.find((t) => t.reference === ref) : owed[0];
  if (!txn) redirect('/billing');

  const [bank] = await db
    .select({
      bankName: institutions.bankName,
      bankAccountName: institutions.bankAccountName,
      bankAccountNumber: institutions.bankAccountNumber,
    })
    .from(institutions)
    .where(eq(institutions.id, institution.id))
    .limit(1);

  const offline = (txn.metadata.offline ?? {}) as {
    payerName?: string;
    paidOn?: string;
    rejectionReason?: string;
  };
  const awaiting = txn.status === 'awaiting_approval';

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        <h1 className="t-h1 m-0 text-ink-900">Pay by bank transfer</h1>
        <p className="t-body mt-3 mb-8 text-ink-700">{institution.name}</p>

        <Record
          title={txn.context === 'application' ? 'Application fee' : 'Tuition and acceptance fees'}
          meta={`Reference ${txn.reference}`}
        >
          <p className="t-data-lg m-0 text-ink-900">
            <Naira kobo={txn.amountKobo} />
          </p>
        </Record>

        {submitted || awaiting ? (
          <div className="mt-8">
            {/* §5 state: Submitted / Under review. The turnaround is stated
                because the alternative is a candidate refreshing a page for
                three days wondering whether anything happened. */}
            <Banner tone="info" title="With the institution for approval">
              <p>
                Your proof was received{offline.paidOn ? ` for a transfer dated ${offline.paidOn}` : ''}.
                Staff check it against the bank statement, usually within two working days. You will
                be emailed either way, and nothing further is needed from you now.
              </p>
            </Banner>
          </div>
        ) : null}

        {offline.rejectionReason && !awaiting ? (
          <div className="mt-8">
            {/* Rejected with a reason, shown verbatim — and the charge is
                still owed, which the wording has to make unambiguous. */}
            <Banner tone="warning" title="The last transfer could not be confirmed">
              <p>{offline.rejectionReason}</p>
              <p className="mt-2">
                The payment is still outstanding. Send clearer evidence below, or{' '}
                <Link
                  href={txn.context === 'application' ? '/pay/application' : '/pay/tuition'}
                  className="text-ink-900 underline underline-offset-2"
                >
                  pay by card instead
                </Link>
                .
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-10">
          <Panel title="Where to send it">
            {bank?.bankAccountNumber ? (
              <dl className="m-0 grid gap-4">
                <div>
                  <dt className="t-caption m-0 text-ink-700">Bank</dt>
                  <dd className="t-body m-0 ml-0 text-ink-900">{bank.bankName}</dd>
                </div>
                <div>
                  <dt className="t-caption m-0 text-ink-700">Account name</dt>
                  <dd className="t-body m-0 ml-0 text-ink-900">{bank.bankAccountName}</dd>
                </div>
                <div>
                  <dt className="t-caption m-0 text-ink-700">Account number</dt>
                  <dd className="m-0 ml-0">
                    <DataString value={bank.bankAccountNumber} label="Account number" />
                  </dd>
                </div>
                <div>
                  <dt className="t-caption m-0 text-ink-700">Reference to quote — required</dt>
                  <dd className="m-0 ml-0">
                    <DataString value={txn.reference} label="Payment reference" />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="t-body-sm m-0 text-ink-700">
                {institution.shortName} has not published bank details for transfers. Pay by card,
                or contact the institution.
              </p>
            )}
          </Panel>
        </div>

        <div className="mt-8">
          <Banner tone="warning" title="Quote the reference on the transfer">
            <p>
              A transfer that arrives without it cannot be matched to you, and the institution has
              to chase it by hand. Put it in the narration or description field.
            </p>
          </Banner>
        </div>

        {bank?.bankAccountNumber && !awaiting ? (
          <div className="mt-12">
            <h2 className="t-h2 m-0 mb-6 text-ink-900">Then send us the proof</h2>
            <ActionForm action={submitOfflineProof} submitLabel="Submit proof of payment">
              <input type="hidden" name="reference" value={txn.reference} />

              <Field
                label="Name on the account it was sent from"
                name="payerName"
                inputId="payerName"
                required
                helper="Often an employer or a sponsor rather than you. This is what staff look for on the statement."
              >
                <Input id="payerName" name="payerName" required defaultValue={offline.payerName ?? ''} />
              </Field>

              <Field label="Date of the transfer" name="paidOn" inputId="paidOn" required>
                <Input id="paidOn" name="paidOn" type="date" required />
              </Field>

              <Field
                label="Receipt or transfer confirmation"
                name="file"
                inputId="file"
                required
                helper="A screenshot from your banking app is fine. PDF, JPG or PNG, up to 5MB."
              >
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  required
                />
              </Field>
            </ActionForm>
          </div>
        ) : null}

        <p className="t-body-sm mt-12">
          <Link href="/billing" className="text-ink-700 underline underline-offset-2">
            Back to your payments
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
