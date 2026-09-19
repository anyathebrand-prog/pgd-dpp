import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { requestReset } from '@/modules/auth/actions';

/**
 * AU-04. The response is identical whether or not the account exists, which is
 * why the confirmation is worded as a conditional and never as "we've emailed
 * you" — the second wording is an enumeration oracle dressed as friendliness.
 */
export default function ForgotPage() {
  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Reset your password</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        Enter the email address on your account. If it matches one, we send a link that works once
        and expires in 30 minutes.
      </p>

      <ActionForm action={requestReset} submitLabel="Send reset link">
        <Field label="Email address" name="email" required>
          <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required />
        </Field>
      </ActionForm>
    </>
  );
}
