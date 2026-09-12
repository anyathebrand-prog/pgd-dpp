import { SetPasswordForm } from '@/components/set-password';
import { requireInstitution } from '@/lib/tenant';

/**
 * AU-06 / AUTH-01. The activation link — never a generated password emailed in
 * plaintext. The student chooses their own credential, and we never hold one
 * we could leak.
 */
export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const institution = await requireInstitution();
  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Set your password</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        Your account at {institution.name} is ready. Choose a password and you are in. This link
        works once and expires 24 hours after it was sent.
      </p>
      <SetPasswordForm token={token} purpose="activate" />
    </>
  );
}
