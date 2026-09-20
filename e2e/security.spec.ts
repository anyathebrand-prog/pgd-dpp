/**
 * Findings from the September 2026 review of the whole branch, each one a way
 * into an account, a console, or a decision that should have been closed.
 *
 * Every test here drives the real sign-in and request paths, and is written
 * to fail against the code as it stood before the fix — a security test that
 * passes against the hole it describes is decoration.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();
const UNILAG_SSO_SECRET = 'seed-unilag-sso-secret-do-not-use-in-production';

const FRESH = `fresh${String(RUN).slice(-6)}`;
const INVITEE = `invitee-${RUN}@example.ng`;

let unilagId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

function totpFor(secret: string) {
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[o] & 0x7f) << 24) | (digest[o + 1] << 16) | (digest[o + 2] << 8) | digest[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A Tier 2 handoff token, signed as the UNILAG portal would sign it. */
function handoffFor(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ email, iat: now, exp: now + 60, nonce: `sec-${RUN}-${Math.random()}` });
  const signature = createHmac('sha256', UNILAG_SSO_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function passwordOnly(
  browser: import('@playwright/test').Browser,
  origin: string,
  email: string,
) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  return { context, page };
}

test.beforeAll(async () => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ${INVITEE})`;
  await db`DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ${INVITEE})`;
  await db`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${INVITEE})`;
  await db`DELETE FROM users WHERE email = ${INVITEE}`;
  await db`DELETE FROM programmes WHERE institution_id IN (SELECT id FROM institutions WHERE slug = ${FRESH})`;
  await db`DELETE FROM institutions WHERE slug = ${FRESH}`;
  await db`DELETE FROM feature_flag_overrides`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('#1 — the second factor cannot be read off the setup page', () => {
  test('a password-only session is sent to the challenge, and never sees the secret', async ({
    browser,
    baseURL,
  }) => {
    // A staff account with a confirmed authenticator, whose secret we know.
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const db = sql();
    await db`
      UPDATE users SET totp_secret = ${secret}, totp_confirmed_at = now()
      WHERE email = 'registry@unilag.example.ng'`;
    await db.end();

    const { context, page } = await passwordOnly(browser, baseURL!, 'registry@unilag.example.ng');
    await page.goto('/security/2fa/setup');

    // It used to render the confirmed secret here, to a session that had
    // cleared nothing but the password.
    await expect(page).toHaveURL(/\/login\/2fa/);
    expect(await page.content()).not.toContain(secret);
    await context.close();
  });
});

test.describe('#2 — signing up with someone else’s address gets you nothing', () => {
  test('an invited account that has not activated is not handed over', async ({
    browser,
    baseURL,
  }) => {
    // What IA-05 and SA-01 create: an account with a staff role, no password
    // yet, and an unverified email — waiting on its activation link.
    const db = sql();
    const [invitee] = await db`
      INSERT INTO users (email, full_name, status) VALUES (${INVITEE}, 'Invited Registrar', 'staff')
      RETURNING id`;
    await db`
      INSERT INTO memberships (user_id, institution_id, role)
      VALUES (${invitee.id}, ${unilagId}, 'registry')`;
    await db.end();

    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${baseURL}/signup`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/Full name/).fill('Somebody Else');
    await page.getByLabel(/Email address/).fill(INVITEE);
    await page.getByLabel(/^Password/).fill('An0ther-passw0rd-entirely');
    await page.getByRole('button', { name: /Create account|Sign up|Continue/ }).click();
    await page.waitForLoadState('networkidle');

    // No session for the invitee's account...
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === 'pgd_session')).toBe(false);

    // ...and no candidate role written onto somebody else's account.
    const check = sql();
    const roles = await check`
      SELECT role FROM memberships WHERE user_id = ${invitee.id}`;
    const [sessionCount] = await check`
      SELECT count(*)::int AS n FROM sessions WHERE user_id = ${invitee.id}`;
    await check.end();
    expect(roles.map((r) => r.role)).toEqual(['registry']);
    expect(sessionCount.n).toBe(0);
    await context.close();
  });
});

test.describe('#3 — the second factor follows the person, not the host', () => {
  test('a super admin at a tenant where they hold no role still owes a code', async ({
    browser,
    baseURL,
  }) => {
    // SA-01 provisions tenants without a super_admin membership, which is
    // exactly where the login used to decide "no second factor needed".
    const db = sql();
    await db`
      INSERT INTO institutions (slug, name, short_name, status)
      VALUES (${FRESH}, 'Freshly Provisioned University', 'FPU', 'live')`;
    await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'platform@example.ng'`;
    await db.end();

    // The port comes from the config, not from a guess: this suite also runs
    // against a production build on another port.
    const origin = `http://${FRESH}.localhost:${new URL(baseURL!).port}`;
    const { context, page } = await passwordOnly(browser, origin, 'platform@example.ng');

    await page.goto(`${origin}/platform/tenants`);
    // Sent to enrol a factor, not into the console.
    await expect(page).toHaveURL(/\/security\/2fa\/setup|\/login\/2fa/);
    await expect(page.getByRole('heading', { level: 1, name: 'Institutions' })).toHaveCount(0);

    const check = sql();
    const [session] = await check`
      SELECT s.mfa_satisfied FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE u.email = 'platform@example.ng' ORDER BY s.created_at DESC LIMIT 1`;
    await check.end();
    expect(session.mfa_satisfied).toBe(false);
    await context.close();
  });
});

test.describe('#4 — a university portal can only vouch for its own students', () => {
  test('a validly signed token for staff is refused', async ({ browser, baseURL }) => {
    // Signed with UNILAG's real secret, naming a curator: a platform role
    // with no second factor. It used to sign them straight in.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${baseURL}/sso/handoff?token=${handoffFor('curator@example.ng')}`);

    await expect(page).toHaveURL(/\/sso\/handoff\/failed/);
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
    await context.close();
  });

  test('a validly signed token for another university’s student is refused', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${baseURL}/sso/handoff?token=${handoffFor('student@unn.example.ng')}`);

    await expect(page).toHaveURL(/\/sso\/handoff\/failed/);
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);
    await context.close();
  });

  test('and its own student still gets in', async ({ browser, baseURL }) => {
    // Without this the two refusals above could pass by breaking SSO outright.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${baseURL}/sso/handoff?token=${handoffFor('student@unilag.example.ng')}`);

    await expect(page).not.toHaveURL(/\/sso\/handoff\/failed/);
    expect((await context.cookies()).some((c) => c.name === 'pgd_session')).toBe(true);
    await context.close();
  });
});

test.describe('#5 — the handoff is not an open redirect', () => {
  test('a backslash path does not leave the site', async ({ browser, baseURL }) => {
    const { context } = await passwordOnly(browser, baseURL!, 'student@unilag.example.ng');

    // `/\evil.com` passed the old string check, and the URL parser reads a
    // backslash as a slash — so the redirect went to evil.com.
    //
    // Sent to the loopback address with the tenant's Host header: this API
    // resolves names through Node, which does not map *.localhost the way the
    // browser does. The session cookie goes along by hand for the same reason.
    const host = new URL(baseURL!).host;
    const cookie = (await context.cookies())
      .filter((c) => c.name === 'pgd_session')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const res = await context.request.get(
      `http://127.0.0.1:${new URL(baseURL!).port}/sso/handoff?next=${encodeURIComponent('/\\evil.example')}`,
      { maxRedirects: 0, headers: { host, cookie } },
    );
    const location = res.headers()['location'] ?? '';
    expect(location).not.toBe('');
    expect(location).not.toContain('evil.example');
    expect(new URL(location, baseURL).host).toBe(host);
    await context.close();
  });
});

test.describe('#9 — a flag closes the action, not just the page', () => {
  test('a form left open before the flag was switched off is refused', async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await passwordOnly(browser, baseURL!, 'facilitator@unilag.example.ng');
    await page.goto('/teach/sessions');
    await page.waitForLoadState('networkidle');

    // The page rendered while the feature was on. Now it goes off.
    const db = sql();
    await db`
      INSERT INTO feature_flag_overrides (institution_id, key, enabled)
      VALUES (${unilagId}, 'live_sessions', false)`;
    await db.end();

    await page.getByLabel('Title (required)').fill(`Should not schedule ${RUN}`);
    await page.getByLabel(/Join link/).fill('https://meet.example.com/closed');
    await page.locator('#session-new-starts').fill('2027-01-01T10:00');
    await page.getByRole('button', { name: 'Schedule it' }).click();

    await expect(page.getByText(/switched off/)).toBeVisible({ timeout: 30_000 });

    const check = sql();
    const [row] = await check`
      SELECT count(*)::int AS n FROM live_sessions WHERE title = ${`Should not schedule ${RUN}`}`;
    await check`DELETE FROM feature_flag_overrides WHERE institution_id = ${unilagId}`;
    await check.end();
    expect(row.n).toBe(0);
    await context.close();
  });
});

test.describe('#10 — a decision needs an application that is waiting for one', () => {
  test('a stale tab cannot reject a student who has since enrolled', async ({ browser, baseURL }) => {
    // Its own application, submitted and waiting, rather than whatever the
    // seed happens to hold — a skipped security test proves nothing.
    const db = sql();
    const [cohort] = await db`SELECT id FROM cohorts WHERE institution_id = ${unilagId} LIMIT 1`;
    const [candidate] = await db`
      INSERT INTO users (email, full_name, status, email_verified_at)
      VALUES (${`sec-candidate-${RUN}@example.ng`}, 'Stale Tab Candidate', 'candidate', now())
      RETURNING id`;
    const [app] = await db`
      INSERT INTO applications (institution_id, cohort_id, user_id, reference, status, submitted_at)
      VALUES (${unilagId}, ${cohort.id}, ${candidate.id}, ${`SEC-${RUN}`}, 'submitted', now())
      RETURNING id, status`;
    const secret = 'KRUGS4ZANFZSAYJAORSXG5A2KRUGS4ZA';
    await db`
      UPDATE users SET totp_secret = ${secret}, totp_confirmed_at = now()
      WHERE email = 'registry@unilag.example.ng'`;
    await db.end();

    const { context, page } = await passwordOnly(browser, baseURL!, 'registry@unilag.example.ng');
    await page.goto('/login/2fa');
    await page.locator('#code').fill(totpFor(secret));
    await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
    await page.waitForURL(/\/admin/, { timeout: 30_000 });

    await page.goto(`/admin/applications/${app.id}`);
    await page.waitForLoadState('networkidle');

    // Opened while it was waiting; since then it has moved on.
    const move = sql();
    await move`UPDATE applications SET status = 'enrolled' WHERE id = ${app.id}`;
    await move.end();

    await page.locator('#decision').selectOption('rejected');
    await page.locator('#decision-note').fill('Stale decision from a tab left open overnight.');
    await page.getByRole('button', { name: 'Review this decision' }).click();
    await page.getByRole('button', { name: 'Reject this application' }).click();

    await expect(page.getByText(/not waiting for a decision/)).toBeVisible({ timeout: 30_000 });

    const check = sql();
    const [after] = await check`SELECT status FROM applications WHERE id = ${app.id}`;
    await check`DELETE FROM applications WHERE id = ${app.id}`;
    await check`DELETE FROM users WHERE id = ${candidate.id}`;
    await check.end();
    // Still enrolled — and no retention clock started on their documents.
    expect(after.status).toBe('enrolled');
    await context.close();
  });
});
