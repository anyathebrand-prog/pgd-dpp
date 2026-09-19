/**
 * SA-03 — how a flag resolves.
 *
 * The one rule worth a test of its own: the platform switch turned off is a
 * kill switch, and nothing an institution set can outvote it. It used to
 * check the institution's override first, so "off everywhere" left the
 * feature running at any university set to "on" — while the console told the
 * person in the middle of an incident that it was off for everyone.
 *
 * `flagEnabled` caches per request with React's `cache`, which outside a
 * render does not memoise; each call here reads the database fresh.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminDb } from '@/db';
import { featureFlagOverrides, featureFlags, institutions } from '@/db/schema';
import { flagEnabled } from '@/lib/flags';

let unilagId = '';

async function clear() {
  await adminDb.delete(featureFlagOverrides);
  await adminDb.delete(featureFlags);
}

beforeAll(async () => {
  const [row] = await adminDb
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.slug, 'unilag'));
  unilagId = row.id;
});

beforeEach(clear);
afterAll(clear);

describe('the platform switch is a kill switch', () => {
  it('off everywhere beats an institution set to on', async () => {
    await adminDb.insert(featureFlags).values({ key: 'live_sessions', enabled: false });
    await adminDb
      .insert(featureFlagOverrides)
      .values({ institutionId: unilagId, key: 'live_sessions', enabled: true });

    // The assertion the fix exists for.
    expect(await flagEnabled('live_sessions', unilagId)).toBe(false);
  });

  it('but an institution can still turn off what the platform leaves on', async () => {
    await adminDb.insert(featureFlags).values({ key: 'live_sessions', enabled: true });
    await adminDb
      .insert(featureFlagOverrides)
      .values({ institutionId: unilagId, key: 'live_sessions', enabled: false });

    // Rollout is the ordinary case: one university not being ready must not
    // depend on the platform switch.
    expect(await flagEnabled('live_sessions', unilagId)).toBe(false);
  });

  it('an override applies when the platform has never been touched', async () => {
    await adminDb
      .insert(featureFlagOverrides)
      .values({ institutionId: unilagId, key: 'school_channels', enabled: false });

    expect(await flagEnabled('school_channels', unilagId)).toBe(false);
  });

  it('with nothing set, the default written beside the flag holds', async () => {
    expect(await flagEnabled('offline_payments', unilagId)).toBe(true);
  });
});
