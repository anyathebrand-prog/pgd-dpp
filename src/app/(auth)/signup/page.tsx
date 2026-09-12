import Link from 'next/link';
import { requireInstitution } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { signUp } from '@/modules/auth/actions';

/** AU-01. APP-01: email + password, verified by OTP before the form opens. */
export default async function SignUpPage() {
  const institution = await requireInstitution();

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Create your account</h1>
      <p className="t-body mt-3 mb-10 text-ink-700">
        You are applying to {institution.name}. We verify your email address before the application
        form opens, so that the address on your admission letter is one you can actually reach.
      </p>

      <ActionForm action={signUp} submitLabel="Create account">
        <Field label="Full name" name="fullName" required helper="As it appears on your degree certificate.">
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </Field>

        <Field label="Email address" name="email" required helper="We send your verification code and admission letter here.">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </Field>

        <Field
          label="Password"
          name="password"
          required
          helper="At least 10 characters, including a letter and a number."
        >
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
      </ActionForm>

      <p className="t-body-sm mt-8 text-ink-700">
        Already started?{' '}
        <Link href="/login" className="text-ink-900 underline underline-offset-2">
          Log in
        </Link>
      </p>
    </>
  );
}
