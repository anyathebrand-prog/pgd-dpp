import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, consentRecords, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import {
  APPLICATION_STEPS,
  completeness,
  getOrCreateApplication,
  openQueries,
  statusSentence,
  stepperFor,
} from '@/modules/admissions/application';
import { TopBar, Footer } from '@/components/shell';
import {
  Banner,
  DataString,
  EmptyState,
  LinkButton,
  Naira,
  Panel,
  Record,
  StatusStepper,
} from '@/components/ui';

/**
 * AP-01 application dashboard and status tracker (APP-07).
 *
 * This is the screen a candidate refreshes at midnight. It answers one
 * question — where has my application got to — before it offers anything else,
 * and it never leaves the status ambiguous.
 */
export default async function ApplyDashboard() {
  const me = await requireUser();
  const institution = await requireInstitution();

  if (me.status === 'pending') redirect('/signup/verify');

  const app = await getOrCreateApplication(institution.id, me.userId);

  if (!app) {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[1120px] px-4 py-12 md:px-8">
          <EmptyState
            heading="No intake is open at this institution"
            action={<LinkButton href="/">See the programme page</LinkButton>}
          >
            When {institution.shortName} opens its next cohort, you will be able to start an
            application here.
          </EmptyState>
        </main>
        <Footer />
      </>
    );
  }

  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, app.cohortId)).limit(1),
  );

  const grants = await db
    .select({ purpose: consentRecords.purpose, granted: consentRecords.granted })
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId));
  const consented = new Set(grants.filter((g) => g.granted).map((g) => g.purpose));
  const state = await completeness(app, consented);
  const queries = await openQueries(app);

  const payments = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).where(eq(transactions.applicationId, app.id)),
  );

  const nextStep = APPLICATION_STEPS.find(
    (s) => s.key !== 'review' && !state[s.key as keyof typeof state],
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-12 md:px-8">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <h1 className="t-h1 mt-2 text-ink-900">Your application</h1>
        <p className="t-caption mt-2 text-ink-700">
          Reference <DataString value={app.reference} label="Application reference" /> ·{' '}
          {cohort?.name}
        </p>

        <div className="mt-10 rounded-md border border-ink-300 p-6">
          <StatusStepper sentence={statusSentence(app)} steps={stepperFor(app)} />
        </div>

        {queries.length > 0 ? (
          <div className="mt-8">
            <Banner tone="warning" title="A document needs replacing">
              <ul className="m-0 list-disc pl-5">
                {queries.map((q) => (
                  <li key={q.id}>
                    <strong>{q.documentKind.replace(/_/g, ' ')}:</strong> {q.note}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                <Link href="/apply/documents" className="text-ink-900 underline underline-offset-2">
                  Replace that document
                </Link>{' '}
                — nothing else needs to change.
              </p>
            </Banner>
          </div>
        ) : null}

        {app.status === 'admitted' || app.status === 'offer_accepted' ? (
          <div className="mt-8">
            <Banner tone="info" title="You have an offer">
              <p>
                <Link href="/apply/outcome" className="text-ink-900 underline underline-offset-2">
                  Read your offer and accept it
                </Link>
                .
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-10 grid gap-8 md:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="t-h2 m-0 text-ink-900">What is left to do</h2>
            {state.outstanding.length === 0 ? (
              <p className="t-body mt-3 text-ink-700">
                Nothing. Your application is complete
                {app.status === 'draft' ? ' and ready to submit.' : '.'}
              </p>
            ) : (
              <ul className="t-body mt-4 list-disc pl-5 text-ink-900">
                {state.outstanding.map((o) => (
                  <li key={`${o.href}-${o.label}`}>
                    <Link href={o.href} className="text-ink-900 underline underline-offset-2">
                      {o.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8 flex flex-wrap gap-4">
              {app.status === 'draft' || app.status === 'awaiting_application_fee' ? (
                <LinkButton href={nextStep?.href ?? '/apply/review'}>
                  {state.outstanding.length === 0 ? 'Review and submit' : 'Continue the application'}
                </LinkButton>
              ) : null}
              {app.status === 'awaiting_application_fee' ? (
                <LinkButton href="/pay/application" variant="secondary">
                  Pay the application fee
                </LinkButton>
              ) : null}
            </div>
          </div>

          <aside className="space-y-6">
            <Panel title="Payments">
              {payments.length === 0 ? (
                <p className="t-body-sm m-0 text-ink-700">Nothing has been charged yet.</p>
              ) : (
                <ul className="m-0 list-none space-y-3 p-0">
                  {payments.map((p) => (
                    <li key={p.id} className="t-body-sm">
                      <span className="block text-ink-900">
                        <Naira kobo={p.amountKobo} /> ·{' '}
                        {p.context === 'application' ? 'Application fee' : 'Tuition'}
                      </span>
                      <span
                        className={
                          p.status === 'success' ? 't-caption text-verified-text' : 't-caption text-ink-700'
                        }
                      >
                        {p.status === 'success' ? 'Confirmed' : p.status} ·{' '}
                        <DataString value={p.reference} label="Payment reference" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Your documents">
              <p className="t-body-sm m-0 text-ink-700">
                Held encrypted, opened by registry staff only through links that expire in minutes,
                and every opening logged.
              </p>
              <p className="t-body-sm mt-3 mb-0">
                <Link href="/account/privacy" className="text-ink-900 underline underline-offset-2">
                  Your privacy settings
                </Link>
              </p>
            </Panel>
          </aside>
        </div>

        {app.status === 'enrolled' ? (
          <div className="mt-10">
            <Record title="You are enrolled" meta="Your student portal is open">
              <LinkButton href="/dashboard">Go to your dashboard</LinkButton>
            </Record>
          </div>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
