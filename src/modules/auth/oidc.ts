import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, memberships, ssoIdentities, users } from '@/db/schema';
import { audit } from '@/lib/audit';
import { emailInDomains, provisionFor, verifyIdToken, type IdClaims } from './oidc-verify';

/**
 * SSO-03 — Tier 1, OpenID Connect relying party.
 *
 * Authorization code flow with PKCE and a nonce, one confidential client per
 * institution. The same code serves a university's own OIDC provider,
 * Microsoft 365 or Google Workspace for Education, and BoxyHQ Jackson in
 * front of a SAML IdP (§7): to this side, all four are an issuer URL, a
 * client id and a secret.
 *
 * The verification rules live in `oidc-verify.ts` and are tested there.
 */

type Institution = typeof institutions.$inferSelect;

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  emailDomains: string[];
};

export function oidcConfig(inst: Institution): OidcConfig | null {
  if (!inst.oidcIssuer || !inst.oidcClientId || !inst.oidcClientSecret) return null;
  return {
    issuer: inst.oidcIssuer.replace(/\/+$/, ''),
    clientId: inst.oidcClientId,
    clientSecret: inst.oidcClientSecret,
    emailDomains: inst.oidcEmailDomains ?? [],
  };
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

/*
 * Discovery documents and key sets change rarely and are fetched on every
 * sign-in otherwise. Ten minutes, and a key-set miss refetches once, so a
 * provider rotating its signing key does not lock everyone out until expiry.
 */
const TTL_MS = 10 * 60_000;
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; jwks: { keys: [] } }>();

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.doc;
  const doc = (await fetchJson(`${issuer}/.well-known/openid-configuration`)) as Discovery;
  // OIDC Discovery 4.3: the document must name the issuer we asked about,
  // or a compromised discovery endpoint could vouch for someone else's keys.
  if (doc.issuer?.replace(/\/+$/, '') !== issuer) throw new Error('Discovery names a different issuer');
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

async function keys(jwksUri: string, refresh = false) {
  const hit = jwksCache.get(jwksUri);
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.jwks;
  const jwks = await fetchJson(jwksUri);
  jwksCache.set(jwksUri, { at: Date.now(), jwks });
  return jwks;
}

export async function authorizeUrl(
  cfg: OidcConfig,
  opts: { redirectUri: string; state: string; nonce: string; challenge: string },
) {
  const doc = await discover(cfg.issuer);
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    scope: 'openid email profile',
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export type OidcFailure =
  | 'oidc_exchange'
  | 'oidc_token'
  | 'unverified_email'
  | 'foreign_domain'
  | 'staff_account'
  | 'suspended';

/** Code for tokens, then the ID token checked against the provider's keys. */
export async function exchange(
  cfg: OidcConfig,
  opts: { code: string; redirectUri: string; verifier: string; nonce: string },
): Promise<{ ok: true; claims: IdClaims } | { ok: false; reason: OidcFailure; detail: string }> {
  const doc = await discover(cfg.issuer);

  let idToken: string;
  try {
    const body = await fetchJson(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: opts.code,
        redirect_uri: opts.redirectUri,
        code_verifier: opts.verifier,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    });
    idToken = String(body.id_token ?? '');
    if (!idToken) throw new Error('No id_token in the response');
  } catch (err) {
    return { ok: false, reason: 'oidc_exchange', detail: (err as Error).message };
  }

  const check = async (refresh: boolean) =>
    verifyIdToken(idToken, {
      jwks: await keys(doc.jwks_uri, refresh),
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      nonce: opts.nonce,
    });
  let result = await check(false);
  if (!result.ok && result.reason === 'no matching signing key') result = await check(true);
  if (!result.ok) return { ok: false, reason: 'oidc_token', detail: result.reason };
  return { ok: true, claims: result.claims };
}

/**
 * The verified identity, as an account (§5.4, just-in-time provisioning).
 * The subject decides once it has been seen; the address links it the
 * first time.
 */
export async function accountFor(
  inst: Institution,
  cfg: OidcConfig,
  claims: IdClaims,
): Promise<{ ok: true; userId: string; roles: string[] } | { ok: false; reason: OidcFailure }> {
  const email = String(claims.email ?? '').trim().toLowerCase();
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

  const [linked] = await db
    .select({ userId: ssoIdentities.userId })
    .from(ssoIdentities)
    .where(and(eq(ssoIdentities.issuer, cfg.issuer), eq(ssoIdentities.subject, claims.sub)))
    .limit(1);

  const [user] = linked
    ? await db.select().from(users).where(eq(users.id, linked.userId)).limit(1)
    : email
      ? await db.select().from(users).where(eq(users.email, email)).limit(1)
      : [];

  const held = user
    ? await db
        .select({ institutionId: memberships.institutionId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, user.id))
    : [];

  const decision = provisionFor({
    // A subject already linked has proved its address once; a provider that
    // stops sending the claim later does not lock its students out.
    emailVerified: Boolean(linked) || emailVerified,
    emailAllowed: Boolean(linked) || emailInDomains(email, cfg.emailDomains),
    user: user ?? null,
    held,
    institutionId: inst.id,
  });

  if (decision.kind === 'refuse') {
    await audit({
      action: 'sso.oidc_refused',
      institutionId: inst.id,
      subjectId: user?.id ?? null,
      actorRole: 'system:sso',
      detail: { reason: decision.reason, domain: email.split('@')[1] ?? null },
    });
    return { ok: false, reason: decision.reason };
  }

  let userId = user?.id;
  if (decision.kind === 'create') {
    const [created] = await db
      .insert(users)
      .values({
        email,
        fullName: claims.name?.slice(0, 200) ?? null,
        // The provider verified the address, which is what AU-02 exists to do.
        emailVerifiedAt: new Date(),
        status: 'candidate',
      })
      .returning({ id: users.id });
    userId = created.id;
  }
  if (decision.kind === 'create' || decision.kind === 'add_candidate') {
    await db
      .insert(memberships)
      .values({ userId: userId!, institutionId: inst.id, role: 'candidate' })
      .onConflictDoNothing();
  }

  await db
    .insert(ssoIdentities)
    .values({ userId: userId!, institutionId: inst.id, issuer: cfg.issuer, subject: claims.sub })
    .onConflictDoUpdate({
      target: [ssoIdentities.issuer, ssoIdentities.subject],
      set: { lastSeenAt: new Date() },
    });

  await audit({
    action: decision.kind === 'sign_in' ? 'sso.oidc_sign_in' : 'sso.oidc_provisioned',
    institutionId: inst.id,
    actorId: userId!,
    subjectId: userId!,
    actorRole: 'system:sso',
    detail: { outcome: decision.kind },
  });

  const rolesHere = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId!), eq(memberships.institutionId, inst.id)));
  return { ok: true, userId: userId!, roles: rolesHere.map((r) => r.role) };
}
