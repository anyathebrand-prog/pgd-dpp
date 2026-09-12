import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, certificates, cohorts } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution, platformUrl } from '@/lib/tenant';
import { DataString, LinkButton, Seal } from '@/components/ui';

/**
 * AP-11 admission letter (APP-10).
 *
 * §3.1 puts the letter on Literata: it is a document the institution is
 * issuing, not interface, and it should not read like the chrome around it.
 * The letterhead is one of exactly four places `--tenant-brand` is allowed to
 * appear (§2.5).
 *
 * Production renders this same markup to PDF through Playwright (§7.2), which
 * is why the layout is print-first and carries no navigation of its own.
 */
export default async function AdmissionLetter() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [app] = await withTenant(institution.id, (tx) =>
    tx.select().from(applications).where(eq(applications.userId, me.userId)).limit(1),
  );
  if (!app) redirect('/apply');

  // The letter exists only once an offer has been issued. Before that there is
  // nothing to show and nothing to verify.
  const offered = ['admitted', 'offer_accepted', 'enrolled'].includes(app.status);
  if (!offered) redirect('/apply');

  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, app.cohortId)).limit(1),
  );

  const [letter] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(certificates)
      .where(
        and(eq(certificates.applicationId, app.id), eq(certificates.kind, 'admission_letter')),
      )
      .limit(1),
  );

  const personal = app.personal as Record<string, string>;
  const holder = personal.fullName ?? me.fullName ?? me.email;

  return (
    <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
      <p className="t-body-sm m-0 print:hidden">
        <Link href="/apply/outcome" className="text-ink-700 underline underline-offset-2">
          Back to your offer
        </Link>
      </p>

      <article className="mt-6 rounded-md bg-record p-8">
        {/* Letterhead. The tenant brand is permitted here. */}
        <div className="mb-6 h-1 w-24" style={{ background: 'var(--tenant-brand)' }} aria-hidden="true" />
        <p className="t-label m-0 text-ink-900">{institution.name}</p>
        <p className="t-caption mt-1 mb-8 text-ink-700">
          {institution.city ? `${institution.city}, Nigeria` : 'Nigeria'}
        </p>

        <h1 className="t-read-h m-0 text-ink-900">Offer of admission</h1>
        <p className="t-caption mt-2 mb-8 text-ink-700">
          Issued{' '}
          {(letter?.issuedAt ?? app.decisionAt ?? new Date()).toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>

        <div className="t-read measure-read text-ink-900">
          <p className="mt-0">Dear {holder},</p>
          <p>
            I am pleased to offer you a place on the Post Graduate Diploma in Data Protection
            &amp; Privacy at {institution.name}, beginning with the {cohort?.name ?? 'next'}{' '}
            cohort.
          </p>
          <p>
            This offer is made on the basis of the credentials you submitted under application
            reference {app.reference}, which the registry has verified.
          </p>
          {app.offerExpiresAt ? (
            <p>
              To accept, pay the acceptance and tuition fees by{' '}
              {app.offerExpiresAt.toLocaleDateString('en-NG', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . After that date the offer lapses and the place is released to another candidate.
            </p>
          ) : null}
          {app.decisionNote ? <p>{app.decisionNote}</p> : null}
          <p className="mb-0">Yours sincerely,</p>
          <p className="mt-1">The Registry, {institution.name}</p>
        </div>

        {letter ? (
          <div className="mt-10 border-t border-ink-700/25 pt-6">
            <div className="flex flex-wrap items-center gap-6">
              {/* The seal sits on Manila here, so it takes no Signal ring —
                  Signal on Manila is 2.44:1 and fails even the non-text
                  threshold (§2.4). */}
              <Seal label="Verified admission letter" onPaper={false} />
              <div>
                <p className="t-caption m-0 text-ink-700">Verification code</p>
                <p className="t-data-lg m-0 select-all text-ink-900">
                  <DataString value={letter.verificationCode} size="lg" label="Verification code" />
                </p>
                <p className="t-caption mt-2 mb-0 text-ink-700">
                  Anyone can check this at {platformUrl('/verify')} without an account, and will
                  see only that the letter is valid and who issued it.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </article>

      <div className="mt-10 flex flex-wrap gap-4 print:hidden">
        {app.status === 'admitted' ? (
          <LinkButton href="/apply/outcome">Accept this offer</LinkButton>
        ) : (
          <LinkButton href="/apply" variant="secondary">
            Back to my application
          </LinkButton>
        )}
      </div>

      <p className="t-caption mt-8 text-ink-700 print:hidden">
        Use your browser&apos;s print option to keep a copy. The verification code is what makes a
        printed copy checkable — it is not decoration.
      </p>
    </main>
  );
}
