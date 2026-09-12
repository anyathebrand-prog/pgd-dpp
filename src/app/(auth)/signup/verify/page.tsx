import { redirect } from 'next/navigation';
import { currentPrincipal } from '@/lib/auth';
import { ActionForm, CodeField } from '@/components/form';
import { Banner } from '@/components/ui';
import { resendOtp, verifyEmail } from '@/modules/auth/actions';

/** AU-02. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ resent?: string }>;
}) {
  const { resent } = await searchParams;
  const me = await currentPrincipal();
  if (!me) redirect('/signup');
  if (me.status !== 'pending') redirect('/apply');

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Check your email</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        We sent a six-digit code to <strong className="text-ink-900">{me.email}</strong>. Enter it
        below to open your application. If it is not in your inbox within a minute, look in spam.
      </p>

      {resent ? (
        <div className="mb-8">
          <Banner tone="info">
            <p>
              {resent === 'throttled'
                ? 'A code was sent very recently. Check your inbox and your spam folder before asking for another.'
                : 'A new code is on its way. It expires 15 minutes after it was sent.'}
            </p>
          </Banner>
        </div>
      ) : null}

      <ActionForm
        action={verifyEmail}
        submitLabel="Verify email"
        secondary={
          <form action={resendOtp}>
            <button className="t-body-sm text-ink-700 underline underline-offset-2">
              Send a new code
            </button>
          </form>
        }
      >
        <CodeField label="Verification code" />
      </ActionForm>
    </>
  );
}
