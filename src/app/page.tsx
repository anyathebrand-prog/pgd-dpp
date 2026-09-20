import Link from 'next/link';
import { and, asc, count, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, institutions, libraryItems, programmes } from '@/db/schema';
import { currentInstitution, tenantUrl } from '@/lib/tenant';
import { marketingImages } from '@/lib/marketing-images';
import { Footer, TopBar } from '@/components/shell';
import { LinkButton, Naira, Panel, Record, Redacted } from '@/components/ui';
import { LandingNav } from '@/components/landing-nav';
import { LandingFooter } from '@/components/landing-footer';
import { RotatingClaim } from '@/components/landing-hero';
import { feeFor } from '@/modules/payments/fees';

export default async function Home() {
  const institution = await currentInstitution();
  return institution ? <TenantHome /> : <PlatformLanding />;
}

/* -------------------------------------------------------------------- PB-01 */

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/**
 * PB-01, the one marketing surface.
 *
 * Written to the Case File system in docs/04-ui-ux-brief.md: Paper is the
 * working surface, Manila appears only where the thing on screen is a filed
 * artefact, Signal means verified and nothing else. The dials for this page
 * are DESIGN_VARIANCE 4, MOTION_INTENSITY 3, VISUAL_DENSITY 4, which the
 * skill's own inference table gives for a trust first, regulated audience.
 *
 * Every figure is counted at request time. A number typed into marketing copy
 * is true exactly once: "five universities" becomes a lie the first time one
 * of them leaves, and nobody edits a hero when it does.
 *
 * Photographs come from public/marketing and each figure renders only when
 * its file is there. The reasoning is in that folder's README, and it is the
 * reason this page carries no placeholder stock imagery.
 */

const SYLLABUS = [
  {
    title: 'The Act itself',
    body: 'The NDPA 2023 read in full and in order: scope, the lawful bases, the rights it creates and the penalties behind them. Not a summary of a summary.',
  },
  {
    title: 'GAID 2025 in practice',
    body: 'What the General Application and Implementation Directive actually requires of a controller of major importance, on what cadence, and what evidence satisfies it.',
  },
  {
    title: 'Consent that holds up',
    body: 'Separate, purpose specific, as easy to withdraw as to give. Where consent is the wrong basis entirely, and what to use instead.',
  },
  {
    title: 'DPIAs and privacy by design',
    body: 'Running an assessment that changes a design decision, rather than one filed after the system ships.',
  },
  {
    title: 'Breach handling',
    body: 'The 72 hour clock from the moment it starts: containment, the assessment, notifying the Commission, and telling the people whose data it was.',
  },
  {
    title: 'Audit and the DPCO regime',
    body: 'Annual audit filing, working with a licensed DPCO, and the record keeping that makes the filing a formality instead of a scramble.',
  },
];

const STEPS = [
  {
    title: 'Apply to one university',
    body: 'One form, one set of documents, one application fee, set by the institution you chose and disclosed before you pay it.',
  },
  {
    title: 'The registry reviews it',
    body: 'Staff at that university admit or decline, and you are told which, with a reason. Nothing about that decision happens without their hand on it.',
  },
  {
    title: 'Accept, pay tuition, enrol',
    body: 'Tuition is charged only after you have been offered a place and accepted it. Your matriculation number is issued when the payment settles.',
  },
  {
    title: 'Study, qualify, be verified',
    body: 'Modules, assessment and the library online. The certificate carries a code an employer can check in seconds, without an account.',
  },
];

const HOLDINGS = [
  {
    term: 'Your documents',
    detail:
      'Never publicly addressable. Staff open them through links that expire in minutes, and every opening is recorded against the person who did it.',
  },
  {
    term: 'Your photograph',
    detail:
      'Used for your ID card, examination identity and certificate. It is not run through facial recognition, here or anywhere we send it.',
  },
  {
    term: 'Your payments',
    detail:
      'Card details never touch this platform. Paystack holds them. We hold a reference, an amount and a receipt.',
  },
  {
    term: 'If you are not admitted',
    detail:
      'Your documents are deleted on a retention schedule that runs on a timer, not on somebody remembering to run it.',
  },
  {
    term: 'Between universities',
    detail:
      'One institution cannot read the applicants of another. That boundary is enforced by the database itself, not by application code that could forget.',
  },
  {
    term: 'Your record of us',
    detail:
      'You can ask for a copy of everything held about you, or ask for it to be corrected or erased, from inside your own account.',
  },
];

const QUESTIONS = [
  {
    q: 'Who is this for?',
    a: 'People who hold or are about to hold the DPO role: compliance and legal staff, IT and security leads, and public sector officers who have been handed data protection on top of an existing job. It assumes no law degree.',
  },
  {
    q: 'Do I have to stop working?',
    a: 'No. Teaching is online and asynchronous, with assessment deadlines rather than fixed class hours. Each university publishes its own calendar on its programme page.',
  },
  {
    q: 'Who awards the qualification?',
    a: 'The university you applied to. This platform runs admissions, payments, teaching and verification for several institutions, but the credential is theirs, and their entry requirements and fees are their own.',
  },
  {
    q: 'What does it cost?',
    a: 'Two separate payments: a non refundable application fee when you submit, and tuition only if you are offered a place and accept it. Both are shown in naira on the institution page before you commit to either.',
  },
  {
    q: 'What happens to my documents if I am not admitted?',
    a: 'They are deleted on a retention schedule that runs on a timer. Until then they are never publicly addressable, and every time a member of staff opens one it is recorded against their account.',
  },
  {
    q: 'Can an employer check my certificate?',
    a: 'Yes, from the Verify page, with the code printed on it, without an account and without contacting anyone. That is the point of issuing it here rather than as a PDF.',
  },
];

async function PlatformLanding() {
  const live = await db
    .select()
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  // Per tenant reads rather than one unscoped query: the same mechanism PB-02
  // uses, and a far smaller blast radius than bypassing row level security.
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

  // library_items is a shared table by design, so this one needs no tenant
  // context: the corpus is the same for every institution.
  const [{ n: libraryCount }] = await db.select({ n: count() }).from(libraryItems);

  const word = COUNT_WORDS[live.length] ?? String(live.length);
  const plural = live.length === 1 ? 'university' : 'universities';
  const photo = marketingImages();

  return (
    <>
      <LandingNav />
      <main id="main">
        {/* 1. Hero. Type led and asymmetric: the headline is the image. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8 md:py-24">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
              <div>
                <p className="motion-rise t-caption m-0 text-ink-700">
                  Post Graduate Diploma
                </p>
                <h1 className="motion-rise motion-rise-1 t-display measure mt-4 mb-0 text-ink-900">
                  A qualification in{' '}
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
                {/* Four text elements and no more: eyebrow, headline, the
                    rotating claim as the subtext, the action. */}
                <div className="motion-rise motion-rise-3 mt-10 flex flex-wrap gap-4">
                  <LinkButton href="/programmes">See {word.toLowerCase()} {plural}</LinkButton>
                </div>
              </div>

              {/* The only Manila on this screen, because it is the only filed
                  artefact on it: what an issued certificate actually says. */}
              <aside className="lg:pt-10">
                <div className="rounded-md bg-record p-6">
                  <div className="mb-4 h-0.5 w-12 bg-authority" aria-hidden="true" />
                  <p className="t-caption m-0 text-ink-700">Specimen certificate</p>
                  <p className="t-h4 mt-2 mb-4 text-ink-900">
                    Post Graduate Diploma in Data Protection &amp; Privacy
                  </p>
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                    <dt className="t-caption m-0 text-ink-700">Holder</dt>
                    <dd className="t-body-sm m-0 ml-0 text-ink-900">
                      <Redacted label="Name on the certificate" />
                    </dd>
                    <dt className="t-caption m-0 text-ink-700">Awarded by</dt>
                    <dd className="t-body-sm m-0 ml-0 text-ink-900">Their university</dd>
                    <dt className="t-caption m-0 text-ink-700">Code</dt>
                    <dd className="t-data m-0 ml-0 text-ink-900">PGD-7Q2M-4KX9</dd>
                  </dl>
                  <p className="t-caption mt-4 mb-0 text-ink-700">
                    Anybody can check that code without an account.
                  </p>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* 2. Live figures. A rule separated band, counted at request time. */}
        <section className="border-b border-ink-300 bg-ink-100/40">
          <div className="mx-auto max-w-marketing px-4 py-10 md:px-8">
            <p className="t-body measure mt-0 mb-8 text-ink-700">
              Taught by Nigerian universities, on one platform, to the law as it is actually
              enforced: the NDPA 2023 and the GAID 2025.
            </p>
            <dl className="m-0 grid gap-8 md:grid-cols-3 md:divide-x md:divide-ink-300">
              <div className="md:pr-8">
                <dt className="t-caption m-0 text-ink-700">Universities running it</dt>
                <dd className="t-h1 m-0 ml-0 text-ink-900">{live.length}</dd>
              </div>
              <div className="md:px-8">
                <dt className="t-caption m-0 text-ink-700">Intakes open now</dt>
                <dd className="t-h1 m-0 ml-0 text-ink-900">{openIntakes}</dd>
              </div>
              <div className="md:pl-8">
                <dt className="t-caption m-0 text-ink-700">Items in the library</dt>
                <dd className="t-h1 m-0 ml-0 text-ink-900">{libraryCount}</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 3. Full bleed figure. Renders only when the photograph exists. */}
        {photo.registry ? (
          <section className="border-b border-ink-300">
            <figure className="m-0">
              <img
                src={photo.registry}
                alt="A university registry office"
                width={1600}
                height={900}
                loading="lazy"
                decoding="async"
                className="h-[38vh] min-h-[240px] w-full object-cover"
              />
              <figcaption className="mx-auto max-w-marketing px-4 py-4 md:px-8">
                <p className="t-caption m-0 text-ink-700">
                  Admissions still happen in a registry. This platform is the paperwork, not the
                  university.
                </p>
              </figcaption>
            </figure>
          </section>
        ) : null}

        {/* 4. Institutions. Record cards, because each one is a filed thing. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">Where you would be studying</h2>
            <p className="t-body measure mt-3 text-ink-700">
              You apply to one of these, not to us. Entry requirements, fees and the calendar are
              each university&apos;s own.
            </p>

            {live.length === 0 ? (
              <p className="t-body mt-8 text-ink-700">
                No institution is taking applications at the moment.
              </p>
            ) : (
              <ul className="mt-8 grid list-none gap-6 p-0 md:grid-cols-2">
                {live.map((inst) => (
                  <Record
                    as="li"
                    key={inst.id}
                    title={inst.name}
                    meta={inst.city ?? undefined}
                  >
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">
                      Applications, teaching and the certificate all carry {inst.shortName}
                      &apos;s name.
                    </p>
                    <Link
                      href={tenantUrl(inst.slug)}
                      className="t-body-sm text-ink-900 underline underline-offset-2"
                    >
                      Open {inst.shortName}
                    </Link>
                  </Record>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 5. Syllabus. A numbered editorial index, not a card grid. */}
        <section id="study" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">What you study</h2>
            <p className="t-body measure mt-3 text-ink-700">
              Written out rather than gestured at, because every unaccredited programme in this
              market also claims a world class curriculum.
            </p>
            <ol className="mt-10 grid list-none gap-0 p-0 md:grid-cols-2 md:gap-x-16">
              {SYLLABUS.map((item, i) => (
                <li key={item.title} className="border-t border-ink-300 py-6">
                  <div className="flex gap-5">
                    <span className="t-data shrink-0 text-ink-500" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="t-h4 m-0 text-ink-900">{item.title}</h3>
                      <p className="t-body-sm measure mt-2 mb-0 text-ink-700">{item.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 6. How it works. A stepper: four columns joined by one rule. */}
        <section id="how" className="scroll-mt-28 border-b border-ink-300 bg-ink-100/40">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">How admission works</h2>
            <ol className="mt-10 grid list-none gap-8 p-0 md:grid-cols-4 md:gap-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="border-t-2 border-authority pt-5">
                  <p className="t-caption m-0 text-ink-700">Step {i + 1}</p>
                  <h3 className="t-h4 mt-1 mb-2 text-ink-900">{step.title}</h3>
                  <p className="t-body-sm m-0 text-ink-700">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 7. Image and prose, side by side. */}
        {photo.faculty ? (
          <section className="border-b border-ink-300">
            <div className="mx-auto grid max-w-marketing items-center gap-10 px-4 py-16 md:grid-cols-2 md:px-8">
              <figure className="m-0">
                <img
                  src={photo.faculty}
                  alt="A partner university"
                  width={1200}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                />
              </figure>
              <div>
                <h2 className="t-h2 m-0 text-ink-900">The university owns the academics</h2>
                <p className="t-body measure mt-4 text-ink-700">
                  We do not set the curriculum and we do not award the credential. Institutions do.
                  What this platform owns is the rails underneath: the application, the money, the
                  teaching surface, the library and the verification.
                </p>
                <p className="t-body-sm measure mt-4 text-ink-700">
                  That split is why a certificate from here carries a university&apos;s name and not
                  ours.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* 8. What we hold. A definition grid, the densest block on the page. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">What we hold about you</h2>
            <p className="t-body measure mt-3 text-ink-700">
              This is a programme about data protection, so the platform teaching it should be able
              to answer the question it teaches you to ask.
            </p>
            <dl className="mt-10 grid gap-x-16 gap-y-0 md:grid-cols-2">
              {HOLDINGS.map((item) => (
                <div key={item.term} className="border-t border-ink-300 py-5">
                  <dt className="t-label m-0 text-ink-900">{item.term}</dt>
                  <dd className="t-body-sm measure mt-2 mb-0 ml-0 text-ink-700">
                    {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="t-body-sm mt-8 mb-0">
              <Link href="/trust" className="text-ink-900 underline underline-offset-2">
                Read how the platform itself is run
              </Link>
            </p>
          </div>
        </section>

        {/* 9. Offset pair: photograph against the verification artefact. */}
        {photo.study ? (
          <section className="border-b border-ink-300 bg-ink-100/40">
            <div className="mx-auto grid max-w-marketing items-start gap-10 px-4 py-16 md:grid-cols-[3fr_2fr] md:px-8">
              <div>
                <h2 className="t-h2 m-0 text-ink-900">Built for a phone on a bad connection</h2>
                <p className="t-body measure mt-4 text-ink-700">
                  Most of this will be read at night, after work, on a mid range Android on 3G. The
                  pages are light, the library keeps working when the connection does not, and
                  nothing on this platform needs a laptop.
                </p>
              </div>
              <figure className="m-0">
                <img
                  src={photo.study}
                  alt="Reading course material"
                  width={1200}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/2] w-full rounded-sm object-cover"
                />
              </figure>
            </div>
          </section>
        ) : null}

        {/* 10. Questions. A disclosure stack, open by default on the first. */}
        <section id="faq" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 measure m-0 text-ink-900">Questions people actually ask</h2>
            <div className="mt-8 max-w-[70ch]">
              {QUESTIONS.map((item, i) => (
                <details
                  key={item.q}
                  open={i === 0}
                  className="border-t border-ink-300 py-4 last:border-b"
                >
                  <summary className="t-h4 cursor-pointer text-ink-900">{item.q}</summary>
                  <p className="t-body-sm mt-3 mb-0 text-ink-700">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 11. Convocation band, if supplied. */}
        {photo.convocation ? (
          <section className="border-b border-ink-300">
            <figure className="m-0">
              <img
                src={photo.convocation}
                alt="A convocation ceremony"
                width={1600}
                height={900}
                loading="lazy"
                decoding="async"
                className="h-[32vh] min-h-[200px] w-full object-cover"
              />
            </figure>
          </section>
        ) : null}

        {/* 11b. The collection. A four card index, the page's only card row. */}
        <section id="resources" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
            <h2 className="t-h2 m-0 text-ink-900">The law, in one place</h2>
            <p className="t-body measure mt-3 text-ink-700">
              The library holds {libraryCount} items: Nigerian legislation, Commission guidance and
              enforcement decisions, and privacy judgments, each carrying its source and its licence
              so you can tell what you are allowed to do with it. Students keep access after they
              graduate.
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
                  meta: 'Our DPO, our sub processors, and what we do with your data',
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

        {/* 12. Close. Centred, one action, one alternative. */}
        <section>
          <div className="mx-auto max-w-marketing px-4 py-20 text-center md:px-8">
            <h2 className="t-h2 mx-auto measure m-0 text-ink-900">
              One application, to the university you choose.
            </h2>
            <p className="t-body mx-auto measure mt-3 text-ink-700">
              The application fee is set by each institution and charged when you submit. Tuition is
              only ever charged after you have been offered a place and accepted it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <LinkButton href="/programmes">Choose a university and apply</LinkButton>
              <Link
                href="/verify"
                className="t-body-sm self-center text-ink-900 underline underline-offset-2"
              >
                Checking somebody&apos;s certificate instead?
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

  // programmes and cohorts are tenant scoped: without tenant context RLS
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
                  {applicationFee ? <Naira kobo={applicationFee.amountKobo} /> : 'Not published yet'}
                </dd>
              </dl>
              {/* §5.1: non refundable, and disclosed as such before payment,
                  not in terms after it. */}
              <p className="t-body-sm m-0 text-ink-700">
                The application fee is non refundable and is charged when you submit. Tuition is
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
