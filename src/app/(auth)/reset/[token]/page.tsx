import { SetPasswordForm } from '@/components/set-password';

/** AU-05. */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Set a new password</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        This link works once. If it has expired, request another from the login screen.
      </p>
      <SetPasswordForm token={token} purpose="reset_password" />
    </>
  );
}
