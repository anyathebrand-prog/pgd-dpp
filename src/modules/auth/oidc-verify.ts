import { createHash, createPublicKey, verify, type JsonWebKey } from 'node:crypto';

/**
 * SSO-03 — Tier 1, the parts that decide whether to believe an identity
 * provider. Pure, so every refusal can be tested without an IdP.
 *
 * Hand-rolled on node:crypto for the same reason Tier 2 is: a general JWT
 * library's attack surface is mostly algorithms we will never accept. This
 * accepts RS256 and ES256, the two that OIDC providers actually sign ID
 * tokens with (Entra ID, Google, and BoxyHQ Jackson, which §7 names as the
 * SAML-to-OIDC bridge), and refuses everything else before reading further.
 * `none` and HS256 are the classic ways a token picks its own verifier.
 */

export const OIDC_CLOCK_TOLERANCE_SECONDS = 60;
const ALGS = { RS256: 'RSA', ES256: 'EC' } as const;

export type IdClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};

export type VerifyResult =
  | { ok: true; claims: IdClaims }
  | { ok: false; reason: string };

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function verifyIdToken(
  token: string,
  opts: {
    jwks: { keys: (JsonWebKey & { kid?: string; use?: string })[] };
    issuer: string;
    clientId: string;
    nonce: string;
    now?: number;
  },
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not three parts' };

  let header: { alg?: string; kid?: string };
  let claims: IdClaims;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    claims = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'undecodable' };
  }

  const alg = header.alg as keyof typeof ALGS | undefined;
  if (!alg || !(alg in ALGS)) return { ok: false, reason: `algorithm ${header.alg ?? 'none'} refused` };

  // The key must be of the type the algorithm needs: an RSA key presented
  // for ES256 is refused, not coerced.
  const candidates = opts.jwks.keys.filter(
    (k) => k.kty === ALGS[alg] && (k.use === undefined || k.use === 'sig'),
  );
  const jwk = header.kid
    ? candidates.find((k) => k.kid === header.kid)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!jwk) return { ok: false, reason: 'no matching signing key' };

  let valid = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    valid =
      alg === 'RS256'
        ? verify('sha256', data, key, b64url(parts[2]))
        : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, b64url(parts[2]));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad signature' };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tol = OIDC_CLOCK_TOLERANCE_SECONDS;
  if (claims.iss !== opts.issuer) return { ok: false, reason: 'wrong issuer' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) return { ok: false, reason: 'not addressed to us' };
  // OIDC Core 3.1.3.7: with several audiences, the authorised party must be us.
  if (aud.length > 1 && claims.azp !== opts.clientId) return { ok: false, reason: 'wrong authorised party' };
  if (typeof claims.exp !== 'number' || claims.exp + tol < now) return { ok: false, reason: 'expired' };
  if (typeof claims.iat !== 'number' || claims.iat - tol > now) return { ok: false, reason: 'issued in the future' };
  if (!claims.nonce || claims.nonce !== opts.nonce) return { ok: false, reason: 'nonce mismatch' };
  if (!claims.sub) return { ok: false, reason: 'no subject' };

  return { ok: true, claims };
}

/** RFC 7636 S256. */
export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * An identity provider speaks for its own university's addresses and no one
 * else's. `ada@unilag.edu.ng` and `ada@students.unilag.edu.ng` are both
 * UNILAG's to vouch for; `ada@gmail.com` is not, and neither is
 * `ada@notunilag.edu.ng`.
 */
export function emailInDomains(email: string, domains: string[]) {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const host = email.slice(at + 1).toLowerCase();
  return domains.some((d) => {
    const domain = d.trim().toLowerCase().replace(/^@/, '');
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}

const VOUCHABLE = ['candidate', 'student', 'alumni'];

export type Provision =
  | { kind: 'refuse'; reason: 'unverified_email' | 'foreign_domain' | 'staff_account' | 'suspended' }
  | { kind: 'sign_in' }
  | { kind: 'add_candidate' }
  | { kind: 'create' };

/**
 * What to do with a verified identity (§5.4: just-in-time provisioning).
 *
 * Provisioning here means an account and an applicant's place, never an
 * enrolment: the IdP says who someone is, not that this platform admitted
 * them. Staff accounts are refused outright, as in Tier 2. They sign in with
 * their own password and second factor, and an IdP's word is not a
 * substitute for either.
 */
export function provisionFor(opts: {
  emailVerified: boolean;
  emailAllowed: boolean;
  user: { status: string } | null;
  held: { institutionId: string; role: string }[];
  institutionId: string;
}): Provision {
  if (!opts.emailVerified) return { kind: 'refuse', reason: 'unverified_email' };
  if (!opts.emailAllowed) return { kind: 'refuse', reason: 'foreign_domain' };
  if (!opts.user) return { kind: 'create' };
  if (opts.user.status === 'suspended') return { kind: 'refuse', reason: 'suspended' };
  if (opts.held.some((m) => !VOUCHABLE.includes(m.role))) return { kind: 'refuse', reason: 'staff_account' };
  if (opts.held.some((m) => m.institutionId === opts.institutionId)) return { kind: 'sign_in' };
  return { kind: 'add_candidate' };
}
