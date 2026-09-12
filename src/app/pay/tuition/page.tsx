import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { tuitionCart } from '@/modules/payments/fees';
import { startTuitionCheckout } from '@/modules/payments/actions';
import { Banner, Button, Naira, Record } from '@/components/ui';

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

      <form action={startTuitionCheckout} className="mt-16">
        <Button type="submit" className="min-w-[240px]">
          Pay ₦{(cart.totalKobo / 100).toLocaleString('en-NG')} and enrol
        </Button>
      </form>
    </main>
  );
}
