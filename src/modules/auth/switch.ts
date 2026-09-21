import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { authTokens, memberships } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';

/**
 * AU-10 — moving a signed-in person to another institution's host.
 *
 * Session cookies are host-only, deliberately: a cookie scoped to the parent
 * domain would be readable by every tenant, which is the one leak §7.4 exists
 * to prevent. So a switch is a handoff. The current host mints a single-use
 * token for one named institution, and that institution's host redeems it
 * into a session of its own.
 *
 * Sixty seconds and one use. The token is only ever in a redirect the browser
 * follows immediately, so any longer is exposure for nothing.
 */
export const SWITCH_TTL_SECONDS = 60;

export async function issueSwitch(userId: string, institutionId: string, mfaSatisfied: boolean) {
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId,
    purpose: 'institution_switch',
    tokenHash: sha256(token),
    institutionId,
    mfaSatisfied,
    expiresAt: new Date(Date.now() + SWITCH_TTL_SECONDS * 1000),
  });
  return token;
}

/**
 * Spends the token, or returns null. Conditional on it being unspent, so two
 * requests racing with one token get one session between them.
 *
 * The membership is checked again at redemption, not trusted from issue: a
 * role revoked in the minute between the two still means no.
 */
export async function redeemSwitch(token: string, institutionId: string) {
  const [spent] = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, 'institution_switch'),
        eq(authTokens.institutionId, institutionId),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId, mfaSatisfied: authTokens.mfaSatisfied });
  if (!spent) return null;

  const held = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, spent.userId), eq(memberships.institutionId, institutionId)));
  if (held.length === 0) return null;

  return { ...spent, roles: held.map((h) => h.role) };
}
