import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { feeFor } from '@/modules/payments/fees';
import { startApplicationFeeCheckout } from '@/modules/payments/actions';
import { Banner, Naira, Record } from '@/components/ui';
import { ActionButton } from '@/components/action-button';

/**
 * PY-01. §7: a checkout screen states the amount, what it buys, and what
 * happens if it goes wrong — before the button, not after it.
 */
export default async function ApplicationCheckout() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [app] = await withTenant(institution.id, (tx) =>
    tx.select().from(applications).where(eq(applications.userId, me.userId)).limit(1),
  );
  if (!app) redirect('/apply');
  if (app.status !== 'awaiting_application_fee') redirect('/apply');

  const fee = await feeFor(institution.id, 'application', app.cohortId);
  if (!fee) redirect('/apply');

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
      <h1 className="t-h1 m-0 text-ink-900">Pay your application fee</h1>
      <p className="t-body mt-3 mb-8 text-ink-700">{institution.name}</p>

      <Record title={fee.label} meta="Charged once, at submission">
        <p className="t-data-lg m-0 text-ink-900">
          <Naira kobo={fee.amountKobo} />
        </p>
      </Record>

      <div className="mt-8">
        <Banner tone="warning" title="This fee is not refundable">
          <p>
            It covers the registry&apos;s review of your credentials and is not returned if your
            application is unsuccessful or if you withdraw. Tuition is charged separately, and only
            after you have been offered a place and accepted it.
          </p>
        </Banner>
      </div>

      <p className="t-body-sm mt-8 text-ink-700">
        Payment is taken by Paystack. Your card details go to them directly and never reach this
        platform — we never see or store them.
      </p>

      <div className="mt-16">
        <ActionButton
          action={startApplicationFeeCheckout}
          label={`Pay ₦${(fee.amountKobo / 100).toLocaleString('en-NG')}`}
          pendingLabel="Opening checkout"
        />
      </div>

      <p className="t-body-sm mt-6">
        <Link href="/apply" className="text-ink-700 underline underline-offset-2">
          Back to my application
        </Link>
      </p>
    </main>
  );
}
