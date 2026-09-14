import Link from 'next/link';
import { redirect } from 'next/navigation';
import { count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { alumniProfiles, institutions, libraryItems } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, LinkButton, Panel, Record } from '@/components/ui';

/**
 * AL-01 alumni home (ALM-01, LIB-08).
 *
 * Two states matter and the flow names both: newly transitioned, and listed
 * or not. The first needs an explanation of what just changed and what they
 * keep — library access is the substance of the alumni offer (LIB-08) and
 * nobody told them that when they enrolled. The second needs one prompt and
 * then silence: §5 says explain what they are missing and "do not nag
 * repeatedly", which is the difference between a directory and a mailing
 * list.
 */
export default async function AlumniHome() {
  const me = await requireUser();

  const [row] = await db
    .select({ profile: alumniProfiles, institution: institutions })
    .from(alumniProfiles)
    .innerJoin(institutions, eq(institutions.id, alumniProfiles.institutionId))
    .where(eq(alumniProfiles.userId, me.userId))
    .limit(1);

  // Not an alumnus: nothing here is theirs yet, and a page explaining what
  // they would get on graduating is a page nobody asked for.
  if (!row) redirect('/dashboard');

  const { profile, institution } = row;

  const [{ n: corpus }] = await db
    .select({ n: count() })
    .from(libraryItems)
    .where(eq(libraryItems.status, 'published'));

  const [{ n: listedCount }] = await db
    .select({ n: count() })
    .from(alumniProfiles)
    .where(eq(alumniProfiles.directoryVisible, true));

  // "Newly transitioned" is a real state rather than a flag: within a week of
  // the profile being created, this is the first time they have seen any of
  // it.
  const newlyTransitioned = Date.now() - profile.createdAt.getTime() < 7 * 86_400_000;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <h1 className="t-h1 mt-2 text-ink-900">
          {newlyTransitioned ? 'Congratulations — you have graduated' : 'Alumni'}
        </h1>

        {newlyTransitioned ? (
          <div className="mt-8">
            <Banner tone="verified" title="What changes, and what you keep">
              <p>
                Your student account is now an alumni account. You keep the library and the
                Resource Centre for good — that is the part worth knowing, because it is the thing
                people assume they lose.
              </p>
              <p className="mt-2">
                Your certificate is in your records, with a code anyone can verify without an
                account. Your academic record stays with {institution.shortName}.
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Record title="The library, still yours" meta={`${corpus} published items`}>
            <p className="t-body-sm mt-0 mb-4 text-ink-700">
              Nigerian legislation, Commission guidance, enforcement decisions and privacy
              judgments — and the research collection alongside it. Access does not lapse.
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/library" size="dense" variant="secondary">
                E-Library
              </LinkButton>
              <LinkButton href="/resources" size="dense" variant="secondary">
                Research
              </LinkButton>
            </div>
          </Record>

          <Record
            title="The directory"
            meta={`${listedCount} ${listedCount === 1 ? 'person' : 'people'} listed nationally`}
          >
            {profile.directoryVisible ? (
              <>
                <p className="t-body-sm mt-0 mb-4 text-ink-700">
                  You are listed, showing only the fields you ticked.
                </p>
                <LinkButton href="/alumni/directory" size="dense" variant="secondary">
                  Browse the directory
                </LinkButton>
              </>
            ) : (
              <>
                {/* §5: explain what they are missing, once, and then stop. */}
                <p className="t-body-sm mt-0 mb-4 text-ink-700">
                  You are not listed, so the directory is closed to you. It works both ways on
                  purpose — being able to find other DPOs means being findable yourself.
                </p>
                <LinkButton href="/alumni/profile" size="dense">
                  Set up my entry
                </LinkButton>
              </>
            )}
          </Record>

          <Record title="Your certificate" meta="Verifiable by anyone, without an account">
            <p className="t-body-sm mt-0 mb-4 text-ink-700">
              An employer checks the code and sees that it is valid and who issued it. Nothing
              else about you.
            </p>
            <LinkButton href="/certificates" size="dense" variant="secondary">
              Your certificates
            </LinkButton>
          </Record>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Panel title="What is not built yet">
            {/* §5.8: "a community is a product, not a feature." Saying what is
                missing beats a nav full of links to empty rooms. */}
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              The national forum, the jobs board and events are on the roadmap and are not here
              yet. The directory and the library are, and they are the two things this network is
              actually for in its first year.
            </p>
          </Panel>

          <Panel title="Your privacy, as an alumnus">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Being listed is consent, recorded and withdrawable. Turning it off removes you
              immediately rather than overnight.
            </p>
            <Link href="/account/privacy" className="t-body-sm text-ink-900 underline underline-offset-2">
              Privacy and consent settings
            </Link>
          </Panel>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
