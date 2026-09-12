import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { acceptOffer } from '@/modules/payments/actions';
import { tuitionCart } from '@/modules/payments/fees';
import { TopBar, Footer } from '@/components/shell';
import { Banner, Button, DataString, LinkButton, Naira, Record } from '@/components/ui';

/**
 * AP-10 admission outcome, including the offer countdown (§5.5).
 *
 * The countdown shows days remaining at h2 with the full expiry date beneath,
 * never a ticking seconds timer — this is a decision someone should be able to
 * take calmly. It goes --warning below 48 hours and never --danger: an offer is
 * not an error.
 */
export default async function OutcomePage() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [app] = await withTenant(institution.id, (tx) =>
    tx.select().from(applications).where(eq(applications.userId, me.userId)).limit(1),
  );
  if (!app) redirect('/apply');

  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, app.cohortId)).limit(1),
  );

  const daysLeft = app.offerExpiresAt
    ? Math.max(0, Math.ceil((app.offerExpiresAt.getTime() - Date.now()) / 86_400_000))
    : null;
  const cart = await tuitionCart(institution.id, app.cohortId);

  const offered = app.status === 'admitted' || app.status === 'offer_accepted';

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        {offered ? (
          <>
            <h1 className="t-h1 m-0 text-ink-900">You have been offered a place</h1>
            <p className="t-body mt-3 mb-10 text-ink-700">
              {institution.name} has admitted you to the {cohort?.name} cohort of the Post Graduate
              Diploma in Data Protection &amp; Privacy.
            </p>

            <Record title="Admission letter" meta={`Reference ${app.reference}`}>
              <p className="t-body-sm mt-0 mb-4 text-ink-700">
                Your branded admission letter carries a verification code that any employer or
                registrar can check independently.
              </p>
              <LinkButton href="/apply/letter" variant="secondary" size="dense">
                Open the letter
              </LinkButton>
            </Record>

            {daysLeft !== null ? (
              <div className="mt-8 rounded-md border border-ink-300 p-5">
                <p className="t-caption m-0 text-ink-700">Time to accept</p>
                <p className={`t-h2 m-0 ${daysLeft <= 2 ? 'text-warning' : 'text-ink-700'}`}>
                  {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                </p>
                <p className="t-body-sm mt-1 mb-0 text-ink-700">
                  The offer lapses on{' '}
                  {app.offerExpiresAt?.toLocaleDateString('en-NG', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  , and the place is released to the next candidate.
                </p>
              </div>
            ) : null}

            <div className="mt-8">
              <Banner tone="info" title="What accepting costs">
                <p>
                  Accepting takes you to a checkout for <Naira kobo={cart.totalKobo} />, covering{' '}
                  {cart.lines.map((l) => l.label.toLowerCase()).join(', ')}. You are enrolled when
                  that payment settles.
                </p>
              </Banner>
            </div>

            {app.status === 'admitted' ? (
              <div className="mt-16 flex flex-wrap gap-4">
                <form action={acceptOffer}>
                  <Button type="submit">Accept and pay</Button>
                </form>
                <Link
                  href="/apply"
                  className="t-body-sm self-center text-ink-700 underline underline-offset-2"
                >
                  Decide later
                </Link>
              </div>
            ) : (
              <div className="mt-16">
                <LinkButton href="/pay/tuition">Continue to payment</LinkButton>
              </div>
            )}
          </>
        ) : app.status === 'rejected' ? (
          <>
            <h1 className="t-h1 m-0 text-ink-900">This application was not successful</h1>
            <p className="t-body mt-3 text-ink-700">
              {app.decisionNote ??
                `The registry at ${institution.shortName} assessed your application and was not able to offer you a place in this cohort.`}
            </p>
            <p className="t-body-sm mt-8 text-ink-700">
              Your uploaded documents are deleted on the retention schedule rather than kept
              indefinitely. You can ask for them to be removed sooner.
            </p>
            <p className="t-body-sm mt-2">
              <Link href="/account/privacy" className="text-ink-900 underline underline-offset-2">
                Your privacy settings
              </Link>
            </p>
          </>
        ) : app.status === 'offer_lapsed' ? (
          <>
            <h1 className="t-h1 m-0 text-ink-900">This offer has expired</h1>
            <p className="t-body mt-3 text-ink-700">
              The acceptance window closed before the fee was paid, and the place has been released.
              Contact the registry at {institution.shortName} if you believe that is wrong — they can
              reinstate an offer while a seat is still open.
            </p>
          </>
        ) : (
          <>
            <h1 className="t-h1 m-0 text-ink-900">No decision yet</h1>
            <p className="t-body mt-3 text-ink-700">
              Your application reference is{' '}
              <DataString value={app.reference} label="Application reference" />. The status tracker
              shows where it has got to.
            </p>
            <div className="mt-10">
              <LinkButton href="/apply">Back to my application</LinkButton>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
