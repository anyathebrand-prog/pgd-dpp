import { and, asc, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, feeItems, institutions, programmes } from '@/db/schema';
import { tenantUrl } from '@/lib/tenant';
import { Footer, TopBar } from '@/components/shell';
import { EmptyState, LinkButton, Naira } from '@/components/ui';
import { InstitutionCard } from '@/components/institution-card';

/**
 * PB-02 institution and programme browse.
 *
 * The comparison a candidate is actually making is fee, intake date and
 * whether places remain — so those are the three facts on each card, rather
 * than marketing copy about each university. Everything here is public and
 * unauthenticated, so it reads only shared tables and published cohort data.
 */
export default async function Programmes() {
  const live = await db
    .select()
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  // This page aggregates ACROSS tenants, but it does so as a series of
  // per-tenant reads rather than by bypassing RLS. Each institution's fees and
  // intake are fetched in that institution's own context, which is both the
  // documented mechanism and a smaller blast radius than one unscoped query.
  // The loop is bounded by the number of live institutions (target: 5).
  const perInstitution = await Promise.all(
    live.map(async (inst) => {
      const [intake] = await withTenant(inst.id, (tx) =>
        tx
          .select()
          .from(cohorts)
          .where(and(eq(cohorts.institutionId, inst.id), eq(cohorts.status, 'open')))
          .orderBy(asc(cohorts.startsAt))
          .limit(1),
      );
      const fees = await withTenant(inst.id, (tx) =>
        tx.select().from(feeItems).where(eq(feeItems.institutionId, inst.id)),
      );
      const [summary] = await withTenant(inst.id, (tx) =>
        tx.select().from(programmes).where(eq(programmes.institutionId, inst.id)).limit(1),
      );
      return {
        inst,
        intake: intake ?? null,
        summary: summary ?? null,
        applicationFee: fees.find((f) => f.kind === 'application') ?? null,
        tuition: fees.find((f) => f.kind === 'tuition') ?? null,
      };
    }),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1200px] px-4 py-12 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Where you can study</h1>
        <p className="t-body-lg measure mt-4 text-ink-700">
          The same diploma, awarded by each university under its own accreditation. Fees, entry
          requirements and calendars are set by the institution; the platform runs admissions,
          payments and the library.
        </p>

        {live.length === 0 ? (
          <div className="mt-12">
            <EmptyState heading="No institutions are open for applications yet">
              When a university opens an intake it will be listed here.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-12 grid list-none gap-5 p-0 md:grid-cols-2">
            {perInstitution.map(({ inst, intake, applicationFee, tuition, summary }) => {
              return (
                <InstitutionCard key={inst.id} inst={inst}>
                  {summary?.summary ? (
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">{summary.summary}</p>
                  ) : null}

                  <dl className="t-body-sm m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-ink-900">
                    <dt className="text-ink-700">Application fee</dt>
                    <dd className="m-0">
                      {applicationFee ? <Naira kobo={applicationFee.amountKobo} /> : '—'}
                    </dd>

                    <dt className="text-ink-700">Tuition</dt>
                    <dd className="m-0">
                      {tuition ? <Naira kobo={tuition.amountKobo} /> : 'Published by the institution'}
                    </dd>

                    <dt className="text-ink-700">Next intake</dt>
                    <dd className="m-0">
                      {intake
                        ? `${intake.name} — starts ${intake.startsAt?.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }) ?? 'to be confirmed'}`
                        : 'No intake open'}
                    </dd>

                    <dt className="text-ink-700">Applications close</dt>
                    <dd className="m-0">
                      {intake?.applicationClosesAt
                        ? intake.applicationClosesAt.toLocaleDateString('en-NG', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })
                        : '—'}
                    </dd>
                  </dl>

                  <div className="mt-5">
                    {intake ? (
                      <LinkButton href={tenantUrl(inst.slug)} size="dense">
                        Apply to {inst.shortName}
                      </LinkButton>
                    ) : (
                      <LinkButton href={tenantUrl(inst.slug)} size="dense">
                        See the programme
                      </LinkButton>
                    )}
                  </div>
                </InstitutionCard>
              );
            })}
          </ul>
        )}

        <p className="t-caption mt-12 text-ink-700">
          The application fee is set by each institution, charged at submission, and is not
          refundable. Tuition is charged only after an offer has been made and accepted.
        </p>
      </main>
      <Footer />
    </>
  );
}
