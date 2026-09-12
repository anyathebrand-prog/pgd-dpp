import { eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { consentRecords, documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { completeness, getOrCreateApplication, REQUIRED_DOCUMENTS } from '@/modules/admissions/application';
import { submitApplication } from '@/modules/admissions/actions';
import { feeFor } from '@/modules/payments/fees';
import { ApplyShell } from '@/components/apply-shell';
import { Banner, Naira, Record } from '@/components/ui';
import { ActionButton } from '@/components/action-button';

/**
 * AP-08. The one place the non-refundable nature of the application fee is
 * stated immediately before the button that charges it — not in terms, not on
 * a page the candidate passed ten minutes ago.
 *
 * §6: the submit button is disabled only alongside an explicit list of what is
 * outstanding, each item a jump link. A disabled button with no explanation
 * fails WCAG 3.3.1, and this is the screen where that failure would cost the
 * most.
 */
export default async function ReviewPage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  if (!app) return null;

  const grants = await db
    .select({ purpose: consentRecords.purpose, granted: consentRecords.granted })
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId));
  const consented = new Set(grants.filter((g) => g.granted).map((g) => g.purpose));

  const state = await completeness(app, consented);
  const fee = await feeFor(institution.id, 'application', app.cohortId);

  const docs = await withTenant(institution.id, (tx) =>
    tx.select().from(documents).where(eq(documents.applicationId, app.id)),
  );
  const onFile = new Set(docs.filter((d) => d.status !== 'rejected').map((d) => d.kind));

  const personal = app.personal as Record<string, string>;
  const education = app.education as Record<string, string>;

  return (
    <ApplyShell
      stepKey="review"
      title="Review and submit"
      intro="Check this is right. After submission you can only change a document the registry asks you to replace."
    >
      <div className="grid gap-5">
        <Record title="Personal details" meta={`${personal.fullName ?? '—'} · ${personal.phone ?? '—'}`}>
          <dl className="t-body-sm m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-ink-900">
            <dt className="text-ink-700">Date of birth</dt>
            <dd className="m-0">{personal.dob ?? '—'}</dd>
            <dt className="text-ink-700">State of origin</dt>
            <dd className="m-0">{personal.stateOfOrigin ?? '—'}</dd>
            <dt className="text-ink-700">Address</dt>
            <dd className="m-0">{personal.address ?? '—'}</dd>
            <dt className="text-ink-700">Next of kin</dt>
            <dd className="m-0">
              {personal.nokName ?? '—'} · {personal.nokPhone ?? '—'}
            </dd>
          </dl>
        </Record>

        <Record title="Education" meta={education.institution ?? '—'}>
          <dl className="t-body-sm m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-ink-900">
            <dt className="text-ink-700">Degree</dt>
            <dd className="m-0">{education.degree ?? '—'}</dd>
            <dt className="text-ink-700">Class</dt>
            <dd className="m-0">{education.classOfDegree ?? '—'}</dd>
            <dt className="text-ink-700">Graduated</dt>
            <dd className="m-0">{education.yearOfGraduation ?? '—'}</dd>
          </dl>
        </Record>

        <Record title="Documents" meta={`${onFile.size} of ${REQUIRED_DOCUMENTS.length} on file`}>
          <ul className="t-body-sm m-0 list-none p-0 text-ink-900">
            {REQUIRED_DOCUMENTS.map((d) => (
              <li key={d.kind} className="flex items-center gap-2">
                <span aria-hidden="true">{onFile.has(d.kind) ? '✓' : '—'}</span>
                <span className={onFile.has(d.kind) ? '' : 'text-ink-700'}>{d.label}</span>
              </li>
            ))}
          </ul>
        </Record>
      </div>

      {state.outstanding.length > 0 ? (
        <div className="mt-10">
          <Banner tone="warning" title="Still outstanding">
            <ul className="m-0 list-disc pl-5">
              {state.outstanding.map((o) => (
                <li key={`${o.href}-${o.label}`}>
                  <a href={o.href} className="text-ink-900 underline underline-offset-2">
                    {o.label}
                  </a>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : (
        <div className="mt-10">
          <Banner tone="info" title="What happens when you submit">
            <p>
              You pay the application fee of {fee ? <Naira kobo={fee.amountKobo} /> : '—'}, and your
              application goes to the registry at {institution.shortName}. The fee is
              non-refundable, including if your application is unsuccessful. Tuition is a separate
              payment and is only ever charged after you have been offered a place and accepted it.
            </p>
          </Banner>
        </div>
      )}

      <div className="mt-16">
        <ActionButton
          action={submitApplication}
          disabled={state.outstanding.length > 0}
          label={`Submit and pay ${fee ? `₦${(fee.amountKobo / 100).toLocaleString('en-NG')}` : ''}`.trim()}
          pendingLabel="Submitting"
        />
      </div>
    </ApplyShell>
  );
}
