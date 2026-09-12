import { ActionForm } from './form';
import { Field, Input } from './ui';
import { submitNewPassword } from '@/modules/auth/actions';

/**
 * AU-05 and AU-06 are the same screen with different copy, so they are the
 * same component. The button names its outcome — "Set password" — and the
 * same verb survives into the confirmation (§1.4).
 */
export function SetPasswordForm({
  token,
  purpose,
}: {
  token: string;
  purpose: 'reset_password' | 'activate';
}) {
  return (
    <ActionForm action={submitNewPassword} submitLabel="Set password">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />

      <Field
        label="New password"
        name="password"
        required
        helper="At least 10 characters, including a letter and a number. Length helps more than symbols do."
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <Field label="New password again" name="confirm" required>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <p className="t-body-sm text-ink-700">
        Setting a password signs you out of every other device, in case someone else has been using
        the account.
      </p>
    </ActionForm>
  );
}
