/**
 * "Teach with us": asking to teach, and the administrator's answer.
 *
 * Applying grants nothing; the institution administrator invites (through
 * the ordinary facilitator invitation) or declines. The public form is
 * Turnstile-protected, so what its test can prove depends on configuration:
 * with a secret set, an automated submission must be refused; without one,
 * it goes through and lands in the queue.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const ADMIN = 'admin@unilag.example.ng';
const RUN = Date.now();
// A fresh secret each run, cleared afterwards: never a published example
// secret on an account that may be reachable through a preview tunnel.
const SECRET = Array.from(randomBytes(20), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b % 32]).join('');
const TURNSTILE_ON = Boolean(process.env.TURNSTILE_SECRET_KEY);

let unilagId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

function totp() {
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of SECRET) bits += B.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const d = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = d[d.length - 1] & 15;
  return String((((d[o] & 127) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) % 1e6).padStart(6, '0');
}

async function adminPage(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(ADMIN);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
  await page.locator('#code').fill(totp());
  await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  return { ctx, page };
}

test.beforeAll(async () => {
  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  await db`UPDATE users SET totp_secret = ${SECRET}, totp_confirmed_at = now() WHERE email = ${ADMIN}`;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = ${ADMIN}`;
  await db`DELETE FROM teaching_applications WHERE email LIKE ${`teach-${RUN}-%`}`;
  await db`DELETE FROM users WHERE email LIKE ${`teach-${RUN}-%`}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Teach with us', () => {
  test('the main site asks which university first', async ({ page, baseURL }) => {
    await page.goto(`${baseURL!.replace('//unilag.', '//')}/teach-with-us`);
    for (const name of ['University of Lagos', 'Federal University Lokoja', 'Kaduna State University']) {
      await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
  });

  test('the form is refused or sent, as the security check is configured', async ({ page }) => {
    await page.goto('/teach-with-us');
    await page.locator('#fullName').fill('Dr Test Applicant');
    await page.locator('#email').fill(`teach-${RUN}-form@example.ng`);
    await page.locator('#qualifications').fill('LLM in data protection law; eight years as a DPO in banking.');
    await page.locator('#areas').fill('Breach response and the 72-hour clock');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Send my application' }).click();
    if (TURNSTILE_ON) {
      await expect(page.getByText('The security check did not complete')).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText('Application sent')).toBeVisible({ timeout: 30_000 });
    }
    const db = sql();
    const rows = await db`SELECT 1 FROM teaching_applications WHERE email = ${`teach-${RUN}-form@example.ng`}`;
    await db.end();
    expect(rows.length).toBe(TURNSTILE_ON ? 0 : 1);
  });

  test('the administrator invites one and declines another', async ({ browser, baseURL }) => {
    const db = sql();
    for (const who of ['invite', 'decline']) {
      await db`
        INSERT INTO teaching_applications (institution_id, full_name, email, qualifications, areas)
        VALUES (${unilagId}, ${`E2E ${who} ${RUN}`}, ${`teach-${RUN}-${who}@example.ng`},
          'CIPP/E, ten years in privacy practice at a telecoms operator.', 'DPIAs')`;
    }
    await db.end();

    const { ctx, page } = await adminPage(browser, baseURL);
    await page.goto('/admin/staff');
    await expect(page.getByRole('heading', { name: 'People who want to teach' })).toBeVisible();

    const invite = page.locator('li').filter({ hasText: `E2E invite ${RUN}` });
    await invite.getByRole('button', { name: 'Invite as facilitator' }).click();
    await expect(page.getByText(`E2E invite ${RUN} can now work here`)).toBeVisible({ timeout: 30_000 });

    await page.goto('/admin/staff');
    const decline = page.locator('li').filter({ hasText: `E2E decline ${RUN}` });
    await decline.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText(`E2E decline ${RUN}'s application declined`)).toBeVisible({ timeout: 30_000 });
    await ctx.close();

    const check = sql();
    const rows = await check`
      SELECT t.email, t.status, (SELECT count(*)::int FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE u.email = t.email AND m.role = 'facilitator') AS facilitator
      FROM teaching_applications t WHERE t.email LIKE ${`teach-${RUN}-%`} ORDER BY t.email`;
    await check.end();
    const by = Object.fromEntries(rows.map((r) => [r.email.split('-').at(-1)!.split('@')[0], r]));
    expect(by.invite).toMatchObject({ status: 'invited', facilitator: 1 });
    expect(by.decline).toMatchObject({ status: 'declined', facilitator: 0 });
  });
});
