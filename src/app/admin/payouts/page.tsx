import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { isSimulated, listBanks } from '@/lib/paystack';
import { Banner, DataString, Panel, Record } from '@/components/ui';
import { PayoutConfirm, PayoutLookup } from '@/components/payout-panels';

/**
 * IA-07 payout setup (PAY-06).
 *
 * Four states, and the flow names all of them: not configured (which blocks
 * taking payment at all), pending verification, name mismatch, active. The
 * first matters most — IA-01's checklist calls it blocking, because an
 * institution that discovers at checkout that it cannot be paid has already
 * taken a candidate's application fee nowhere.
 *
 * The two-step shape is the requirement rather than a flourish: the account
 * name is resolved with the bank and shown for explicit confirmation before
 * anything is saved, because Paystack is not liable for payouts to a wrong
 * account and a transposed digit is a valid account belonging to a stranger.
 */
export default async function Payouts({
  searchParams,
}: {
  searchParams: Promise<{
    bank?: string;
    account?: string;
    name?: string;
    configured?: string;
    change?: string;
  }>;
}) {
  const institution = await requireInstitution();
  await requireRole('institution_admin');
  const { bank, account, name, configured, change } = await searchParams;

  const [current] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institution.id))
    .limit(1);

  const banks = await listBanks();
  const active = Boolean(current?.paystackSubaccountCode && current?.payoutVerifiedAt);
  const confirming = Boolean(bank && account && name);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Where your money goes</h1>
        <p className="t-caption m-0 text-ink-700">{active ? 'Active' : 'Not configured'}</p>
      </div>

      {configured ? (
        <div className="mb-8">
          <Banner tone="verified" title="Payouts are configured">
            <p>
              Payments from candidates at {institution.shortName} now split automatically at
              settlement: your share to this account, the remainder to the platform.
            </p>
          </Banner>
        </div>
      ) : null}

      {!active && !confirming && !configured ? (
        <div className="mb-8">
          {/* The blocking state, stated where it is discovered rather than at
              checkout. */}
          <Banner tone="danger" title="You cannot take payment until this is done">
            <p>
              Money collected has nowhere to settle to. Candidates can browse your programme and
              start an application, and the moment one tries to pay the fee they will be stopped.
            </p>
          </Banner>
        </div>
      ) : null}

      {isSimulated() ? (
        <div className="mb-8">
          <Banner tone="info" title="No Paystack keys are configured">
            <p>
              Account lookup is answered locally, so the whole flow can be walked — but the name it
              returns is invented and no real subaccount is created. Set PAYSTACK_SECRET_KEY to
              talk to the bank for real.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          {active && !change && !confirming ? (
            <Record
              title={current.bankAccountName ?? 'Configured'}
              meta={`${current.bankName} · ${current.bankAccountNumber}`}
            >
              <p className="t-body-sm mt-0 mb-4 text-ink-700">
                Verified with the bank on{' '}
                {current.payoutVerifiedAt?.toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                . You keep {current.paystackSharePercent}% of each payment.
              </p>
              <p className="t-caption m-0 text-ink-700">
                Subaccount{' '}
                <DataString
                  value={current.paystackSubaccountCode ?? ''}
                  label="Paystack subaccount code"
                />
              </p>
            </Record>
          ) : confirming ? (
            <Panel title="Is this your account?">
              <PayoutConfirm
                bankCode={bank!}
                bankName={banks.find((b) => b.code === bank)?.name ?? 'Your bank'}
                accountNumber={account!}
                accountName={name!}
                sharePercent={current?.paystackSharePercent ?? 90}
              />
            </Panel>
          ) : (
            <Panel title={active ? 'Change your payout account' : 'Add your payout account'}>
              <PayoutLookup
                banks={banks}
                bankCode={current?.bankCode ?? ''}
                accountNumber={change ? '' : (current?.bankAccountNumber ?? '')}
              />
            </Panel>
          )}

          {active && !change && !confirming ? (
            <div className="mt-8">
              <Panel title="Changing it">
                <p className="t-body-sm mt-0 mb-4 text-ink-700">
                  Where money settles is the most consequential setting on this platform, so
                  changing it goes through the same two steps: the bank confirms the name, and
                  someone reads it before anything is saved.
                </p>
                <Link
                  href="/admin/payouts?change=1"
                  className="t-body-sm text-ink-900 underline underline-offset-2"
                >
                  Change the payout account
                </Link>
              </Panel>
            </div>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Panel title="How the split works">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Paystack splits each payment at settlement. Your share goes to the account above; the
              commission goes to the platform. Nobody moves money afterwards, which is why the
              account has to be right before the first payment rather than after it.
            </p>
            <p className="t-body-sm m-0 text-ink-700">
              Paystack&apos;s own fee comes off your share, which is the arrangement the
              institutional agreement assumes.
            </p>
          </Panel>

          <Panel title="What we store">
            <p className="t-body-sm m-0 text-ink-700">
              The bank, the account number, the name the bank returned, and the subaccount code.
              Card details never touch this platform — Paystack holds those and we never see them.
            </p>
          </Panel>
        </aside>
      </div>

      <p className="t-body-sm mt-10">
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
