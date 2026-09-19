import Link from 'next/link';
import { and, asc, eq, ilike, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { alumniProfiles, institutions, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';
import { flagEnabled } from '@/lib/flags';
import { FeatureOff } from '@/components/feature-off';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, EmptyState, Input, LinkButton, Panel, Record, cx } from '@/components/ui';

/**
 * AL-02 alumni directory (ALM-03, ALM-12).
 *
 * National in scope: an alumnus of one university sees graduates of every
 * other, which is the point — the value of a national DPO network is that it
 * is national. What crossing institutions does NOT buy is entry to another
 * school's private channel (ALM-12), and that is enforced server-side rather
 * than by leaving a link out.
 *
 * Gap G-14 asks whether an alumnus who has not opted in may browse. The flow
 * recommends reciprocity and so does this: a directory where people take
 * without giving empties itself within a year, and it is a fairness question
 * users raise unprompted. Someone unlisted sees what joining would give them
 * — not a wall, and not the contents either.
 */
export default async function Directory({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; institution?: string; specialisation?: string }>;
}) {
  const me = await requireUser();
  const { q, institution: institutionSlug, specialisation } = await searchParams;

  /*
   * SA-03, resolved against the viewer's own institution. The directory is
   * national, so there is no single tenant to ask — the question this answers
   * is whether the university whose graduate is looking has agreed to take
   * part, and it would be the wrong way round to show them everyone else's
   * graduates while their own are withheld.
   */
  const viewerInstitution = await currentInstitution();
  if (!(await flagEnabled('alumni_directory', viewerInstitution?.id ?? null))) {
    return (
      <FeatureOff title="Alumni directory" institution={viewerInstitution?.shortName ?? 'This institution'}>
        <p>
          The directory is not open here at the moment. What you chose to share is kept exactly as
          you set it, so nobody has to opt in a second time.
        </p>
      </FeatureOff>
    );
  }

  const [mine] = await db
    .select()
    .from(alumniProfiles)
    .where(eq(alumniProfiles.userId, me.userId))
    .limit(1);

  const listed = Boolean(mine?.directoryVisible);

  const filters: SQL[] = [eq(alumniProfiles.directoryVisible, true)];
  if (q) filters.push(ilike(users.fullName, `%${q}%`));
  if (institutionSlug) filters.push(eq(institutions.slug, institutionSlug));
  if (specialisation) filters.push(ilike(alumniProfiles.specialisation, `%${specialisation}%`));

  const rows = listed
    ? await db
        .select({ profile: alumniProfiles, user: users, institution: institutions })
        .from(alumniProfiles)
        .innerJoin(users, eq(users.id, alumniProfiles.userId))
        .innerJoin(institutions, eq(institutions.id, alumniProfiles.institutionId))
        .where(and(...filters))
        .orderBy(asc(users.fullName))
        .limit(100)
    : [];

  const schools = await db
    .select({ slug: institutions.slug, name: institutions.shortName })
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Alumni directory</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Everyone who has graduated from this programme, at any of the participating universities,
          and chosen to be listed.
        </p>

        {/* AL-02: own visibility status is always displayed. */}
        <div className="mt-8">
          {listed ? (
            <Banner tone="verified" title="You are listed">
              <p>
                Other alumni can find you, showing the fields you ticked.{' '}
                <Link href="/alumni/profile" className="text-ink-900 underline underline-offset-2">
                  Manage what they see
                </Link>
                .
              </p>
            </Banner>
          ) : (
            <Banner tone="info" title="You are not listed, so the directory is closed to you">
              <p>
                This one works both ways: being able to find other alumni means being findable
                yourself. Nothing is shown about you beyond your name, institution and cohort year
                unless you tick it, and you can leave again at any time.
              </p>
            </Banner>
          )}
        </div>

        {!listed ? (
          <div className="mt-8">
            <LinkButton href="/alumni/profile">Set up my directory entry</LinkButton>
          </div>
        ) : (
          <>
            <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="q" className="t-label mb-2 block text-ink-900">
                  Search by name
                </label>
                <Input id="q" name="q" defaultValue={q ?? ''} className="max-w-[280px]" />
              </div>
              <div>
                <label htmlFor="specialisation" className="t-label mb-2 block text-ink-900">
                  Specialisation
                </label>
                <Input
                  id="specialisation"
                  name="specialisation"
                  defaultValue={specialisation ?? ''}
                  className="max-w-[240px]"
                />
              </div>
              <button
                type="submit"
                className="motion-state inline-flex h-12 items-center rounded-sm bg-authority px-5 font-semibold text-surface"
              >
                Search
              </button>
            </form>

            <nav aria-label="Filter by institution" className="mt-5 flex flex-wrap gap-4">
              <Link
                href="/alumni/directory"
                className={cx(
                  't-body-sm no-underline',
                  institutionSlug ? 'text-ink-700' : 'font-semibold text-ink-900',
                )}
              >
                Every university
              </Link>
              {schools.map((s) => (
                <Link
                  key={s.slug}
                  href={`/alumni/directory?institution=${s.slug}`}
                  className={cx(
                    't-body-sm no-underline',
                    institutionSlug === s.slug ? 'font-semibold text-ink-900' : 'text-ink-700',
                  )}
                >
                  {s.name}
                </Link>
              ))}
            </nav>

            <p className="t-body-sm mt-5 text-ink-700" role="status" aria-live="polite">
              {rows.length} {rows.length === 1 ? 'person' : 'people'}
            </p>

            {rows.length === 0 ? (
              <div className="mt-6">
                <EmptyState heading="Nobody matches that yet">
                  The directory is new, and in its first year it will be sparse. It fills as each
                  cohort graduates and decides to be listed.
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-6 grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
                {rows.map(({ profile, user, institution }) => {
                  // Only what this person ticked. The row carries more and the
                  // query returns it, but this is where the promise made on
                  // AL-03 is actually kept.
                  const shown = profile.visibleFields ?? [];
                  const show = (key: string, value: string | null) =>
                    shown.includes(key) && value ? value : null;

                  const role = show('currentRole', profile.currentRole);
                  const employer = show('employer', profile.employer);
                  const spec = show('specialisation', profile.specialisation);
                  const place = show('location', profile.location);
                  const linkedin = show('linkedinUrl', profile.linkedinUrl);

                  return (
                    <Record
                      as="li"
                      key={profile.id}
                      title={user.fullName ?? 'Alumnus'}
                      meta={`${institution.shortName} · ${profile.cohortYear}`}
                    >
                      {role || employer ? (
                        <p className="t-body-sm mt-0 mb-2 text-ink-900">
                          {[role, employer].filter(Boolean).join(' at ')}
                        </p>
                      ) : null}
                      {spec ? <p className="t-body-sm mt-0 mb-2 text-ink-700">{spec}</p> : null}
                      {place ? <p className="t-caption m-0 text-ink-700">{place}</p> : null}
                      {linkedin ? (
                        <p className="t-body-sm mt-3 mb-0">
                          <a
                            href={linkedin}
                            rel="noopener noreferrer"
                            target="_blank"
                            className="text-authority underline underline-offset-2"
                          >
                            LinkedIn
                          </a>
                        </p>
                      ) : null}
                      {!role && !employer && !spec && !place && !linkedin ? (
                        <p className="t-caption m-0 text-ink-700">
                          Listed, and sharing nothing further.
                        </p>
                      ) : null}
                    </Record>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div className="mt-12">
          <Panel title="What being listed does not give anyone">
            <p className="t-body-sm m-0 text-ink-700">
              A place in the national directory is not entry to another university&apos;s private
              channel. You can see a graduate of another school here; their school&apos;s own space
              stays theirs, and that is checked on the server rather than by hiding a link.
            </p>
          </Panel>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
