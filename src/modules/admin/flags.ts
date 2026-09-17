'use server';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { featureFlagOverrides, featureFlags, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { FLAGS, isFlagKey } from '@/lib/flags';
import type { FormState } from '../auth/actions';

/**
 * SA-03 feature flags (§5.9).
 *
 * A flag flip is a deploy without a commit: it changes what the product does
 * for real people, immediately, with no review and no diff. So every change
 * here is audited with who made it and what it was before — that log is the
 * only record such a change ever leaves.
 */

/** The platform-wide switch. Off here means off everywhere, overrides and all. */
export async function setPlatformFlag(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');

  const key = String(form.get('key') ?? '');
  const enabled = form.get('enabled') === 'true';

  if (!isFlagKey(key)) {
    // A flag the code has never heard of is a typo, not a feature.
    return { error: 'That is not a flag this product has.' };
  }

  const [existing] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  const before = existing?.enabled ?? FLAGS[key].default;

  if (existing) {
    await db
      .update(featureFlags)
      .set({ enabled, changedBy: me.userId, updatedAt: new Date() })
      .where(eq(featureFlags.key, key));
  } else {
    await db.insert(featureFlags).values({ key, enabled, changedBy: me.userId });
  }

  await audit({
    action: enabled ? 'flag.enabled' : 'flag.disabled',
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'feature_flags',
    entityId: key,
    detail: { scope: 'platform', flag: key, from: before, to: enabled },
  });

  return { redirectTo: `/platform/flags?changed=${encodeURIComponent(FLAGS[key].label)}` };
}

/**
 * One institution's override. Rollout is the ordinary case: a university that
 * has not agreed to run alumni channels should not get them because another
 * university was ready.
 */
export async function setInstitutionFlag(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');

  const key = String(form.get('key') ?? '');
  const institutionId = String(form.get('institutionId') ?? '');
  const value = String(form.get('value') ?? '');

  if (!isFlagKey(key)) return { error: 'That is not a flag this product has.' };
  if (!['on', 'off', 'inherit'].includes(value)) return { error: 'Unknown setting.' };

  const [institution] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1);
  if (!institution) return { error: 'That institution does not exist.' };

  const where = and(
    eq(featureFlagOverrides.institutionId, institutionId),
    eq(featureFlagOverrides.key, key),
  );
  const [existing] = await db.select().from(featureFlagOverrides).where(where).limit(1);

  if (value === 'inherit') {
    /*
     * Deleting the row rather than storing "inherit" as a third state.
     *
     * An override that says "whatever the platform says" is the absence of an
     * override, and keeping it as a row means every later reader has to know
     * that a row can mean nothing.
     */
    if (existing) await db.delete(featureFlagOverrides).where(where);
  } else {
    const enabled = value === 'on';
    if (existing) {
      await db
        .update(featureFlagOverrides)
        .set({ enabled, changedBy: me.userId, updatedAt: new Date() })
        .where(where);
    } else {
      await db
        .insert(featureFlagOverrides)
        .values({ institutionId, key, enabled, changedBy: me.userId });
    }
  }

  await audit({
    action: 'flag.override_set',
    institutionId,
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'feature_flag_overrides',
    entityId: key,
    detail: {
      flag: key,
      institution: institution.shortName,
      from: existing ? (existing.enabled ? 'on' : 'off') : 'inherit',
      to: value,
    },
  });

  return {
    redirectTo: `/platform/flags?changed=${encodeURIComponent(
      `${FLAGS[key].label} at ${institution.shortName}`,
    )}`,
  };
}
