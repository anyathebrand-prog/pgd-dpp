/**
 * SSO-03 — Tier 1, university sign-in over OpenID Connect, end to end.
 *
 * Against a real, if small, OpenID provider started by this file: discovery,
 * an authorization endpoint, a token endpoint that enforces PKCE and the
 * client secret, and RS256 ID tokens from a published key set. Nothing on
 * the platform side is stubbed; the provider is the university's half.
 */
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PORT = 4655;
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = 'pgd-dpp-unilag';
const CLIENT_SECRET = 'e2e-oidc-secret';
const PASSWORD = 'Passw0rd-seed-2026';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const RUN = Date.now();
const NEW_EMAIL = `e2e-oidc-${RUN}@students.unilag.edu.ng`;

/* ------------------------------------------------------ the university's IdP */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };

type Identity = { sub: string; email: string; email_verified?: boolean; name?: string };
let next: Identity | { deny: true } = { deny: true };
const codes = new Map<string, { redirectUri: string; nonce: string; challenge: string; identity: Identity }>();
let tokenRequests = 0;
let server: Server;

function idToken(identity: Identity, nonce: string) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc({
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: now,
    exp: now + 300,
    nonce,
    email_verified: true,
    ...identity,
  });
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

function startIdp() {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, ISSUER);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [JWK] });

    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      const back = new URL(p.get('redirect_uri')!);
      back.searchParams.set('state', p.get('state') ?? '');
      if ('deny' in next || p.get('client_id') !== CLIENT_ID || p.get('code_challenge_method') !== 'S256') {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = randomBytes(16).toString('hex');
        codes.set(code, {
          redirectUri: p.get('redirect_uri')!,
          nonce: p.get('nonce')!,
          challenge: p.get('code_challenge')!,
          identity: next,
        });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      tokenRequests += 1;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const f = new URLSearchParams(raw);
      const grant = codes.get(f.get('code') ?? '');
      codes.delete(f.get('code') ?? '');
      const pkce = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (
        !grant ||
        f.get('client_id') !== CLIENT_ID ||
        f.get('client_secret') !== CLIENT_SECRET ||
        f.get('redirect_uri') !== grant.redirectUri ||
        pkce !== grant.challenge
      ) {
        return json(400, { error: 'invalid_grant' });
      }
      return json(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken(grant.identity, grant.nonce) });
    }

    res.writeHead(404);
    res.end();
  });
  return new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
}

/* --------------------------------------------------------------- the platform */

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function viaUniversity(page: Page, identity: Identity | { deny: true }) {
  next = identity;
  await page.goto('/login');
  await page.getByRole('link', { name: /Sign in with your UNILAG account/ }).click();
}

test.beforeAll(async () => {
  await startIdp();
  const db = sql();
  await db`
    UPDATE institutions SET oidc_issuer = ${ISSUER}, oidc_client_id = ${CLIENT_ID},
      oidc_client_secret = ${CLIENT_SECRET}, oidc_email_domains = ${['unilag.edu.ng', 'unilag.example.ng']}
    WHERE slug = 'unilag'`;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM sso_identities WHERE issuer = ${ISSUER}`;
  await db`DELETE FROM users WHERE email LIKE 'e2e-oidc-%'`;
  await db`
    UPDATE institutions SET oidc_issuer = NULL, oidc_client_id = NULL, oidc_client_secret = NULL,
      oidc_email_domains = '{}' WHERE slug = 'unilag'`;
  await db.end();
  await new Promise((r) => server.close(r));
});

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('SSO-03 Tier 1', () => {
  test('a first sign-in provisions an applicant, not a student', async ({ page }) => {
    await viaUniversity(page, { sub: `sub-${RUN}`, email: NEW_EMAIL, name: 'Ada Okafor' });
    await page.waitForURL(/unilag\.localhost:3000\/apply/, { timeout: 30_000 });

    const db = sql();
    const [u] = await db`SELECT id, status, email_verified_at, password_hash FROM users WHERE email = ${NEW_EMAIL}`;
    const roles = await db`SELECT role FROM memberships WHERE user_id = ${u.id}`;
    const enrolled = await db`SELECT 1 FROM enrollments WHERE user_id = ${u.id}`;
    await db.end();
    expect(u.status).toBe('candidate');
    expect(u.email_verified_at).not.toBeNull();
    expect(u.password_hash).toBeNull();
    expect(roles.map((r) => r.role)).toEqual(['candidate']);
    expect(enrolled).toHaveLength(0);
  });

  test('the subject decides after that, even if the address changes', async ({ page }) => {
    await viaUniversity(page, { sub: `sub-${RUN}`, email: `renamed-${RUN}@unilag.edu.ng` });
    await page.waitForURL(/\/apply/, { timeout: 30_000 });

    const db = sql();
    const users = await db`SELECT id FROM users WHERE email IN (${NEW_EMAIL}, ${`renamed-${RUN}@unilag.edu.ng`})`;
    await db.end();
    expect(users).toHaveLength(1);
  });

  test('an existing student is signed in to their own account', async ({ page }) => {
    await viaUniversity(page, { sub: `student-${RUN}`, email: 'student@unilag.example.ng' });
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const db = sql();
    const [link] = await db`
      SELECT u.email FROM sso_identities s JOIN users u ON u.id = s.user_id
      WHERE s.issuer = ${ISSUER} AND s.subject = ${`student-${RUN}`}`;
    await db.end();
    expect(link.email).toBe('student@unilag.example.ng');
  });

  test('staff are refused, and pointed at their password', async ({ page }) => {
    await viaUniversity(page, { sub: `staff-${RUN}`, email: 'registry@unilag.example.ng' });
    await expect(page.getByRole('heading', { name: 'Staff sign in with their password' })).toBeVisible({
      timeout: 30_000,
    });
    expect((await page.context().cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
  });

  test('an address outside the university is refused', async ({ page }) => {
    await viaUniversity(page, { sub: `foreign-${RUN}`, email: `e2e-oidc-${RUN}@gmail.com` });
    await expect(page.getByRole('heading', { name: /is not this university’s/ })).toBeVisible({ timeout: 30_000 });
  });

  test('an unverified address is refused', async ({ page }) => {
    await viaUniversity(page, { sub: `unverified-${RUN}`, email: `e2e-oidc-u-${RUN}@unilag.edu.ng`, email_verified: false });
    await expect(page.getByRole('heading', { name: /has not verified your address/ })).toBeVisible({ timeout: 30_000 });
  });

  test('a cancelled sign-in comes back with a way forward', async ({ page }) => {
    await viaUniversity(page, { deny: true });
    await expect(page.getByRole('heading', { name: 'Your university did not sign you in' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: 'Log in instead' })).toBeVisible();
  });

  test('a callback this browser did not start is refused before the code is spent', async ({ page }) => {
    const before = tokenRequests;
    await page.goto('/sso/oidc/callback?code=stolen&state=guessed');
    await expect(page.getByRole('heading', { name: 'That sign-in had gone stale' })).toBeVisible({ timeout: 30_000 });
    expect(tokenRequests).toBe(before);
  });

  test('the platform team configures it, and a bad issuer is caught before saving', async ({ browser, baseURL }) => {
    const db = sql();
    await db`UPDATE users SET totp_secret = ${TOTP_SECRET}, totp_confirmed_at = now() WHERE email = 'platform@example.ng'`;
    await db.end();

    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill('platform@example.ng');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
    await page.locator('#code').fill(totp(TOTP_SECRET));
    await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
    await page.waitForURL(/\/platform/, { timeout: 30_000 });

    await page.goto('/platform/sso');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: 'University of Lagos' }).first();
    await expect(card).toContainText('University sign-in on');
    await expect(card).toContainText('http://unilag.localhost:3000/sso/oidc/callback');
    // The secret is never rendered back.
    expect(await card.locator('input[name="clientSecret"]').inputValue()).toBe('');

    await card.locator('input[name="issuer"]').fill('http://127.0.0.1:4656');
    await card.getByRole('button', { name: 'Check and save' }).click();
    await expect(card.getByText(/did not answer as an OpenID provider/)).toBeVisible({ timeout: 30_000 });

    await card.locator('input[name="issuer"]').fill(ISSUER);
    await card.locator('input[name="domains"]').fill('unilag.edu.ng, gmail.com');
    await card.getByRole('button', { name: 'Check and save' }).click();
    await expect(card.getByText(/gmail\.com belongs to everyone/)).toBeVisible({ timeout: 30_000 });

    await card.locator('input[name="domains"]').fill('unilag.edu.ng, unilag.example.ng');
    await card.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText('Saved and checked')).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });
});

function totp(secret: string) {
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const d = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = d[d.length - 1] & 0x0f;
  const bin = ((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
