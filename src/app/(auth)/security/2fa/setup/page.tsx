import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { ActionForm, CodeField } from '@/components/form';
import { Panel } from '@/components/ui';
import { beginTotpEnrolment, confirmTotpEnrolment } from '@/modules/auth/totp-actions';
import { otpauthUri } from '@/modules/auth/totp';

/**
 * AU-07. No QR image is rendered: a QR library is a dependency and an image is
 * a paint cost, and the manual key works in every authenticator app. The
 * otpauth:// link opens the app directly on a phone, which is where staff
 * actually do this.
 */
export default async function TotpSetupPage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const secret = await beginTotpEnrolment();
  // Already enrolled: the secret is never shown again, and the challenge is
  // the only way through. See beginTotpEnrolment for why.
  if (!secret) redirect('/login/2fa');
  const uri = otpauthUri(secret, me.email, institution.shortName);

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Set up your authenticator</h1>
      <p className="t-body mt-3 mb-8 text-ink-700">
        Your role reads other people&apos;s records, so a second factor is required before you can
        open a console. Add this key to an authenticator app, then enter the code it shows.
      </p>

      <Panel title="Your setup key">
        <p className="t-data m-0 mb-4 break-all text-ink-900">{secret}</p>
        <a href={uri} className="t-body-sm text-ink-900 underline underline-offset-2">
          Open in an authenticator app on this device
        </a>
      </Panel>

      <div className="mt-10">
        <ActionForm action={confirmTotpEnrolment} submitLabel="Confirm and continue">
          <CodeField label="Code from your authenticator app" />
        </ActionForm>
      </div>
    </>
  );
}
