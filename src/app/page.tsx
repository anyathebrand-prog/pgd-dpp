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

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

async function PlatformLanding() {
  const live = await db
    .select()
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  // The headline claim is generated, not typed. "Five universities" written
  // by hand becomes a lie the first time one of them leaves.
  const count = COUNT_WORDS[live.length] ?? String(live.length);
  const plural = live.length === 1 ? 'university' : 'universities';

  return (
    <>
      <TopBar />
      <main id="main">
        {/*
          §7: the hero IS the type treatment — the headline partially redacted,
          resolving to reveal what the programme is about. No stock photography
          of students with laptops, no illustration, no gradient.
        */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-8 md:py-28">
            <h1 className="t-display measure m-0 text-ink-900">
              Post Graduate Diploma in{' '}
              <span className="motion-redaction">Data Protection</span> and Privacy
            </h1>

            <p className="t-body-lg mt-6 text-ink-900">
              One application. {count} {plural}.
            </p>
            <p className="t-body measure mt-2 text-ink-700">
              Awarded by accredited Nigerian universities and delivered online, for the people who
              will hold the DPO role the NDPA 2023 created. Apply, study and qualify without
              leaving your job.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <LinkButton href="/programmes">Browse programmes</LinkButton>
              <LinkButton href="/trust" variant="secondary">
                How we handle your data
              </LinkButton>
            </div>
          </div>
        </section>

        {/*
          Proof. The institutions are the credibility, so they come directly
          after the claim. Manila, because each card is a real filed thing —
          an institution running a real programme — not a marketing tile.
        */}
        <section className="mx-auto max-w-[1200px] px-4 py-16 md:px-8">
          <h2 className="t-h2 m-0 text-ink-900">Where you can study</h2>
          <p className="t-body measure mt-2 text-ink-700">
            Each university sets its own fees, entry requirements and calendar, and awards its own
            credential. The platform runs admissions, payments and the library.
          </p>
          <ul className="mt-8 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
            {live.map((inst) => (
              <Record as="li" key={inst.id} title={inst.name} meta={inst.city ?? undefined}>
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
            <p className="t-body mt-6 text-ink-700">No institution is open for applications yet.</p>
          ) : null}
        </section>

        {/* The ground the qualification stands on. */}
        <section className="border-t border-ink-300">
          <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">Why this qualification, now</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              <div>
                <h3 className="t-h3 m-0 text-ink-900">The law is being enforced</h3>
                <p className="t-body-sm measure mt-2 text-ink-700">
                  The NDPA 2023 and the GAID 2025, effective 19 September 2025, create recurring
                  obligations and a regulator willing to act on them. Organisations need people who
                  have read the Act rather than a summary of it.
                </p>
              </div>
              <div>
                <h3 className="t-h3 m-0 text-ink-900">Taught as practice</h3>
                <p className="t-body-sm measure mt-2 text-ink-700">
                  Lawful basis, breach handling against the 72-hour clock, DPIAs, cross-border
                  transfers, and the working reality of the DPO role — assessed, not just
                  presented.
                </p>
              </div>
              <div>
                <h3 className="t-h3 m-0 text-ink-900">A library that stays yours</h3>
                <p className="t-body-sm measure mt-2 text-ink-700">
                  Nigerian legislation, NDPC guidance and enforcement decisions, and privacy
                  judgments, in one searchable place. Every item carries its source and its
                  licence. Access continues after you graduate.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/*
          The claim this product has to be able to make. A data protection
          programme that is vague about its own processing has no standing to
          teach it.
        */}
        <section className="border-t border-ink-300">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-16 md:grid-cols-[1.4fr_1fr] md:px-8">
            <div>
              <h2 className="t-h2 m-0 text-ink-900">What we hold about you</h2>
              <p className="t-body measure mt-3 text-ink-700">
                Applying means sending a university your degree certificate, your transcript and a
                photograph of your face. We are teaching privacy while processing exactly the kind
                of data the Act is about, so the standard we hold ourselves to is the one we teach.
              </p>
              <ul className="t-body-sm measure mt-5 list-disc space-y-2 pl-5 text-ink-900">
                <li>
                  Consent is asked for separately, per purpose, and can be withdrawn as easily as
                  it was given.
                </li>
                <li>
                  Documents are never publicly addressable. Staff open them through links that
                  expire in minutes, and every opening is recorded.
                </li>
                <li>
                  If your application is unsuccessful, your documents are deleted on a schedule
                  that runs whether or not anyone remembers it.
                </li>
                <li>
                  You can download everything we hold about you, at any time, without asking.
                </li>
              </ul>
              <p className="t-body-sm mt-5">
                <Link href="/trust" className="text-ink-900 underline underline-offset-2">
                  Read the detail, including who is responsible for what
                </Link>
              </p>
            </div>

            <Panel title="Not collected">
              <p className="t-body-sm mt-0 mb-4 text-ink-700">
                Nothing in this application needs your National Identification Number, so it is not
                asked for. Collecting data because it might be useful later is the habit this
                programme exists to correct.
              </p>
              <Redacted label="National Identification Number — not collected" />
            </Panel>
          </div>
        </section>

        {/* The CTA path once more, for anyone who read down. */}
        <section className="border-t border-ink-300">
          <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">
              One application, to the university you choose.
            </h2>
            <p className="t-body measure mt-3 text-ink-700">
              The application fee is set by each institution and charged when you submit. Tuition
              is only ever charged after you have been offered a place and accepted it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <LinkButton href="/programmes">Browse programmes</LinkButton>
              <Link
                href="/verify"
                className="t-body-sm self-center text-ink-700 underline underline-offset-2"
              >
                Or verify someone&apos;s certificate
              </Link>
            </div>
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
