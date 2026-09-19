import Link from 'next/link';
import { and, asc, count, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, institutions, libraryItems, programmes } from '@/db/schema';
import { currentInstitution, tenantUrl } from '@/lib/tenant';
import { Footer, TopBar } from '@/components/shell';
import { LinkButton, Naira, Panel, Record, Redacted } from '@/components/ui';
import { LandingNav } from '@/components/landing-nav';
import { LandingFooter } from '@/components/landing-footer';
import { RotatingClaim } from '@/components/landing-hero';
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

/**
 * §7: the hero is the type treatment. The syllabus, the steps and the
 * questions below it are the rest of what a person needs before they will
 * spend ₦25,000 on an application — written out rather than gestured at,
 * because "world-class curriculum" is what every unaccredited programme in
 * the market also says.
 */
const SYLLABUS = [
  {
    title: 'The Act itself',
    body: 'The NDPA 2023 read in full and in order — scope, the lawful bases, the rights it creates and the penalties behind them. Not a summary of a summary.',
  },
  {
    title: 'GAID 2025 in practice',
    body: 'What the General Application and Implementation Directive actually requires of a controller of major importance, on what cadence, and what evidence satisfies it.',
  },
  {
    title: 'Consent that holds up',
    body: 'Separate, purpose-specific, as easy to withdraw as to give. Where consent is the wrong basis entirely, and what to use instead.',
  },
  {
    title: 'DPIAs and privacy by design',
    body: 'Running an assessment that changes a design decision rather than one filed after the system ships.',
  },
  {
    title: 'Breach handling',
    body: 'The 72-hour clock from the moment it starts: containment, the assessment, notifying the Commission, and telling the people whose data it was.',
  },
  {
    title: 'Audit and the DPCO regime',
    body: 'Annual audit filing, working with a licensed DPCO, and the record-keeping that makes the filing a formality instead of a scramble.',
  },
];

const STEPS = [
  {
    title: 'Apply to one university',
    body: 'One form, one set of documents, one application fee — set by the institution you chose and disclosed before you pay it.',
  },
  {
    title: 'The registry reviews it',
    body: 'Staff at that university admit or decline, and you are told which, with a reason. Nothing about that decision happens on this platform without their hand on it.',
  },
  {
    title: 'Accept, pay tuition, enrol',
    body: 'Tuition is charged only after you have been offered a place and accepted it. Your matriculation number is issued when the payment settles.',
  },
  {
    title: 'Study, qualify, be verified',
    body: 'Modules, assessment and the library online. The certificate at the end carries a code an employer can check in seconds, without an account.',
  },
];

const QUESTIONS = [
  {
    q: 'Who is this for?',
    a: 'People who hold or are about to hold the DPO role — compliance and legal staff, IT and security leads, and public-sector officers who have been handed data protection on top of an existing job. It assumes no law degree.',
  },
  {
    q: 'Do I have to stop working?',
    a: 'No. Teaching is online and asynchronous, with assessment deadlines rather than fixed class hours. Each university publishes its own calendar on its programme page.',
  },
  {
    q: 'Who awards the qualification?',
    a: 'The university you applied to. This platform runs admissions, payments, teaching and verification for several institutions, but the credential is theirs and their entry requirements and fees are their own.',
  },
  {
    q: 'What does it cost?',
    a: 'Two separate payments: a non-refundable application fee when you submit, and tuition only if you are offered a place and accept it. Both are shown in naira on the institution’s page before you commit to either.',
  },
  {
    q: 'What happens to my documents if I am not admitted?',
    a: 'They are deleted on a retention schedule that runs on a timer, not on someone remembering. Until then they are never publicly addressable, and every time a member of staff opens one it is recorded against their account.',
  },
  {
    q: 'Can an employer check my certificate?',
    a: 'Yes — from the Verify page, with the code printed on it, without an account and without contacting anyone. That is the point of issuing it here rather than as a PDF.',
  },
];

async function PlatformLanding() {
  const live = await db
    .select()
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  // Every figure on this page is counted at request time. A number typed into
  // marketing copy is true exactly once — "five universities" becomes a lie
  // the first time one of them leaves, and nobody edits the hero when it does.
  // These are per-tenant reads rather than one unscoped query: the same
  // mechanism PB-02 uses, and a far smaller blast radius than bypassing RLS.
  const intakes = await Promise.all(
    live.map((inst) =>
      withTenant(inst.id, (tx) =>
        tx
          .select({ n: count() })
          .from(cohorts)
          .where(and(eq(cohorts.institutionId, inst.id), eq(cohorts.status, 'open'))),
      ),
    ),
  );
  const openIntakes = intakes.reduce((sum, [row]) => sum + Number(row?.n ?? 0), 0);

  // library_items is a shared table by design — the corpus is the same for
  // every institution — so this one needs no tenant context.
  const [{ n: libraryCount }] = await db.select({ n: count() }).from(libraryItems);

  const word = COUNT_WORDS[live.length] ?? String(live.length);
  const plural = live.length === 1 ? 'university' : 'universities';

  return (
    <>
      <LandingNav />
      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8 md:py-24">
            <p className="motion-rise t-caption m-0 text-ink-700">
              Accredited Nigerian universities · Online · NDPA 2023 and GAID 2025
            </p>

            {/* The headline is the hero. No stock photograph of students with
                laptops, no illustration, no gradient — the redaction lifting
                off the words is the whole idea, and it says what the
                qualification is for in one gesture. */}
            <h1 className="motion-rise motion-rise-1 t-display measure mt-4 mb-0 text-ink-900">
              Post Graduate Diploma in{' '}
              <span className="motion-redaction">Data Protection</span> and Privacy
            </h1>

            <div className="motion-rise motion-rise-2">
              <RotatingClaim
                claims={[
                  `One application. ${word} ${plural}.`,
                  'Taught as the Act is enforced, not as it is summarised.',
                  'A certificate an employer can verify in seconds.',
                ]}
              />
            </div>

            <p className="motion-rise motion-rise-3 t-body measure mt-4 text-ink-700">
              For the people who hold the Data Protection Officer role the NDPA 2023 created.
              Delivered online and assessed by university facilitators, so you can qualify without
              leaving the job that needs the qualification.
            </p>

            <div className="motion-rise motion-rise-4 mt-10 flex flex-wrap gap-4">
              <LinkButton href="/programmes">Browse institutions and intakes</LinkButton>
              <LinkButton href="#how" variant="secondary">
                How it works
              </LinkButton>
            </div>

            {/*
              The facts strip. The numbers do not count up from zero on load:
              an animated counter makes a figure feel like a slot machine, and
              this is a page about being precise with data.
            */}
            <dl className="mt-14 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-ink-300 pt-8 md:grid-cols-4">
              {[
                [String(live.length), live.length === 1 ? 'University' : 'Universities'],
                [String(openIntakes), openIntakes === 1 ? 'Intake open now' : 'Intakes open now'],
                [String(libraryCount), 'Items in the library'],
                ['1', 'Application, wherever you apply'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="t-data-lg m-0 text-ink-900">{value}</dd>
                  <dd className="t-caption m-0 mt-1 text-ink-700">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------- institutions */}
        <section id="institutions" className="scroll-mt-28">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">Where you can study</h2>
            <p className="t-body measure mt-2 text-ink-700">
              Each university sets its own fees, entry requirements and calendar, and awards its own
              credential. The platform runs admissions, payments, teaching and the library.
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
              <p className="t-body mt-6 text-ink-700">
                No institution is open for applications yet.
              </p>
            ) : (
              <p className="t-body-sm mt-8">
                <Link href="/programmes" className="text-ink-900 underline underline-offset-2">
                  Compare fees, intake dates and remaining places
                </Link>
              </p>
            )}
          </div>
        </section>

        {/* ----------------------------------------------------- what you study */}
        <section id="study" className="scroll-mt-28 border-t border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">What you study</h2>
            <p className="t-body measure mt-2 text-ink-700">
              Six areas, each assessed. The syllabus tracks the law as the Commission enforces it,
              which is why it is written here in the words a regulator would use rather than in the
              words a prospectus would.
            </p>
            <ul className="mt-8 grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 md:grid-cols-2 lg:grid-cols-3">
              {SYLLABUS.map((item) => (
                <li key={item.title}>
                  <div className="mb-3 h-0.5 w-12 bg-authority" aria-hidden="true" />
                  <h3 className="t-h3 m-0 text-ink-900">{item.title}</h3>
                  <p className="t-body-sm mt-2 mb-0 text-ink-700">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------- how it works */}
        <section id="how" className="scroll-mt-28 border-t border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">How it works</h2>
            <p className="t-body measure mt-2 text-ink-700">
              Four steps, and you can stop after any of them without having paid for the next one.
            </p>
            {/* Numbered because it is genuinely a sequence — the one thing the
                brief permits a number for. */}
            <ol className="mt-8 grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="border-t-2 border-ink-900 pt-4">
                  <p className="t-data m-0 text-ink-700" aria-hidden="true">
                    0{i + 1}
                  </p>
                  <h3 className="t-h4 mt-2 mb-0 text-ink-900">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="t-body-sm mt-2 mb-0 text-ink-700">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10">
              <LinkButton href="/programmes">Start an application</LinkButton>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- what we hold */}
        <section className="border-t border-ink-300">
          <div className="mx-auto grid max-w-marketing gap-8 px-4 py-16 md:grid-cols-[1.4fr_1fr] md:px-8">
            <div>
              <h2 className="t-h2 m-0 text-ink-900">What we hold about you</h2>
              <p className="t-body measure mt-3 text-ink-700">
                Applying means sending a university your degree certificate, your transcript and a
                photograph of your face. We are teaching privacy while processing exactly the kind
                of data the Act is about, so the standard we hold ourselves to is the one we teach.
              </p>
              <ul className="t-body-sm measure mt-5 list-disc space-y-2 pl-5 text-ink-900">
                <li>
                  Consent is asked for separately, per purpose, and can be withdrawn as easily as it
                  was given.
                </li>
                <li>
                  Documents are never publicly addressable. Staff open them through links that
                  expire in minutes, and every opening is recorded.
                </li>
                <li>
                  If your application is unsuccessful, your documents are deleted on a schedule that
                  runs whether or not anyone remembers it.
                </li>
                <li>You can download everything we hold about you, at any time, without asking.</li>
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

        {/* ---------------------------------------------------------------- faq */}
        <section id="faq" className="scroll-mt-28 border-t border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">Questions people actually ask</h2>
            {/*
              Native <details>. It is keyboard operable, findable by the
              browser's own find-in-page, and works before any JavaScript
              arrives — three things a hand-rolled accordion gives up in
              exchange for an animation nobody asked for.
            */}
            <ul className="mt-8 grid list-none grid-cols-1 gap-0 p-0 lg:max-w-[52rem]">
              {QUESTIONS.map((item) => (
                <li key={item.q} className="border-b border-ink-300">
                  <details className="group">
                    <summary className="motion-state t-h4 flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-ink-900 hover:text-authority">
                      {item.q}
                      <span
                        aria-hidden="true"
                        className="t-body shrink-0 text-ink-500 group-open:hidden"
                      >
                        +
                      </span>
                      <span
                        aria-hidden="true"
                        className="t-body hidden shrink-0 text-ink-500 group-open:inline"
                      >
                        −
                      </span>
                    </summary>
                    <p className="motion-appear t-body measure mt-0 mb-5 text-ink-700">{item.a}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------- resources */}
        <section id="resources" className="scroll-mt-28 border-t border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">The law, in one place</h2>
            <p className="t-body measure mt-2 text-ink-700">
              The library holds {libraryCount} items — Nigerian legislation, Commission guidance and
              enforcement decisions, and privacy judgments — each carrying its source and its
              licence, so you can tell what you are allowed to do with it. Students keep access
              after they graduate.
            </p>
            <ul className="mt-8 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  href: 'https://ndpc.gov.ng/',
                  label: 'Nigeria Data Protection Commission',
                  meta: 'The regulator: guidance, breach reporting, the DPCO register',
                  external: true,
                },
                {
                  href: '/trust',
                  label: 'Trust and compliance',
                  meta: 'Our DPO, our sub-processors, and what we do with your data',
                },
                {
                  href: '/privacy',
                  label: 'Privacy notice',
                  meta: 'Every purpose, basis and retention period, in plain words',
                },
                {
                  href: '/verify',
                  label: 'Verify a certificate',
                  meta: 'For an employer holding a certificate and a code',
                },
              ].map((link) => (
                <li key={link.href}>
                  <Panel className="h-full">
                    {link.external ? (
                      <a
                        href={link.href}
                        rel="noopener"
                        className="t-h4 text-ink-900 underline underline-offset-2"
                      >
                        {link.label}
                        <span aria-hidden="true"> ↗</span>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="t-h4 text-ink-900 underline underline-offset-2"
                      >
                        {link.label}
                      </Link>
                    )}
                    <p className="t-body-sm mt-2 mb-0 text-ink-700">{link.meta}</p>
                  </Panel>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- cta */}
        <section className="border-t border-ink-300 bg-record">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">
              One application, to the university you choose.
            </h2>
            <p className="t-body measure mt-3 text-ink-700">
              The application fee is set by each institution and charged when you submit. Tuition is
              only ever charged after you have been offered a place and accepted it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <LinkButton href="/programmes">Browse institutions and intakes</LinkButton>
              <Link
                href="/verify"
                className="t-body-sm self-center text-ink-900 underline underline-offset-2"
              >
                Or verify someone&apos;s certificate
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
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
