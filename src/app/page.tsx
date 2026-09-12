import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, institutions, programmes } from '@/db/schema';
import { currentInstitution, tenantUrl } from '@/lib/tenant';
import { Footer, TopBar } from '@/components/shell';
import { LinkButton, Naira, Panel, Record, Redacted } from '@/components/ui';
import { feeFor } from '@/modules/payments/fees';

/**
 * PB-01 platform landing, or PB-03 the institution's programme page when a
 * tenant subdomain resolved. One file, because the difference is the content,
 * not the shape.
 */
export default async function Home() {
  const institution = await currentInstitution();
  return institution ? <TenantHome /> : <PlatformLanding />;
}

/* -------------------------------------------------------------------- PB-01 */

async function PlatformLanding() {
  const live = await db
    .select()
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  return (
    <>
      <TopBar />
      <main id="main">
        {/* §7 PB-01: the redaction bar is permitted here as a brand device,
            and only here, because nothing is being hidden from anyone. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-8 md:py-24">
            <div className="mb-8 h-5 w-40 bg-ink-900" aria-hidden="true" />
            <h1 className="t-display measure m-0 text-ink-900">
              Nigeria needs data protection officers who actually know the Act.
            </h1>
            <p className="t-body-lg measure mt-6 text-ink-700">
              A Post Graduate Diploma in Data Protection &amp; Privacy, awarded by accredited
              Nigerian universities and delivered online. Apply, study and qualify without leaving
              your job.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <LinkButton href="/programmes">Browse institutions</LinkButton>
              <LinkButton href="/trust" variant="secondary">
                How we handle your data
              </LinkButton>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-16 md:px-8">
          <h2 className="t-h2 m-0 text-ink-900">Where you can study</h2>
          <p className="t-body measure mt-2 text-ink-700">
            Each university sets its own fees, entry requirements and calendar, and awards its own
            credential. The platform runs the admissions, payments and library.
          </p>
          <ul className="mt-8 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
            {live.map((inst) => (
              <Record
                as="li"
                key={inst.id}
                title={inst.name}
                meta={inst.city ?? undefined}
              >
                <a
                  href={tenantUrl(inst.slug)}
                  className="t-body-sm font-semibold text-authority underline underline-offset-2"
                >
                  View the programme at {inst.shortName}
                </a>
              </Record>
            ))}
          </ul>
          {live.length === 0 ? (
            <p className="t-body mt-6 text-ink-700">No institutions are open for applications yet.</p>
          ) : null}
        </section>

        <section className="border-t border-ink-300">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-16 md:grid-cols-3 md:px-8">
            <Panel title="What you study">
              <p className="t-body-sm m-0 text-ink-700">
                The NDPA 2023 and GAID 2025 as they are enforced, not as they are summarised.
                Assessment, breach handling, DPIAs, cross-border transfers, and the practice of the
                DPO role.
              </p>
            </Panel>
            <Panel title="The library">
              <p className="t-body-sm m-0 text-ink-700">
                Nigerian legislation, NDPC guidance and enforcement decisions, and privacy judgments,
                in one searchable place. Every item carries its source and its licence. Access
                continues after you graduate.
              </p>
            </Panel>
            <Panel title="What we hold about you">
              <p className="t-body-sm m-0 mb-3 text-ink-700">
                We are processing credentials and a photograph of your face while teaching privacy.
                Consent is asked for separately, per purpose, and can be withdrawn.
              </p>
              <Redacted label="National Identification Number — collected only where a university requires it" />
            </Panel>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/* -------------------------------------------------------------- PB-03/PB-04 */

async function TenantHome() {
  const institution = await currentInstitution();
  if (!institution) return null;

  // programmes and cohorts are tenant-scoped: without tenant context RLS
  // correctly returns nothing and this page would render an empty programme.
  const [programme] = await withTenant(institution.id, (tx) =>
    tx.select().from(programmes).where(eq(programmes.institutionId, institution.id)).limit(1),
  );

  const open = programme
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(cohorts)
          .where(eq(cohorts.programmeId, programme.id))
          .orderBy(asc(cohorts.startsAt)),
      )
    : [];

  const applicationFee = await feeFor(institution.id, 'application');

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-12 md:px-8">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <h1 className="t-h1 measure mt-2 text-ink-900">
          {programme?.title ?? 'Post Graduate Diploma in Data Protection & Privacy'}
        </h1>
        <p className="t-body-lg measure mt-4 text-ink-700">{programme?.summary}</p>

        <div className="mt-12 grid gap-8 md:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="t-h2 m-0 text-ink-900">Intakes open now</h2>
            <ul className="mt-6 grid list-none gap-5 p-0">
              {open
                .filter((c) => c.status === 'open')
                .map((c) => (
                  <Record
                    as="li"
                    key={c.id}
                    title={c.name}
                    meta={
                      c.startsAt
                        ? `Teaching starts ${c.startsAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} · ${c.capacity} places`
                        : undefined
                    }
                  >
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">
                      Applications close{' '}
                      {c.applicationClosesAt?.toLocaleDateString('en-NG', {
                        day: 'numeric',
                        month: 'long',
                      }) ?? 'when the cohort fills'}
                      .
                    </p>
                    <LinkButton href={`/signup?cohort=${c.id}`}>Start an application</LinkButton>
                  </Record>
                ))}
            </ul>
            {open.filter((c) => c.status === 'open').length === 0 ? (
              <p className="t-body mt-6 text-ink-700">
                No intake is open at {institution.shortName} right now.
              </p>
            ) : null}
          </div>

          <aside className="space-y-6">
            <Panel title="What it costs">
              <dl className="m-0">
                <dt className="t-body-sm m-0 text-ink-700">Application fee</dt>
                <dd className="m-0 mb-3 ml-0">
                  {applicationFee ? <Naira kobo={applicationFee.amountKobo} /> : '—'}
                </dd>
              </dl>
              {/* §5.1: non-refundable, and disclosed as such before payment — not
                  in terms after it. */}
              <p className="t-body-sm m-0 text-ink-700">
                The application fee is non-refundable and is charged when you submit. Tuition is
                payable only if you are offered a place and accept it.
              </p>
            </Panel>
            <Panel title="Entry requirements">
              <p className="t-body-sm m-0 whitespace-pre-line text-ink-700">
                {programme?.entryRequirements ?? 'Published by the institution.'}
              </p>
            </Panel>
            <Panel title="Already applied?">
              <Link href="/apply" className="t-body-sm text-ink-900 underline underline-offset-2">
                Check the status of your application
              </Link>
            </Panel>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
