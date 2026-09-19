/**
 * SSO-02 / PB-08 — the Tier 2 signed handoff.
 *
 * §5.4 calls Tier 1 the highest-risk assumption in the PRD, because most
 * Nigerian university portals have no SAML or OIDC endpoint. Tier 2 is what
 * those portals can actually build, which makes it the tier most likely to be
 * used — and the one where getting the security details wrong matters most.
 *
 * So the happy path is one test and the refusals are five, each of them a
 * thing that really happens between a portal and a platform: an expired link,
 * a reused link, a forged signature, an algorithm downgrade, and a token for
 * someone who has no account here.
 */
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const SECRET = 'seed-unilag-sso-secret-do-not-use-in-production';
const STUDENT = 'student@unilag.example.ng';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** What a university portal would emit. */
function handoff(
  overrides: {
    email?: string;
    nonce?: string;
    exp?: number;
    iat?: number;
    alg?: string;
    secret?: string;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: overrides.alg ?? 'HS256', typ: 'JWT' });
  const payload = b64({
    email: overrides.email ?? STUDENT,
    nonce: overrides.nonce ?? `n-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 120,
  });
  const signature = createHmac('sha256', overrides.secret ?? SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

test.describe.configure({ mode: 'serial' });

test.describe('a student is handed over from their university portal', () => {
  test('a valid token signs them in and lands them on the dashboard', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();

    await page.goto(`/sso/handoff?token=${handoff()}`);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    // A session, not a rendered page that says "signed in".
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(true);
    await context.close();
  });

  test('the same link a second time is refused', async ({ browser, baseURL }) => {
    const token = handoff();

    const first = await browser.newContext({ baseURL, storageState: undefined });
    await (await first.newPage()).goto(`/sso/handoff?token=${token}`);
    await first.close();

    // A handoff URL sits in a browser history and a proxy log. Inside its
    // 120-second life it is a bearer credential, so it is spent exactly once.
    const second = await browser.newContext({ baseURL, storageState: undefined });
    const page = await second.newPage();
    await page.goto(`/sso/handoff?token=${token}`);
    await expect(page.getByRole('heading', { name: 'This link has already been used' })).toBeVisible();
    expect((await second.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
    await second.close();
  });

  test('an expired token is refused, with a way forward', async ({ browser, baseURL }) => {
    const now = Math.floor(Date.now() / 1000);
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();

    await page.goto(`/sso/handoff?token=${handoff({ iat: now - 600, exp: now - 400 })}`);
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    // Never a dead end: the student can always sign in normally.
    await expect(page.getByRole('link', { name: 'Log in instead' })).toBeVisible();
    await context.close();
  });

  test('a token signed with the wrong secret is refused', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();

    await page.goto(`/sso/handoff?token=${handoff({ secret: 'not-the-shared-secret' })}`);
    await expect(
      page.getByRole('heading', { name: 'This link could not be verified' }),
    ).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
    await context.close();
  });

  test('an algorithm downgrade is refused before the signature is even read', async ({
    browser,
    baseURL,
  }) => {
    // The classic JWT attack: claim `none`, send no signature, hope the
    // verifier believes the token about how to check the token.
    const header = b64({ alg: 'none', typ: 'JWT' });
    const payload = b64({
      email: STUDENT,
      nonce: `downgrade-${Date.now()}`,
      exp: Math.floor(Date.now() / 1000) + 120,
    });

    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto(`/sso/handoff?token=${header}.${payload}.`);
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
    await context.close();
  });

  test('a valid token for a stranger never creates an account', async ({ browser, baseURL }) => {
    const email = `portal-ghost-${Date.now()}@example.ng`;

    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto(`/sso/handoff?token=${handoff({ email })}`);

    await expect(page.getByRole('heading', { name: 'No account matches this link' })).toBeVisible();
    // §5's edge case: a portal asserting someone is a student is not the same
    // as this institution having admitted them.
    const db = sql();
    const [row] = await db`SELECT count(*)::int AS n FROM users WHERE email = ${email}`;
    await db.end();
    expect(row.n).toBe(0);
    await context.close();
  });

  test('an institution with no handoff configured refuses every token', async ({
    browser,
    baseURL,
  }) => {
    // UNN has no secret. A token that is valid for UNILAG must not be valid
    // there, and "not configured" must not degrade into "accepted".
    const context = await browser.newContext({
      baseURL: baseURL?.replace('//unilag.', '//unn.'),
      storageState: undefined,
    });
    const page = await context.newPage();
    await page.goto(`/sso/handoff?token=${handoff()}`);
    await expect(
      page.getByRole('heading', { name: 'This university has no portal handoff' }),
    ).toBeVisible();
    await context.close();
  });
});
