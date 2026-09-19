import { ActionForm, CodeField } from '@/components/form';
import { verifyTotp } from '@/modules/auth/totp-actions';

/**
 * AU-08. AUTH-08 makes TOTP mandatory for Registry, Institution Admin, Super
 * Admin and DPO — the four roles that read other people's documents. A session
 * for those roles is created unsatisfied and this is the only way to satisfy it.
 */
export default function TwoFactorPage() {
  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Enter your authenticator code</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        Your role gives you access to other people&apos;s records, so a second factor is required
        every time, not only on a new device.
      </p>
      <ActionForm action={verifyTotp} submitLabel="Verify and continue">
        <CodeField label="Six-digit code from your authenticator app" />
      </ActionForm>
    </>
  );
}
