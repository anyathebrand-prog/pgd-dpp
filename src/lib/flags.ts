import 'server-only';
import { cache } from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { featureFlagOverrides, featureFlags } from '@/db/schema';

/**
 * SA-03 feature flags (§5.9).
 *
 * The catalogue is here, in code, and only the state is in the database. A
 * flag is a branch somebody wrote; it cannot be conjured by inserting a row,
 * and a row naming a flag no code reads is dead weight that still looks like
 * a control on a console.
 *
 * Every flag in this list gates something real. That is the entry condition:
 * a flag that changes nothing is worse than no flag, because a platform admin
 * turns it off in an incident and believes the feature has stopped.
 */
export const FLAGS = {
  offline_payments: {
    label: 'Bank transfer payments',
    description:
      'PY-06 and IA-09. Candidates can pay by transfer and upload proof, and staff approve it against a bank statement. Off means card is the only way to pay.',
    consequence:
      'Turning this off mid-intake strands anyone who has already sent a transfer and not yet been approved — approve the queue first.',
    default: true,
  },
  school_channels: {
    label: 'School alumni channels',
    description:
      'ALM-10 to ALM-12. A private channel per institution for its own graduates, with moderation by that institution.',
    consequence:
      'Off hides the channel and its posts from graduates. Nothing is deleted, and turning it back on restores the thread as it was.',
    default: true,
  },
  live_sessions: {
    label: 'Live sessions',
    description:
      'LRN-07 and LRN-10. Facilitators schedule sessions and attendance is recorded when the join link is handed over.',
    consequence:
      'Off hides scheduled sessions from students. Attendance already recorded is untouched, since it is evidence.',
    default: true,
  },
  alumni_directory: {
    label: 'Alumni directory',
    description:
      'ALM-06. Graduates who opt in are visible to other graduates, field by field.',
    consequence:
      'Off hides the directory. Consent choices are kept, so nobody has to opt in a second time.',
    default: true,
  },
} as const;

export type FlagKey = keyof typeof FLAGS;

export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(value: string): value is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAGS, value);
}

/**
 * Resolution order: the institution's override, then the platform row, then
 * the default written beside the flag above.
 *
 * Cached per request, because a page that checks three flags should not make
 * three round trips, and a flag flipping halfway down a render would produce
 * a page that contradicts itself.
 */
const loadState = cache(async () => {
  const [globals, overrides] = await Promise.all([
    db.select().from(featureFlags).where(inArray(featureFlags.key, FLAG_KEYS)),
    db.select().from(featureFlagOverrides).where(inArray(featureFlagOverrides.key, FLAG_KEYS)),
  ]);
  return { globals, overrides };
});

export async function flagEnabled(key: FlagKey, institutionId?: string | null) {
  const { globals, overrides } = await loadState();

  if (institutionId) {
    const override = overrides.find((o) => o.key === key && o.institutionId === institutionId);
    if (override) return override.enabled;
  }

  const platform = globals.find((g) => g.key === key);
  if (platform) return platform.enabled;

  return FLAGS[key].default;
}

/** Every flag's resolved state for one institution — for the console's grid. */
export async function resolveAll(institutionId?: string | null) {
  const entries = await Promise.all(
    FLAG_KEYS.map(async (key) => [key, await flagEnabled(key, institutionId)] as const),
  );
  return Object.fromEntries(entries) as Record<FlagKey, boolean>;
}

/** The raw rows, so SA-03 can show what is set rather than only what resolves. */
export async function flagState() {
  const { globals, overrides } = await loadState();
  return {
    globals: Object.fromEntries(globals.map((g) => [g.key, g.enabled])) as Partial<
      Record<FlagKey, boolean>
    >,
    overrides: overrides.map((o) => ({
      institutionId: o.institutionId,
      key: o.key as FlagKey,
      enabled: o.enabled,
    })),
  };
}

/** Used by the guard helpers below and by the console when clearing a row. */
export async function overrideFor(institutionId: string, key: FlagKey) {
  const [row] = await db
    .select()
    .from(featureFlagOverrides)
    .where(
      and(
        eq(featureFlagOverrides.institutionId, institutionId),
        eq(featureFlagOverrides.key, key),
      ),
    )
    .limit(1);
  return row ?? null;
}
