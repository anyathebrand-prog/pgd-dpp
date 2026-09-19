import 'server-only';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { consentRecords } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import {
  APPLICATION_STEPS,
  completeness,
  getOrCreateApplication,
  openQueries,
} from '@/modules/admissions/application';
import { StepRail } from './shell';
import { Banner, DataString } from './ui';

/**
 * The funnel chrome. §5.3: no global navigation here — the step rail replaces
 * it, vertical beside the form on desktop and a pinned strip on mobile.
 * §3.4: the form column is 640px regardless of viewport.
 */
export async function ApplyShell({
  stepKey,
  title,
  intro,
  children,
}: {
  stepKey: (typeof APPLICATION_STEPS)[number]['key'];
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);

  if (!app) {
    return (
      <Banner tone="warning" title="No intake is open">
        <p>
          {institution.shortName} has no cohort open for applications right now.{' '}
          <Link href="/" className="text-ink-900 underline underline-offset-2">
            See the programme page
          </Link>{' '}
          for the next intake.
        </p>
      </Banner>
    );
  }

  const grants = await db
    .select({ purpose: consentRecords.purpose, granted: consentRecords.granted })
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId));
  const consented = new Set(grants.filter((g) => g.granted).map((g) => g.purpose));
  const state = await completeness(app, consented);
  const queries = await openQueries(app);

  const currentIndex = APPLICATION_STEPS.findIndex((s) => s.key === stepKey);
  const steps = APPLICATION_STEPS.map((s) => ({
    href: s.href,
    label: s.label,
    done: s.key === 'review' ? false : Boolean(state[s.key as keyof typeof state]),
    queried: s.key === 'documents' && queries.length > 0,
  }));

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <p className="t-caption m-0 text-ink-700">
          Application reference <DataString value={app.reference} label="Application reference" />
        </p>
      </div>

      <div className="grid gap-10 md:grid-cols-[220px_1fr]">
        <StepRail steps={steps} currentIndex={currentIndex} />

        <div className="max-w-[640px]">
          <h1 className="t-h1 m-0 text-ink-900">{title}</h1>
          {intro ? <p className="t-body mt-3 mb-8 text-ink-700">{intro}</p> : <div className="mb-8" />}

          {/* AP-09: a queried document is stated verbatim, wherever the
              candidate happens to be in the funnel. */}
          {queries.length > 0 && stepKey !== 'documents' ? (
            <div className="mb-8">
              <Banner tone="warning" title="The registry has queried a document">
                <ul className="m-0 list-disc pl-5">
                  {queries.map((q) => (
                    <li key={q.id}>
                      {q.documentKind.replace(/_/g, ' ')}: {q.note}
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </div>
  );
}
