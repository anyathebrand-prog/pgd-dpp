import Link from 'next/link';
import { and, asc, count, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, institutions, libraryItems, programmes } from '@/db/schema';
import { currentInstitution, tenantUrl } from '@/lib/tenant';
import { campusPhoto, marketingImages } from '@/lib/marketing-images';
import { Footer, TopBar } from '@/components/shell';
import { LinkButton, Naira, Panel, Record, Redacted, cx } from '@/components/ui';
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
 * Written to the 2026 "Night Desk" system (brief §0), after flowninja.com:
 * a navy page, display type with a white-to-blue gradient, soft glows behind
 * the hero and the closing band, hairline cards with generous corners, and
 * pill buttons. The section rhythm follows the reference too: hero, figures
 * and who stands behind them, a three word statement, the offer, questions,
 * one closing band. Signal still means verified and nothing else.
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
    icon: 'apply' as const,
    body: 'One form, one set of documents, one application fee, set by the institution you chose and disclosed before you pay it.',
  },
  {
    title: 'The registry reviews it',
    icon: 'review' as const,
    body: 'Staff at that university admit or decline, and you are told which, with a reason. Nothing about that decision happens without their hand on it.',
  },
  {
    title: 'Accept, pay tuition, enrol',
    icon: 'pay' as const,
    body: 'Tuition is charged only after you have been offered a place and accepted it. Your matriculation number is issued when the payment settles.',
  },
  {
    title: 'Study, qualify, be verified',
    icon: 'qualify' as const,
    body: 'Modules, assessment and the library online. The certificate carries a code an employer can check in seconds, without an account.',
  },
];

/*
 * Step icons for "Apply. Study. Qualify." Inline, in Lucide's grammar (24px
 * grid, 1.75 stroke, round caps), so the page ships no icon library for
 * four glyphs. Decorative: each card's heading already says what it is.
 */
function StepIcon({ name }: { name: 'apply' | 'review' | 'pay' | 'qualify' }) {
  const paths = {
    // A document with a folded corner and lines of text.
    apply: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </>
    ),
    // A clipboard with a tick: somebody checked it.
    review: (
      <>
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </>
    ),
    // A payment card.
    pay: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h4" />
      </>
    ),
    // A mortarboard, with a small verified tick.
    qualify: (
      <>
        <path d="M22 9 12 4 2 9l10 5 10-5z" />
        <path d="M6 11v5c0 1.5 2.7 3 6 3" />
        <path d="m15.5 18 1.8 1.8 3.2-3.3" />
      </>
    ),
  } as const;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

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
        {/* 1. Hero. The photograph carries it: someone studying at home, the
            secure connection she is working over. On a wide screen the words
            sit on a navy gradient over the bright window; on a phone the
            photograph comes first and fades into them. Without the file, the
            hero falls back to the glow alone. */}
        <section className={cx('relative overflow-hidden border-b border-ink-300', !photo.hero && 'glow-hero')}>
          {photo.hero ? (
            <>
              <img
                src={photo.hero}
                srcSet={`/marketing/hero-1200.webp 1200w, ${photo.hero} 2400w`}
                sizes="100vw"
                alt="A professional studying at home on a laptop, over a secure connection"
                width={2400}
                height={1309}
                fetchPriority="high"
                decoding="async"
                className="block aspect-[4/3] w-full object-cover object-[72%_center] lg:absolute lg:inset-0 lg:aspect-auto lg:h-full"
              />
              {/* Phone: fade the photograph into the page beneath it. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/3] bg-[linear-gradient(to_bottom,transparent_55%,#08163c)] lg:hidden"
              />
              {/* Desktop: solid navy under the words, clearing to the right. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_right,#08163c_0%,#08163c_30%,rgba(8,22,60,0.75)_42%,rgba(8,22,60,0.1)_58%,transparent_68%),linear-gradient(to_top,#08163c_0%,transparent_22%)] lg:block"
              />
            </>
          ) : null}

          <div className="relative mx-auto max-w-marketing px-4 pt-2 pb-16 md:px-8 lg:flex lg:min-h-[86vh] lg:items-center lg:py-28">
            <div className="max-w-[40rem]">
              <p className="motion-rise hairline t-caption m-0 inline-flex items-center gap-2 rounded-full bg-surface/60 px-4 py-1.5 text-ink-700 backdrop-blur">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-verified-fill" aria-hidden="true" />
                Post Graduate Diploma · NDPA 2023 and GAID 2025
              </p>
              <h1 className="motion-rise motion-rise-1 t-display mt-6 mb-0 text-ink-900">
                A qualification in{' '}
                <span className="motion-redaction">Data Protection</span> and Privacy
              </h1>
              <div className="motion-rise motion-rise-2">
                <RotatingClaim
                  claims={[
                    `*One application.* ${word} ${plural}.`,
                    'Taught as the Act is *enforced*, not as it is summarised.',
                    'A certificate an employer can *verify in seconds*.',
                  ]}
                />
              </div>
              <div className="motion-rise motion-rise-3 mt-10 flex flex-wrap items-center gap-4">
                <LinkButton href="/programmes">See {word.toLowerCase()} {plural}</LinkButton>
                <LinkButton href="/verify" variant="secondary" className="bg-surface/40 backdrop-blur">
                  Verify a certificate
                </LinkButton>
              </div>
              <p className="motion-rise motion-rise-4 t-caption mt-10 mb-0 text-ink-500">
                Studied online, at night, on a phone if need be. Awarded by the university you
                apply to.
              </p>
            </div>
          </div>
        </section>

        {/* 2. Live figures, counted at request time. Display sized, as the
            reference sets its numbers. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto grid max-w-marketing items-center gap-14 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
            <div>
            <dl className="m-0 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-ink-300">
              {[
                { term: 'Universities running it', value: live.length },
                { term: 'Intakes open now', value: openIntakes },
                { term: 'Items in the library', value: libraryCount },
              ].map((fact, i) => (
                <div
                  key={fact.term}
                  className={`flex flex-col-reverse ${i === 0 ? 'md:pr-10' : 'md:px-10'}`}
                >
                  <dt className="t-body-sm mt-2 m-0 text-ink-700">{fact.term}</dt>
                  <dd className="t-display m-0 ml-0 tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
            {live.length > 0 ? (
              <div className="mt-14 flex flex-wrap items-center gap-x-10 gap-y-4">
                <p className="t-caption m-0 text-ink-500">Taught and awarded by</p>
                {live.map((inst) => (
                  <span key={inst.id} className="t-h3 text-ink-700">
                    {inst.shortName}
                  </span>
                ))}
              </div>
            ) : null}
            </div>
              {/* The one filed artefact on this screen: what an issued
                  certificate actually says. */}
              <aside aria-label="Specimen certificate">
                <div className="hairline rounded-lg bg-record/80 p-7 backdrop-blur">
                  <div className="flex items-center justify-between">
                    <p className="t-caption m-0 text-ink-700">Specimen certificate</p>
                    <span className="t-caption rounded-full bg-verified-fill px-3 py-1 font-semibold text-surface">
                      Verifiable
                    </span>
                  </div>
                  <p className="t-h3 mt-5 mb-6 text-ink-900">
                    Post Graduate Diploma in Data Protection &amp; Privacy
                  </p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 border-t border-ink-300 pt-5">
                    <span className="t-caption text-ink-700">Holder</span>
                    <span className="t-body-sm text-ink-900">
                      <Redacted label="Name on the certificate" />
                    </span>
                    <span className="t-caption text-ink-700">Awarded by</span>
                    <span className="t-body-sm text-ink-900">Their university</span>
                    <span className="t-caption text-ink-700">Code</span>
                    <span className="t-data text-ink-900">PGD-7Q2M-4KX9</span>
                  </div>
                  <p className="t-caption mt-6 mb-0 text-ink-700">
                    Anybody can check that code without an account.
                  </p>
                </div>
              </aside>
          </div>
        </section>

        {/* 3. Full bleed figure. Renders only when the photograph exists. */}
        {photo.registry ? (
          <section className="border-b border-ink-300">
            <figure className="m-0 mx-auto max-w-marketing px-4 py-16 md:px-8">
              <img
                src={photo.registry}
                alt="A university registry office"
                width={1600}
                height={900}
                loading="lazy"
                decoding="async"
                className="h-[42vh] min-h-[240px] w-full rounded-lg object-cover"
              />
              <figcaption className="t-caption mt-4 text-ink-700">
                Admissions still happen in a registry. This platform is the paperwork, not the
                university.
              </figcaption>
            </figure>
          </section>
        ) : null}

        {/* 4. How it works: the reference's three-word statement, then the steps. */}
        <section id="how" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-20 md:px-8 md:py-28">
            <p className="t-caption m-0 text-ink-500">How admission works</p>
            <h2 className="t-display mt-4 mb-0">Apply. Study. Qualify.</h2>
            <ol className="mt-14 grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li
                  key={step.title}
                  // Colour only on hover: §9 bans lift and scale on every
                  // surface, and these cards are not links, so the change
                  // is kept to a highlight rather than an invitation to click.
                  className="group hairline motion-state flex flex-col rounded-lg bg-ink-100/40 p-7 hover:border-accent/60 hover:bg-ink-100/80"
                >
                  <div className="flex items-start justify-between">
                    <span className="motion-state flex h-12 w-12 items-center justify-center rounded-md bg-[linear-gradient(135deg,#184098,#1f6adc)] text-ink-900 group-hover:bg-[linear-gradient(135deg,#1f6adc,#488eef)]">
                      <StepIcon name={step.icon} />
                    </span>
                    <span className="t-data text-accent" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="t-h3 mt-8 mb-3 text-ink-900">{step.title}</h3>
                  <p className="t-body-sm m-0 text-ink-700">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 5. Syllabus. Six numbered cards. */}
        <section id="study" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-20 md:px-8 md:py-28">
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
              <h2 className="t-h1 m-0">What you study</h2>
              <p className="t-body-lg m-0 max-w-[52ch] text-ink-700">
                Written out rather than gestured at, because every unaccredited programme in this
                market also claims a world class curriculum.
              </p>
            </div>
            <ol className="mt-14 grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
              {SYLLABUS.map((item, i) => (
                <li key={item.title} className="hairline rounded-lg p-7">
                  <span className="t-data text-ink-500" aria-hidden="true">
                    Module {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="t-h3 mt-4 mb-3 text-ink-900">{item.title}</h3>
                  <p className="t-body-sm m-0 text-ink-700">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 6. Institutions. Record cards, because each one is a filed thing. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-20 md:px-8 md:py-28">
            <h2 className="t-h1 m-0 max-w-[20ch]">Where you would be studying</h2>
            <p className="t-body-lg mt-4 max-w-[56ch] text-ink-700">
              You apply to one of these, not to us. Entry requirements, fees and the calendar are
              each university&apos;s own.
            </p>

            {live.length === 0 ? (
              <p className="t-body mt-10 text-ink-700">
                No institution is taking applications at the moment.
              </p>
            ) : (
              <ul className="mt-12 grid list-none gap-5 p-0 md:grid-cols-2">
                {live.map((inst) => {
                  const campus = campusPhoto(inst.slug);
                  return (
                    <li key={inst.id} className="flex flex-col">
                      {/* The campus itself, where the university has supplied
                          one: the record below it is still the filed thing. */}
                      {campus ? (
                        <img
                          src={campus}
                          alt={`The main gate of the ${inst.name}`}
                          width={1200}
                          height={630}
                          loading="lazy"
                          decoding="async"
                          className="aspect-[1200/630] w-full rounded-t-lg object-cover"
                        />
                      ) : null}
                      <Record
                        title={inst.name}
                        meta={inst.city ?? undefined}
                        className={cx('flex-1', campus && 'rounded-t-none border-t-0')}
                      >
                        <p className="t-body-sm mt-0 mb-6 text-ink-700">
                          Applications, teaching and the certificate all carry {inst.shortName}
                          &apos;s name.
                        </p>
                        <LinkButton href={tenantUrl(inst.slug)} variant="secondary" size="dense">
                          Open {inst.shortName}
                        </LinkButton>
                      </Record>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* 7. Image and prose, side by side. */}
        {photo.faculty ? (
          <section className="border-b border-ink-300">
            <div className="mx-auto grid max-w-marketing items-center gap-12 px-4 py-20 md:grid-cols-2 md:px-8">
              <figure className="m-0">
                <img
                  src={photo.faculty}
                  alt="A partner university"
                  width={1200}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                />
              </figure>
              <div>
                <h2 className="t-h1 m-0">The university owns the academics</h2>
                <p className="t-body-lg mt-5 text-ink-700">
                  We do not set the curriculum and we do not award the credential. Institutions do.
                  What this platform owns is the rails underneath: the application, the money, the
                  teaching surface, the library and the verification.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* 8. What we hold. Two columns, hairline rows. */}
        <section className="border-b border-ink-300">
          <div className="mx-auto grid max-w-marketing gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[2fr_3fr]">
            <div>
              <h2 className="t-h1 m-0">What we hold about you</h2>
              <p className="t-body-lg mt-5 text-ink-700">
                This is a programme about data protection, so the platform teaching it should be
                able to answer the question it teaches you to ask.
              </p>
              <p className="t-body-sm mt-8 mb-0">
                <Link href="/trust" className="text-ink-900 underline underline-offset-4">
                  Read how the platform itself is run
                </Link>
              </p>
            </div>
            <dl className="m-0 grid gap-x-10 sm:grid-cols-2">
              {HOLDINGS.map((item) => (
                <div key={item.term} className="border-t border-ink-300 py-6">
                  <dt className="t-h4 m-0 text-ink-900">{item.term}</dt>
                  <dd className="t-body-sm mt-2 mb-0 ml-0 text-ink-700">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 9. Built for the phone. */}
        {photo.study ? (
          <section className="border-b border-ink-300">
            <div className="mx-auto grid max-w-marketing items-center gap-12 px-4 py-20 md:grid-cols-[3fr_2fr] md:px-8">
              <div>
                <h2 className="t-h1 m-0">Built for a phone on a bad connection</h2>
                <p className="t-body-lg mt-5 text-ink-700">
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
                  className="aspect-[3/2] w-full rounded-lg object-cover"
                />
              </figure>
            </div>
          </section>
        ) : null}

        {/* 10. Questions. A disclosure stack, open by default on the first. */}
        <section id="faq" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto grid max-w-marketing gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[2fr_3fr]">
            <h2 className="t-h1 m-0">Questions people actually ask</h2>
            <div>
              {QUESTIONS.map((item, i) => (
                <details
                  key={item.q}
                  open={i === 0}
                  className="group border-t border-ink-300 py-5 last:border-b"
                >
                  <summary className="t-h4 flex cursor-pointer list-none items-center justify-between gap-6 text-ink-900 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="hairline flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-700 group-open:bg-ink-900 group-open:text-surface"
                    >
                      {'+'}
                    </span>
                  </summary>
                  <p className="t-body mt-3 mb-0 max-w-[60ch] text-ink-700">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 11. Convocation, if supplied. */}
        {photo.convocation ? (
          <section className="border-b border-ink-300">
            <figure className="m-0 mx-auto max-w-marketing px-4 py-16 md:px-8">
              <img
                src={photo.convocation}
                alt="A convocation ceremony"
                width={1600}
                height={900}
                loading="lazy"
                decoding="async"
                className="h-[36vh] min-h-[200px] w-full rounded-lg object-cover"
              />
            </figure>
          </section>
        ) : null}

        {/* 12. The collection. */}
        <section id="resources" className="scroll-mt-28 border-b border-ink-300">
          <div className="mx-auto max-w-marketing px-4 py-20 md:px-8 md:py-28">
            <h2 className="t-h1 m-0">The law, in one place</h2>
            <p className="t-body-lg mt-5 max-w-[62ch] text-ink-700">
              The library holds {libraryCount} items: Nigerian legislation, Commission guidance and
              enforcement decisions, and privacy judgments, each carrying its source and its licence
              so you can tell what you are allowed to do with it. Students keep access after they
              graduate.
            </p>
            <ul className="mt-12 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 lg:grid-cols-4">
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
                <li key={link.href} className="hairline motion-state flex rounded-lg hover:bg-ink-100/40">
                  {link.external ? (
                    <a href={link.href} rel="noopener" className="block w-full p-7 no-underline">
                      <span className="t-h4 text-ink-900">
                        {link.label}
                        <span aria-hidden="true"> ↗</span>
                      </span>
                      <span className="t-body-sm mt-3 block text-ink-700">{link.meta}</span>
                    </a>
                  ) : (
                    <Link href={link.href} className="block w-full p-7 no-underline">
                      <span className="t-h4 text-ink-900">
                        {link.label}
                        <span aria-hidden="true"> →</span>
                      </span>
                      <span className="t-body-sm mt-3 block text-ink-700">{link.meta}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 13. Close. The reference's final band: one statement, one action. */}
        <section className="px-4 py-20 md:px-8 md:py-28">
          <div className="glow-band mx-auto max-w-marketing rounded-lg px-6 py-16 text-center md:px-16 md:py-24">
            <h2 className="t-display mx-auto m-0 max-w-[18ch]">
              One application, to the university you choose.
            </h2>
            <p className="t-body-lg mx-auto mt-6 max-w-[56ch] text-ink-900/85">
              The application fee is set by each institution and charged when you submit. Tuition is
              only ever charged after you have been offered a place and accepted it.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <LinkButton href="/programmes">Choose a university and apply</LinkButton>
              <Link
                href="/verify"
                className="t-body-sm self-center text-ink-900 underline underline-offset-4"
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
