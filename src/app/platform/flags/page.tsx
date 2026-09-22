import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { FLAGS, FLAG_KEYS, flagEnabled, flagState, type FlagKey } from '@/lib/flags';
import { Banner, Panel, Record, cx } from '@/components/ui';
import { InstitutionFlag, PlatformSwitch } from '@/components/flag-panels';

/**
 * SA-03 feature flags — `app./platform/flags` (§5.9).
 *
 * A flag flip is a deploy without a commit: it changes what real people can
 * do, immediately, with no review and no diff. The screen is built around
 * that rather than around a grid of switches — each flag says what it gates
 * and what turning it off does to somebody mid-flow, because that consequence
 * is the thing a person at three in the morning does not have time to work
 * out for themselves.
 *
 * Every flag listed here gates something real. A flag that changes nothing is
 * worse than no flag: it gets turned off in an incident and the feature keeps
 * running.
 */
export default async function Flags({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  await requireRole('super_admin');
  const { changed } = await searchParams;

  const rows = await db.select().from(institutions).orderBy(asc(institutions.name));
  const { globals, overrides } = await flagState();

  const resolved = await Promise.all(
    FLAG_KEYS.map(async (key) => ({
      key,
      platform: globals[key] ?? FLAGS[key].default,
      set: Object.prototype.hasOwnProperty.call(globals, key),
      perInstitution: await Promise.all(
        rows.map(async (institution) => ({
          institution,
          enabled: await flagEnabled(key, institution.id),
          value: (overrides.find((o) => o.key === key && o.institutionId === institution.id)
            ? overrides.find((o) => o.key === key && o.institutionId === institution.id)!.enabled
              ? 'on'
              : 'off'
            : 'inherit') as 'on' | 'off' | 'inherit',
        })),
      ),
    })),
  );

  const off = resolved.filter((f) => !f.platform);

  return (
    <div>
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Feature flags</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Each of these gates something a person can do. Turning one off takes effect on the next
          request, for everyone it applies to, with no deploy — which is why every change is logged
          with your name against it.
        </p>

        {changed ? (
          <div className="mt-8">
            <Banner tone="verified" title={`${changed} changed`}>
              <p>It is in force now. The change is in the audit log with your name on it.</p>
            </Banner>
          </div>
        ) : null}

        {off.length > 0 ? (
          <div className="mt-8">
            <Banner tone="warning" title="Something is switched off platform-wide">
              <p>
                {off.map((f) => FLAGS[f.key as FlagKey].label).join(', ')}{' '}
                {off.length === 1 ? 'is' : 'are'} off for every institution, including any that had
                been asked for it. A platform switch overrides what an institution chose.
              </p>
            </Banner>
          </div>
        ) : null}

        <ul className="mt-10 grid list-none gap-8 p-0">
          {resolved.map((flag) => {
            const meta = FLAGS[flag.key as FlagKey];
            return (
              <Record
                as="li"
                key={flag.key}
                title={meta.label}
                meta={
                  flag.set
                    ? `Platform: ${flag.platform ? 'on' : 'off'}`
                    : `Platform: ${flag.platform ? 'on' : 'off'} (default, never changed)`
                }
                className={cx(!flag.platform && 'border-l-[3px] border-l-warning')}
              >
                <p className="t-body-sm measure mt-0 mb-3 text-ink-700">{meta.description}</p>
                <p className="t-body-sm measure mt-0 mb-5 text-ink-900">
                  <strong>Turning it off:</strong> {meta.consequence}
                </p>

                <div className="mb-6">
                  <PlatformSwitch
                    flagKey={flag.key}
                    label={meta.label.toLowerCase()}
                    enabled={flag.platform}
                  />
                </div>

                {flag.platform ? (
                  <div className="border-t border-ink-300 pt-4">
                    <p className="t-label mt-0 mb-3 text-ink-900">Per institution</p>
                    <ul className="m-0 grid list-none gap-3 p-0">
                      {flag.perInstitution.map(({ institution, enabled, value }) => (
                        <li key={institution.id} className="flex flex-wrap items-center gap-3">
                          <span className="t-body-sm w-[180px] shrink-0 text-ink-900">
                            {institution.shortName}
                          </span>
                          <InstitutionFlag
                            flagKey={flag.key}
                            institutionId={institution.id}
                            institutionName={institution.shortName}
                            label={meta.label}
                            value={value}
                            resolved={enabled}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="t-body-sm m-0 border-t border-ink-300 pt-4 text-ink-700">
                    Per-institution settings are hidden while this is off platform-wide, because
                    none of them would do anything. They are kept, not cleared — turning the
                    platform switch back on restores what each institution had.
                  </p>
                )}
              </Record>
            );
          })}
        </ul>

        <div className="mt-10">
          <Panel title="Why the list is short">
            {/* The entry condition, written down where somebody would go to
                add a fifth flag. */}
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              A flag only appears here once the code actually branches on it. The temptation is to
              add a switch per feature and wire them later, which produces a console where turning
              something off in an incident does nothing and the person reading it believes
              otherwise. The catalogue lives in <code className="t-data">src/lib/flags.ts</code>;
              adding a row to the database does not create a flag.
            </p>
          </Panel>
        </div>

        <p className="t-body-sm mt-10">
          <Link href="/platform/tenants" className="text-ink-700 underline underline-offset-2">
            Back to institutions
          </Link>
        </p>
      </main>
    </div>
  );
}
