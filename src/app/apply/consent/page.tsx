import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { consentRecords } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { CONSENT_PURPOSES, currentNoticeVersion } from '@/lib/consent';
import { saveConsent } from '@/modules/admissions/actions';
import { ApplyShell } from '@/components/apply-shell';
import { ActionForm } from '@/components/form';

/**
 * AP-07 / CMP-06. Four decisions, not one bundled agreement.
 *
 * §5.2 consent row: a full-width Manila row, the purpose title at h4, plain
 * language beneath, and the notice version linked at caption size. The unset
 * state is visibly unset — a grey that reads as off-but-maybe-on is how
 * consent records become worthless.
 */
export default async function ConsentPage() {
  const me = await requireUser();
  const version = await currentNoticeVersion();

  // The most recent decision per purpose, so returning here shows what they chose.
  const rows = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId))
    .orderBy(desc(consentRecords.recordedAt));
  const latest = new Map<string, boolean>();
  for (const r of rows) if (!latest.has(r.purpose)) latest.set(r.purpose, r.granted);

  return (
    <ApplyShell
      stepKey="consent"
      title="What you are agreeing to"
      intro="Four separate decisions. Only the first is needed to process your application — the other three are genuinely optional and declining them changes nothing about your chances."
    >
      <ActionForm action={saveConsent} submitLabel="Record my choices">
        <ul className="m-0 grid list-none gap-4 p-0">
          {CONSENT_PURPOSES.map((purpose) => (
            <li key={purpose.key} className="rounded-md bg-record p-5">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <h2 className="t-h4 m-0 text-ink-900">
                    {purpose.title}
                    {purpose.required ? (
                      <span className="t-body-sm font-normal text-ink-700"> — required</span>
                    ) : null}
                  </h2>
                  <p className="t-body-sm mt-2 mb-2 text-ink-700">{purpose.text}</p>
                  <p className="t-caption m-0 text-ink-700">
                    {purpose.lawfulBasisNote}{' '}
                    <Link href={`/privacy/v${version}`} className="text-ink-700 underline underline-offset-2">
                      Privacy notice v{version}
                    </Link>
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2">
                  <span className="sr-only">{purpose.title}</span>
                  <input
                    type="checkbox"
                    name={purpose.key}
                    defaultChecked={latest.get(purpose.key) ?? false}
                    className="h-11 w-11 accent-[#6B2436]"
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>

        <p className="t-body-sm mt-8 text-ink-700">
          Every choice here is recorded with the date, the wording you were shown, and the version of
          the privacy notice in force. You can change any of the optional ones later from your
          privacy settings, and withdrawing is as easy as granting.
        </p>
      </ActionForm>
    </ApplyShell>
  );
}
