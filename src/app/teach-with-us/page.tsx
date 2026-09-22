import Link from 'next/link';
import { currentInstitution } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { LandingNav } from '@/components/landing-nav';
import { LandingFooter } from '@/components/landing-footer';
import { Footer, TopBar } from '@/components/shell';
import { Banner, Field, Input, Textarea } from '@/components/ui';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { submitTeachingApplication } from '@/modules/admin/teaching-applications';

/**
 * "Teach with us": applying to the one central faculty.
 *
 * The faculty is run by Data Protection Hub in collaboration with ALDAPCON,
 * so there is no university to choose: the application goes to the Hub,
 * which decides and, if it appoints someone, where they will teach. The
 * same form on every host.
 */
export default async function TeachWithUs({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const here = await currentInstitution();
  const { sent } = await searchParams;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const body = (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
      <p className="t-label m-0 text-ink-700">Data Protection Hub · in collaboration with ALDAPCON</p>
      <h1 className="t-h1 mt-2 mb-0">Teach with us</h1>
      <p className="t-body mt-4 mb-10 text-ink-700">
        The programme has one faculty, run by Data Protection Hub in collaboration with the
        Association of Licensed Data Protection Compliance Organisations of Nigeria (ALDAPCON).
        Facilitators teach modules, mark coursework and run live sessions. Tell us about yourself
        and we will reply. Applying does not give you any access: if you are appointed, you will
        receive an invitation to set up your account.
      </p>

      {sent ? (
        <Banner tone="verified" title="Application sent">
          <p>Data Protection Hub has it, and will reply by email whether or not you are appointed.</p>
        </Banner>
      ) : (
        <ActionForm action={submitTeachingApplication} submitLabel="Send my application">
          <Field label="Full name" name="fullName" required>
            <Input id="fullName" name="fullName" autoComplete="name" required />
          </Field>
          <Field label="Email address" name="email" required helper="We reply here.">
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
          </Field>
          <Field label="Phone" name="phone">
            <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" />
          </Field>
          <Field
            label="Qualifications and experience"
            name="qualifications"
            required
            helper="Degrees, certifications (CIPM, CIPP/E, NDPC-licensed DPCO work), and where you have practised or taught."
          >
            <Textarea id="qualifications" name="qualifications" rows={5} required />
          </Field>
          <Field
            label="What you would like to teach"
            name="areas"
            required
            helper="For example: the NDPA 2023 in practice, breach response, DPIAs."
          >
            <Textarea id="areas" name="areas" rows={3} required />
          </Field>
          <Field label="CV" name="cv" required helper="PDF or Word (.docx), up to 5MB.">
            <Input
              id="cv"
              name="cv"
              type="file"
              required
              accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />
          </Field>
          <Field
            label="Academic certificates"
            name="academicCerts"
            required
            helper="Degree certificates and transcripts. Select several at once if you have them (up to 5). PDF, JPG or PNG, up to 5MB each; a clear phone photograph is fine."
          >
            <Input id="academicCerts" name="academicCerts" type="file" multiple required accept=".pdf,application/pdf,image/jpeg,image/png" />
          </Field>
          <Field
            label="Professional certificates"
            name="professionalCerts"
            required
            helper="For example: DPCO licence, CIPP/E, CIPM, CIPT, call to bar, NDPC-recognised training. Up to 5; PDF, JPG or PNG, up to 5MB each."
          >
            <Input
              id="professionalCerts"
              name="professionalCerts"
              type="file"
              multiple
              required
              accept=".pdf,application/pdf,image/jpeg,image/png"
            />
          </Field>
          <label className="t-body-sm mb-6 flex items-start gap-3 text-ink-900">
            <input type="checkbox" name="consent" required className="mt-1 h-5 w-5 shrink-0 accent-[#6da5f2]" />
            <span>
              Data Protection Hub may hold these details, my CV and my certificates, to consider
              this application.
              If I am not appointed they are deleted.{' '}
              <Link href="/privacy" className="text-ink-900 underline underline-offset-2">
                How we handle your data
              </Link>
            </span>
          </label>
          {siteKey ? <TurnstileWidget siteKey={siteKey} action="teach_application" /> : null}
        </ActionForm>
      )}
    </main>
  );

  return here ? (
    <>
      <TopBar />
      {body}
      <Footer />
    </>
  ) : (
    <>
      <LandingNav />
      {body}
      <LandingFooter />
    </>
  );
}
