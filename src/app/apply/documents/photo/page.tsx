import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { getOrCreateApplication } from '@/modules/admissions/application';
import { ApplyShell } from '@/components/apply-shell';
import { Banner, Panel } from '@/components/ui';
import { PhotoCropper } from '@/components/photo-cropper';

/**
 * AP-06 passport photo crop — `{school}./apply/documents/photo` (APP-05).
 *
 * The flow's last edge case is the one that shapes this page: the photograph
 * is used for the ID card, exam identity and the certificate (§6.4) — and
 * explicitly **not** for facial recognition, "which should be stated in the
 * privacy notice, not just in the PRD". It is stated here as well, because
 * the notice is a document somebody may read once and this is the moment they
 * are handing over a photograph of their face.
 */
export default async function PhotoPage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  if (!app) return null;

  const [existing] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.applicationId, app.id),
          eq(documents.kind, 'passport_photo'),
          eq(documents.status, 'uploaded'),
        ),
      )
      .limit(1),
  );

  return (
    <ApplyShell
      stepKey="documents"
      title="Your photograph"
      intro="A passport photograph, 35 by 45 — the same one you would give a bank. Crop it here rather than guessing: this is what your ID card and your certificate will carry."
    >
      <Banner tone="info" title="What this photograph is used for">
        <p>
          Your ID card, confirming who you are at an examination, and your certificate. It is{' '}
          <strong>not</strong> run through facial recognition, here or by anyone we send it to, and
          it is not used to identify you anywhere else.
        </p>
      </Banner>

      {existing ? (
        <div className="mt-6">
          <Banner tone="verified" title="A photograph is already on your application">
            <p>
              You can replace it below. The one you had is kept on the record rather than
              overwritten, which is how every document on this application works.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="mt-8">
        <PhotoCropper hasExisting={Boolean(existing)} />
      </div>

      <div className="mt-12">
        <Panel title="What makes a photograph fail">
          <ul className="t-body-sm m-0 grid list-disc gap-2 pl-5 text-ink-700">
            <li>Too small to print. It has to be at least 413×531 pixels.</li>
            <li>A busy background, or somebody else in the frame.</li>
            <li>A hat, sunglasses, or a flash reflection across your glasses.</li>
            <li>Taken at an angle. Face the camera square on.</li>
          </ul>
        </Panel>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-6">
        <Link
          href="/apply/documents"
          className="t-body-sm text-ink-700 underline underline-offset-2"
        >
          Back to documents
        </Link>
        <Link href="/apply/consent" className="t-body-sm text-ink-700 underline underline-offset-2">
          {/* The flow's "Skip for now", named for what it actually does. */}
          Skip for now — this leaves the item incomplete and you cannot submit
        </Link>
      </div>
    </ApplyShell>
  );
}
