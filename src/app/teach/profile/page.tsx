import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { facilitatorProfiles, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Banner, Field, Input, Textarea } from '@/components/ui';
import { FacultyCard } from '@/components/faculty-card';
import { removeFacilitatorPhoto, saveFacilitatorProfile } from '@/modules/teaching/profile-actions';

/**
 * The facilitator's own profile for the public Faculty page. Edited here,
 * previewed beside the form in exactly the card the public sees, and shown
 * publicly only once the facilitator ticks the box.
 */
export default async function MyProfile({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator');
  const { saved } = await searchParams;

  const [profile] = await db.select().from(facilitatorProfiles).where(eq(facilitatorProfiles.userId, me.userId)).limit(1);
  const [user] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, me.userId)).limit(1);
  const name = user?.fullName ?? me.email;
  // The preview shows the photograph whether or not it is public yet, so it
  // goes through the signed-in owner's own file link rather than the public one.
  const photoUrl = profile?.photoObjectKey ? `/teach/profile/photo?v=${encodeURIComponent(profile.photoObjectKey)}` : null;

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">My profile</h1>
      <p className="t-body measure mt-3 mb-8 text-ink-700">
        This is what the public{' '}
        <Link href="/faculty" className="text-ink-900 underline underline-offset-2">
          Faculty page
        </Link>{' '}
        shows about you, once you choose to publish it. Nothing appears there until you do.
      </p>

      {saved ? (
        <div className="mb-8">
          <Banner tone={saved === 'public' ? 'verified' : 'info'} title={saved === 'public' ? 'Published' : 'Saved'}>
            <p>
              {saved === 'public'
                ? 'Your profile is on the Faculty page now.'
                : saved === 'photo-removed'
                  ? 'Your photograph has been removed.'
                  : 'Saved, and kept private. Tick "Show my profile publicly" when you are ready.'}
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
        <ActionForm action={saveFacilitatorProfile} submitLabel="Save my profile">
          <Field label="Photograph" name="photo" helper="JPG or PNG, at least 300 pixels each way, up to 5MB. A head-and-shoulders portrait works best.">
            <Input id="photo" name="photo" type="file" accept="image/jpeg,image/png" />
          </Field>
          <Field label="Title" name="title" helper={`For example: Senior Lecturer, Faculty of Law, ${institution.shortName}.`}>
            <Input id="title" name="title" defaultValue={profile?.title ?? ''} maxLength={120} />
          </Field>
          <Field
            label="Profile"
            name="bio"
            helper="A short narrative in the third person: your background, your practice, what you teach. Up to about 300 words."
          >
            <Textarea id="bio" name="bio" rows={9} defaultValue={profile?.bio ?? ''} maxLength={2000} />
          </Field>
          <label className="t-body-sm mb-6 flex items-start gap-3 text-ink-900">
            <input
              type="checkbox"
              name="published"
              defaultChecked={profile?.published ?? false}
              className="mt-1 h-5 w-5 shrink-0 accent-[#6da5f2]"
            />
            <span>
              Show my profile publicly on the Faculty page, with my photograph. You can take it down
              at any time by unticking this.
            </span>
          </label>
        </ActionForm>

        <aside>
          <p className="t-caption m-0 mb-3 text-ink-700">
            Preview {profile?.published ? '(public now)' : '(private)'}
          </p>
          <FacultyCard
            name={name}
            title={profile?.title ?? null}
            bio={profile?.bio ?? 'Your profile will appear here.'}
            universities={[institution.name]}
            photoUrl={photoUrl}
          />
          {profile?.photoObjectKey ? (
            <div className="mt-4">
              <ActionForm action={removeFacilitatorPhoto} submitLabel="Remove photograph">
                <span />
              </ActionForm>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
