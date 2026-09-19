import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { alumniProfiles, institutions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, Panel } from '@/components/ui';
import { AlumniProfileForm } from '@/components/alumni-panels';
import { OPTIONAL_FIELDS } from '@/modules/alumni/fields';

/**
 * AL-03 alumni profile (ALM-02, CMP-15).
 *
 * "Each field individually visibility-controlled, default private" is the
 * requirement, and the page is arranged to make that obvious rather than
 * discoverable: the directory switch first, then every field beside its own
 * visibility tick.
 *
 * Changes take effect immediately, consistent with ST-15 — §6.5 is explicit
 * that withdrawal cannot wait for a nightly job, and the directory reads this
 * row directly.
 */
export default async function AlumniProfile() {
  const me = await requireUser();

  const [row] = await db
    .select({ profile: alumniProfiles, institution: institutions })
    .from(alumniProfiles)
    .innerJoin(institutions, eq(institutions.id, alumniProfiles.institutionId))
    .where(eq(alumniProfiles.userId, me.userId))
    .limit(1);

  if (!row) redirect('/alumni');

  const { profile, institution } = row;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/alumni" className="text-ink-700 underline underline-offset-2">
            Back to the alumni home
          </Link>
        </p>

        <h1 className="t-h1 mt-4 text-ink-900">Your alumni profile</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          Nothing here is visible to anyone until you say so, field by field. You can change your
          mind at any time and it takes effect straight away.
        </p>

        <div className="mb-8">
          <Panel title="Always shown, if you are listed">
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              {me.fullName ?? me.email} · {institution.name} · {profile.cohortYear} cohort. A
              directory entry cannot exist without these three; everything else is yours to grant.
            </p>
          </Panel>
        </div>

        <AlumniProfileForm
          profile={{
            currentRole: profile.currentRole ?? '',
            employer: profile.employer ?? '',
            specialisation: profile.specialisation ?? '',
            location: profile.location ?? '',
            linkedinUrl: profile.linkedinUrl ?? '',
            directoryVisible: profile.directoryVisible,
            visibleFields: profile.visibleFields ?? [],
          }}
          fields={OPTIONAL_FIELDS.map((f) => ({ key: f.key, label: f.label }))}
        />

        <div className="mt-12">
          <Banner tone="info" title="This is a consent decision, and it is recorded">
            <p>
              Listing yourself is consent under the NDPA, so each change writes a dated record
              alongside the privacy notice version it was given against. You can see the whole
              history in{' '}
              <Link href="/account/privacy" className="text-ink-900 underline underline-offset-2">
                your privacy settings
              </Link>
              .
            </p>
          </Banner>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
