import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, ssoNonces, users } from '@/db/schema';
import { audit } from '@/lib/audit';

/**
 * SSO-02 — Tier 2, the signed handoff.
 *
 * §5.4 flags Tier 1 as the highest-risk assumption in the PRD: most Nigerian
 * university portals are bespoke PHP with no SAML or OIDC endpoint, so
 * federated SSO is something to validate with institutions rather than to
 * assume. Tier 2 is the tier they can actually build — sign a small JSON
 * payload with a shared secret, redirect the student to a URL carrying it,
 * and we mint the session.
 *
 * It is deliberately hand-rolled HS256 rather than a JWT library. The
 * verifier is thirty lines, the attack surface of a general-purpose JWT
 * implementation is mostly algorithms we do not want (`alg: none` and RS/HS
 * confusion being the classics), and this accepts exactly one algorithm and
 * rejects everything else without reading it.
 *
 * The rules, each of which is a real failure mode rather than a formality:
 *
 *   - HS256 only, and the algorithm is checked before the signature.
 *   - 120 seconds of life, with 60 seconds of clock tolerance. §5 names clock
 *     skew between a portal and this platform as the most common real-world
 *     failure, so it is tolerated, and logged when it is used.
 *   - A nonce, spent once. A handoff URL in a browser history is a bearer
 *     credential until it expires.
 *   - No auto-provisioning, ever. A valid token for someone with no account
 *     here is an explicit error, not an invitation to create a student.
 */

export const HANDOFF_TTL_SECONDS = 120;
const CLOCK_TOLERANCE_SECONDS = 60;

export type HandoffResult =
  | { ok: true; userId: string; institutionId: string; skewSeconds: number }
  | {
      ok: false;
      reason: 'malformed' | 'unsupported_algorithm' | 'bad_signature' | 'expired' | 'replayed' | 'unknown_student' | 'not_configured';
      detail: string;
    };

function base64UrlDecode(part: string) {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export async function verifyHandoff(token: string, institutionSlug: string): Promise<HandoffResult> {
  const [inst] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.slug, institutionSlug))
    .limit(1);

  if (!inst?.ssoSharedSecret) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: 'This institution has no portal handoff configured.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed', detail: 'The token is not in three parts.' };
  }

  let header: { alg?: string; typ?: string };
  let payload: { sub?: string; email?: string; institution_id?: string; nonce?: string; exp?: number; iat?: number };
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed', detail: 'The token could not be decoded.' };
  }

  // Checked before anything else is read. `alg: none` and algorithm confusion
  // are only possible where the token gets to choose how it is verified.
  if (header.alg !== 'HS256') {
    return {
      ok: false,
      reason: 'unsupported_algorithm',
      detail: `Tokens must be signed with HS256. This one claims ${header.alg ?? 'nothing'}.`,
    };
  }

  const expected = createHmac('sha256', inst.ssoSharedSecret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  const given = base64UrlDecode(parts[2]);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature', detail: 'The signature does not match.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp ?? 0);
  if (!exp || exp + CLOCK_TOLERANCE_SECONDS < now) {
    return {
      ok: false,
      reason: 'expired',
      detail: 'The link has expired. Start again from your university portal.',
    };
  }
  // A token that claims to live longer than the window is refused whatever its
  // exp says: the short life IS the control, and a portal is not allowed to
  // opt out of it by writing a bigger number.
  const iat = Number(payload.iat ?? exp - HANDOFF_TTL_SECONDS);
  if (exp - iat > HANDOFF_TTL_SECONDS + CLOCK_TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: 'expired',
      detail: `A handoff token may not live longer than ${HANDOFF_TTL_SECONDS} seconds.`,
    };
  }

  const nonce = String(payload.nonce ?? '');
  if (nonce.length < 8) {
    return { ok: false, reason: 'malformed', detail: 'The token carries no usable nonce.' };
  }

  // Housekeeping first: nonces only matter while a token could still be
  // replayed, so the table does not grow without bound.
  await db.delete(ssoNonces).where(lt(ssoNonces.expiresAt, new Date()));

  const spent = await db
    .insert(ssoNonces)
    .values({
      institutionId: inst.id,
      nonce,
      expiresAt: new Date((exp + CLOCK_TOLERANCE_SECONDS) * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: ssoNonces.id });

  if (spent.length === 0) {
    await audit({
      action: 'sso.handoff_replayed',
      institutionId: inst.id,
      actorRole: 'system:sso',
      detail: { nonce },
    });
    return {
      ok: false,
      reason: 'replayed',
      detail: 'This link has already been used. Start again from your university portal.',
    };
  }

  const identifier = String(payload.email ?? payload.sub ?? '').trim().toLowerCase();
  const [user] = identifier
    ? await db.select().from(users).where(eq(users.email, identifier)).limit(1)
    : [];

  if (!user) {
    // §5's edge case, verbatim: never auto-provision. A portal asserting that
    // someone is a student is not the same as this platform having admitted
    // them, and creating an account here would let a portal bug enrol people.
    return {
      ok: false,
      reason: 'unknown_student',
      detail: 'No account here matches that identifier. It has to be created by admission, not by a link.',
    };
  }

  const skewSeconds = Math.max(0, now - exp);
  if (skewSeconds > 0) {
    // Tolerated, but recorded — a portal whose clock is drifting will
    // eventually drift past the tolerance, and this is the warning.
    await audit({
      action: 'sso.handoff_clock_skew',
      institutionId: inst.id,
      subjectId: user.id,
      actorRole: 'system:sso',
      detail: { skewSeconds },
    });
  }

  return { ok: true, userId: user.id, institutionId: inst.id, skewSeconds };
}

/** Used by the integration guide to show a portal team a real, working token. */
export function signHandoff(secret: string, payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${head}.${body}.${signature}`;
}

/** Has this institution turned Tier 2 on at all? */
export async function handoffConfigured(institutionId: string) {
  const [row] = await db
    .select({ secret: institutions.ssoSharedSecret })
    .from(institutions)
    .where(and(eq(institutions.id, institutionId)))
    .limit(1);
  return Boolean(row?.secret);
}
