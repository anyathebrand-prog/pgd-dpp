import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { currentInstitution, tenantUrl } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Footer, TopBar } from '@/components/shell';
import { Banner, Field, Input, Textarea } from '@/components/ui';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { submitTeachingApplication } from '@/modules/admin/teaching-applications';

/**
 * "Teach with us". A request to teach, sent to one university.
 *
 * On a university's host, the form. On the platform host, a choice of
 * university first, because an application is always to one of them: each
 * appoints its own facilitators, and nothing here grants a role. The
 * administrator decides, from their Staff page.
 */
export default async function TeachWithUs({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const institution = await currentInstitution();
  const { sent } = await searchParams;

  if (!institution) {
    const live = await db
      .select()
      .from(institutions)
      .where(eq(institutions.status, 'live'))
      .orderBy(asc(institutions.name));
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[720px] px-4 py-12 md:px-8">
          <h1 className="t-h1 m-0">Teach with us</h1>
          <p className="t-body-lg mt-4 text-ink-700">
            Each university appoints its own facilitators. Choose the one you would like to teach
            for; your application goes to its administrator.
          </p>
          <ul className="mt-10 grid list-none gap-3 p-0">
            {live.map((inst) => (
              <li key={inst.id}>
                <a
                  href={tenantUrl(inst.slug, '/teach-with-us')}
                  className="hairline motion-state flex items-center justify-between rounded-md px-6 py-5 no-underline hover:bg-ink-100/40"
                >
                  <span>
                    <span className="t-h4 block text-ink-900">{inst.name}</span>
                    {inst.city ? <span className="t-body-sm text-ink-700">{inst.city}</span> : null}
                  </span>
                  <span aria-hidden="true" className="text-ink-700">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </main>
        <Footer />
      </>
    );
  }

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <h1 className="t-h1 mt-2 mb-0">Teach with us</h1>
        <p className="t-body mt-4 mb-10 text-ink-700">
          Facilitators teach modules, mark coursework and run live sessions. Tell us about yourself
          and {institution.shortName}&apos;s administrator will reply. Applying does not give you
          any access: if you are appointed, you will receive an invitation to set up your account.
        </p>

        {sent ? (
          <Banner tone="verified" title="Application sent">
            <p>
              {institution.shortName}&apos;s administrator has it. They will reply by email, whether
              or not you are appointed.
            </p>
          </Banner>
        ) : (
          <ActionForm action={submitTeachingApplication} submitLabel="Send my application">
            <Field label="Full name" name="fullName" required>
              <Input id="fullName" name="fullName" autoComplete="name" required />
            </Field>
            <Field label="Email address" name="email" required helper="The university replies here.">
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
            <Field label="CV" name="cv" helper="PDF or Word (.docx), up to 5MB.">
              <Input
                id="cv"
                name="cv"
                type="file"
                accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              />
            </Field>
            <label className="t-body-sm mb-6 flex items-start gap-3 text-ink-900">
              <input type="checkbox" name="consent" required className="mt-1 h-5 w-5 shrink-0 accent-[#6da5f2]" />
              <span>
                {institution.name} may hold these details, and my CV, to consider this application.
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
      <Footer />
    </>
  );
}
