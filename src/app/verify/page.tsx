import { redirect } from 'next/navigation';
import { Field, Input, Button } from '@/components/ui';

/** PB-07 entry point. */
export default function VerifyEntry() {
  async function check(form: FormData) {
    'use server';
    const code = String(form.get('code') ?? '').trim().toUpperCase();
    redirect(`/verify/${encodeURIComponent(code)}`);
  }

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <h1 className="t-h1 m-0 text-ink-900">Verify a certificate</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        Enter the code printed on the certificate or admission letter. You do not need an account.
      </p>
      <form action={check}>
        <Field label="Verification code" name="code" required helper="Letters and numbers, as printed.">
          <Input id="code" name="code" required className="t-data" autoCapitalize="characters" />
        </Field>
        <div className="mt-16">
          <Button type="submit">Check this code</Button>
        </div>
      </form>
    </main>
  );
}
