import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { tuitionCart } from '@/modules/payments/fees';
import { startTuitionCheckout } from '@/modules/payments/actions';
import { Banner, Naira, Record } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { installmentDueDates, splitInstallments } from '@/modules/payments/installments';

/**
 * PY-05. PAY-01's cart: acceptance fee, tuition and whatever mandatory levies
 * the institution configured, itemised rather than rolled into one number.
 *
 * The gate is in the query, not in the UI — reaching this URL without an
 * accepted offer redirects, because §5.1 makes that a state machine rule, not
 * a navigation convention.
 */
export default async function TuitionCheckout() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [app] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, me.userId), eq(applications.status, 'offer_accepted')))
      .limit(1),
  );
  if (!app) redirect('/apply');

  const cart = await tuitionCart(institution.id, app.cohortId);

  // PAY-09. Offered only when the institution has turned it on; otherwise
  // the option does not exist on the page at all (PY-05: hidden entirely,
  // not shown and disabled).
  const parts = institution.tuitionInstallments;
  const plan =
    parts > 1 && cart.totalKobo > 0
      ? {
          amounts: splitInstallments(cart.totalKobo, parts),
          dues: installmentDueDates(parts, new Date(), institution.installmentIntervalDays),
        }
      : null;

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
      <h1 className="t-h1 m-0 text-ink-900">Accept your place</h1>
      <p className="t-body mt-3 mb-8 text-ink-700">
        {institution.name}. Your enrolment and matriculation number are created when this payment
        settles.
      </p>

      <Record title="What you are paying" meta={`${cart.lines.length} items`}>
        <ul className="m-0 list-none space-y-2 p-0">
          {cart.lines.map((line) => (
            <li key={line.id} className="t-body-sm flex justify-between gap-4 text-ink-900">
              <span>{line.label}</span>
              <Naira kobo={line.amountKobo} />
            </li>
          ))}
        </ul>
        <p className="t-data-lg mt-5 mb-0 flex justify-between border-t border-ink-700/30 pt-4 text-ink-900">
          <span>Total</span>
          <Naira kobo={cart.totalKobo} />
        </p>
      </Record>

      <div className="mt-8">
        <Banner tone="info" title="If you withdraw later">
          <p>
            Tuition refunds follow {institution.shortName}&apos;s published policy and are handled by
            the institution. The application fee you already paid is not part of that.
          </p>
        </Banner>
      </div>

      <div className="mt-16">
        <ActionButton
          action={startTuitionCheckout}
          label={`Pay ₦${(cart.totalKobo / 100).toLocaleString('en-NG')} and enrol`}
          pendingLabel="Opening checkout"
          hidden={{ plan: 'full' }}
        />
      </div>

      {plan ? (
        <div className="mt-10 border-t border-ink-300 pt-8">
          <h2 className="t-h3 m-0 text-ink-900">Or pay in {parts} parts</h2>
          <p className="t-body-sm mt-2 mb-4 text-ink-700">
            You are enrolled when the first part settles. If a later part is not paid by its due
            date, lessons are paused until it is, and resume the moment it settles. Nothing you
            have done is lost in the meantime.
          </p>
          <ol className="m-0 mb-6 grid list-none gap-2 p-0">
            {plan.amounts.map((amount, i) => (
              <li key={i} className="t-body-sm flex justify-between gap-4 text-ink-900">
                <span>
                  Part {i + 1}
                  <span className="text-ink-700">
                    {' '}
                    ·{' '}
                    {i === 0
                      ? 'now'
                      : `due ${plan.dues[i].toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  </span>
                </span>
                <Naira kobo={amount} />
              </li>
            ))}
          </ol>
          <ActionButton
            action={startTuitionCheckout}
            label={`Pay part 1, ₦${(plan.amounts[0] / 100).toLocaleString('en-NG')}, and enrol`}
            pendingLabel="Opening checkout"
            variant="secondary"
            hidden={{ plan: 'installments' }}
          />
        </div>
      ) : null}

      {/* PAY-11: tuition is the payment most often settled by an employer or a
          state agency, by transfer. Finding that out by failing a card payment
          first is not a discovery flow. */}
      <p className="t-body-sm mt-6">
        <Link href="/pay/offline" className="text-ink-900 underline underline-offset-2">
          Paying by bank transfer instead?
        </Link>
      </p>
    </main>
  );
}
