import Link from 'next/link';
import { requireInstitutionOrNull } from '@/modules/compliance/intake';
import { submitDsr } from '@/modules/compliance/intake';
import { currentPrincipal } from '@/lib/auth';
import { ActionForm } from '@/components/form';
import { Footer, TopBar } from '@/components/shell';
import { Banner, Field, Input, Select, Textarea } from '@/components/ui';

/**
 * Data subject request intake.
 *
 * Public and unauthenticated on purpose: the people most likely to need this
 * are rejected applicants whose documents we still hold, and requiring them to
 * sign in to ask for deletion would be a poor joke.
 *
 * §6.6 wants self-service first, so the page leads with the things that do not
 * need a human at all. The form is the fallback, not the front door.
 */
export default async function RequestIntake({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const me = await currentPrincipal();
  const institution = await requireInstitutionOrNull();

  if (sent) {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
          <h1 className="t-h1 m-0 text-ink-900">Your request has been logged</h1>
          <div className="mt-8">
            <Banner tone="info" title="What happens now">
              <p>
                The Data Protection Officer has 30 days to respond, and the clock started today.
                You will be emailed at the address you gave. If your request touches records held
                by your institution, we route it to them and stay responsible for the answer — you
                will not be asked to write to anyone else.
              </p>
            </Banner>
          </div>
          <p className="t-body mt-8 text-ink-700">
            If you are not satisfied with the outcome, you can serve a Standard Notice to Address
            Grievance, or complain to the Nigeria Data Protection Commission directly.
          </p>
          <p className="t-body-sm mt-8">
            <Link href="/" className="text-ink-900 underline underline-offset-2">
              Back to the start
            </Link>
          </p>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        <h1 className="t-h1 m-0 text-ink-900">Make a data protection request</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          You have rights over the data we hold about you under the Nigeria Data Protection Act
          2023. You do not need a reason, and exercising them costs nothing.
        </p>

        {me ? (
          <div className="mb-8">
            <Banner tone="info" title="Some of this you can do right now, without waiting">
              <p>
                <Link href="/account/privacy/export" className="text-ink-900 underline underline-offset-2">
                  Download everything we hold about you
                </Link>{' '}
                or{' '}
                <Link href="/account/privacy" className="text-ink-900 underline underline-offset-2">
                  change your consent settings
                </Link>
                . Neither needs anyone&apos;s approval, and neither takes 30 days.
              </p>
            </Banner>
          </div>
        ) : null}

        <ActionForm action={submitDsr} submitLabel="Send this request">
          <Field
            label="Your email address"
            name="subjectEmail"
            required
            helper="It must be the address we hold for you — that is how we confirm the request is yours without asking for identity documents."
          >
            <Input
              id="subjectEmail"
              name="subjectEmail"
              type="email"
              inputMode="email"
              required
              defaultValue={me?.email ?? ''}
              readOnly={Boolean(me)}
            />
          </Field>

          <Field label="What are you asking for" name="kind" required>
            <Select id="kind" name="kind" required defaultValue="access">
              <option value="access">A copy of the data you hold about me</option>
              <option value="rectification">Correction of something that is wrong</option>
              <option value="erasure">Deletion of my data</option>
              <option value="portability">My data in a portable format</option>
              <option value="restriction">Restriction of how my data is used</option>
              <option value="objection">Objection to processing</option>
            </Select>
          </Field>

          <Field
            label="Anything that would help us answer"
            name="detail"
            helper="Optional. If you are asking for a correction, say what is wrong and what it should say."
          >
            <Textarea id="detail" name="detail" rows={5} />
          </Field>

          {institution ? <input type="hidden" name="institutionSlug" value={institution.slug} /> : null}

          <Banner tone="info" title="On erasure">
            <p>
              Some records cannot be deleted on request — an academic record, once awarded, and
              financial records we are required to keep. If that applies to you we will say so in
              writing with the reason, rather than quietly leaving the data in place.
            </p>
          </Banner>
        </ActionForm>
      </main>
      <Footer />
    </>
  );
}
