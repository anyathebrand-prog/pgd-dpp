import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { facilitatorProfiles, institutions, memberships, users } from '@/db/schema';
import { currentInstitution } from '@/lib/tenant';
import { LandingNav } from '@/components/landing-nav';
import { LandingFooter } from '@/components/landing-footer';
import { Footer, TopBar } from '@/components/shell';
import { LinkButton } from '@/components/ui';
import { FacultyCard } from '@/components/faculty-card';

/**
 * Faculty: the people who teach the programme.
 *
 * One central faculty, run by Data Protection Hub in collaboration with
 * ALDAPCON, and the same list on every host. Only facilitators who have
 * published their own profile appear (the profile is theirs to show or
 * withhold; see "My profile" in the teaching console).
 *
 * `facilitator_profiles`, `users`, `memberships` and `institutions` are all
 * shared tables, so this reads without tenant context and returns only
 * what is public: a name, a title, a biography, a photograph, a university.
 */
export default async function Faculty() {
  const here = await currentInstitution();

  const rows = await db
    .select({
      userId: users.id,
      name: users.fullName,
      email: users.email,
      title: facilitatorProfiles.title,
      bio: facilitatorProfiles.bio,
      hasPhoto: facilitatorProfiles.photoObjectKey,
      institutionId: memberships.institutionId,
      university: institutions.name,
    })
    .from(facilitatorProfiles)
    .innerJoin(users, eq(users.id, facilitatorProfiles.userId))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.role, 'facilitator')))
    .innerJoin(institutions, and(eq(institutions.id, memberships.institutionId), eq(institutions.status, 'live')))
    .where(eq(facilitatorProfiles.published, true))
    .orderBy(asc(users.fullName));

  // One card per person, listing each university they teach for.
  const people = new Map<string, { name: string; title: string | null; bio: string | null; photo: boolean; universities: string[] }>();
  for (const r of rows) {
    const p = people.get(r.userId) ?? {
      name: r.name ?? r.email,
      title: r.title,
      bio: r.bio,
      photo: Boolean(r.hasPhoto),
      universities: [],
    };
    if (!p.universities.includes(r.university)) p.universities.push(r.university);
    people.set(r.userId, p);
  }

  const body = (
    <main id="main">
      <section className="glow-hero border-b border-ink-300">
        <div className="mx-auto max-w-marketing px-4 py-16 md:px-8 md:py-24">
          <p className="t-caption m-0 text-ink-500">Data Protection Hub · in collaboration with ALDAPCON</p>
          <div className="mt-4">
            <h1 className="t-display m-0">Faculty</h1>
          </div>
          <p className="t-body-lg mt-6 max-w-[58ch] text-ink-700">
            One faculty teaches the programme at every university: lawyers, regulators, DPOs and
            academics who practise what they teach, brought together by Data Protection Hub in
            collaboration with the Association of Licensed Data Protection Compliance Organisations
            of Nigeria (ALDAPCON).
          </p>
        </div>
      </section>

      <section className="border-b border-ink-300">
        <div className="mx-auto max-w-marketing px-4 py-16 md:px-8">
          {people.size === 0 ? (
            <p className="t-body m-0 text-ink-700">
              Profiles appear here as facilitators publish them.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-2">
              {[...people.entries()].map(([userId, p]) => (
                <li key={userId}>
                  <FacultyCard
                    name={p.name}
                    title={p.title}
                    bio={p.bio}
                    universities={[]}
                    photoUrl={p.photo ? `/api/faculty/${userId}/photo` : null}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="px-4 py-20 md:px-8">
        <div className="glow-band mx-auto max-w-marketing rounded-lg px-6 py-14 text-center md:px-16">
          <h2 className="t-h1 m-0">Teach with us</h2>
          <p className="t-body-lg mx-auto mt-4 max-w-[52ch] text-ink-900/85">
            Practitioners and academics can apply to join the faculty. Data Protection Hub reviews
            every application.
          </p>
          <div className="mt-8">
            <LinkButton href="/teach-with-us">Teach with us</LinkButton>
          </div>
        </div>
      </section>
    </main>
  );

  return here ? (
    <>
      <TopBar />
      {body}
      <Footer />
    </>
  ) : (
    <>
      <LandingNav />
      {body}
      <LandingFooter />
    </>
  );
}
