/**
 * "Teach with us": applying to the one central faculty, and the Hub's answer.
 *
 * The faculty is run by Data Protection Hub in collaboration with ALDAPCON,
 * so there is no university to pick. Applying grants nothing; the Hub's
 * super admin invites (choosing the universities the person will teach at)
 * or declines, in the platform console. The public form is
 * Turnstile-protected, so what its test can prove depends on configuration:
 * with a secret set, an automated submission must be refused; without one,
 * it goes through and lands in the queue.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const ADMIN = 'platform@example.ng';
const RUN = Date.now();
// A fresh secret each run, cleared afterwards: never a published example
// secret on an account that may be reachable through a preview tunnel.
const SECRET = Array.from(randomBytes(20), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b % 32]).join('');
const TURNSTILE_ON = Boolean(process.env.TURNSTILE_SECRET_KEY);

// The smallest files that pass the byte checks for each format.
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);


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
  await page.waitForURL(/\/platform/, { timeout: 30_000 });
  return { ctx, page };
}

test.beforeAll(async () => {
  const db = sql();
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
  test('one form on every site, with no university to pick', async ({ page, baseURL }) => {
    for (const url of [`${baseURL!.replace('//unilag.', '//')}/teach-with-us`, '/teach-with-us']) {
      await page.goto(url);
      await expect(page.getByText('Data Protection Hub · in collaboration with ALDAPCON')).toBeVisible();
      await expect(page.locator('#fullName')).toBeVisible();
      await expect(page.getByRole('link', { name: /University of Lagos/ })).toHaveCount(0);
    }
  });

  test('the CV and both kinds of certificate are required, on the server too', async ({ page }) => {
    await page.goto('/teach-with-us');
    await page.waitForLoadState('load');
    await page.locator('#fullName').fill('Dr Test Applicant');
    await page.locator('#email').fill(`teach-${RUN}-nocerts@example.ng`);
    await page.locator('#qualifications').fill('LLM in data protection law; eight years as a DPO in banking.');
    await page.locator('#areas').fill('Breach response and the 72-hour clock');
    await page.getByRole('checkbox').check();
    await page.locator('#cv').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF });
    // The browser's own "required" is a convenience; the server decides.
    await page.evaluate(() => document.querySelectorAll('input[type=file]').forEach((i) => i.removeAttribute('required')));
    await page.getByRole('button', { name: 'Send my application' }).click();
    await expect(page.getByText('Attach at least one academic certificate')).toBeVisible({ timeout: 30_000 });
  });

  test('a complete application is refused or sent, as the security check is configured', async ({ page }) => {
    await page.goto('/teach-with-us');
    await page.waitForLoadState('load');
    await page.locator('#fullName').fill('Dr Test Applicant');
    await page.locator('#email').fill(`teach-${RUN}-form@example.ng`);
    await page.locator('#qualifications').fill('LLM in data protection law; eight years as a DPO in banking.');
    await page.locator('#areas').fill('Breach response and the 72-hour clock');
    await page.locator('#cv').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.locator('#academicCerts').setInputFiles([
      { name: 'llb.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 'transcript.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await page.locator('#professionalCerts').setInputFiles({ name: 'cipp-e.jpg', mimeType: 'image/jpeg', buffer: JPG });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Send my application' }).click();
    if (TURNSTILE_ON) {
      await expect(page.getByText('The security check did not complete')).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText('Application sent')).toBeVisible({ timeout: 30_000 });
    }
    const db = sql();
    const rows = await db`SELECT certificates FROM teaching_applications WHERE email = ${`teach-${RUN}-form@example.ng`}`;
    await db.end();
    expect(rows.length).toBe(TURNSTILE_ON ? 0 : 1);
    if (!TURNSTILE_ON) {
      expect(rows[0].certificates.map((c: { kind: string }) => c.kind).sort()).toEqual(['academic', 'academic', 'professional']);
    }
  });

  test('the Hub invites one to chosen universities, and declines another', async ({ browser, baseURL }) => {
    const db = sql();
    for (const who of ['invite', 'decline']) {
      await db`
        INSERT INTO teaching_applications (full_name, email, qualifications, areas, certificates)
        VALUES (${`E2E ${who} ${RUN}`}, ${`teach-${RUN}-${who}@example.ng`},
          'CIPP/E, ten years in privacy practice at a telecoms operator.', 'DPIAs',
          ${JSON.stringify([
            { kind: 'academic', key: `faculty-applications/e2e-${RUN}/academic-1.pdf`, filename: 'llb.pdf', contentType: 'application/pdf' },
            { kind: 'professional', key: `faculty-applications/e2e-${RUN}/professional-2.jpg`, filename: 'dpco-licence.jpg', contentType: 'image/jpeg' },
          ])}::jsonb)`;
    }
    await db.end();

    const { ctx, page } = await adminPage(browser, baseURL);
    await page.goto('/platform/faculty');
    await expect(page.getByRole('heading', { name: 'Faculty applications' })).toBeVisible();
    const first = page.locator('li').filter({ hasText: `E2E invite ${RUN}` });
    await expect(first.getByRole('link', { name: 'Academic certificate 1: llb.pdf' })).toBeVisible();
    await expect(first.getByRole('link', { name: 'Professional certificate 1: dpco-licence.jpg' })).toBeVisible();

    // Inviting without choosing a university is refused.
    const invite = page.locator('li').filter({ hasText: `E2E invite ${RUN}` });
    await invite.getByRole('button', { name: 'Invite to the faculty' }).click();
    await expect(invite.getByText('Choose at least one university')).toBeVisible({ timeout: 30_000 });

    await invite.getByRole('checkbox', { name: 'University of Lagos' }).check();
    await invite.getByRole('checkbox', { name: 'Kaduna State University' }).check();
    await invite.getByRole('button', { name: 'Invite to the faculty' }).click();
    await expect(page.getByText(`E2E invite ${RUN} invited to the faculty`)).toBeVisible({ timeout: 30_000 });

    const decline = page.locator('li').filter({ hasText: `E2E decline ${RUN}` });
    await decline.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText(`E2E decline ${RUN}'s application declined`)).toBeVisible({ timeout: 30_000 });
    await ctx.close();

    const check = sql();
    const apps = await check`SELECT email, status FROM teaching_applications WHERE email LIKE ${`teach-${RUN}-%`} ORDER BY email`;
    const where = await check`
      SELECT i.slug FROM memberships m JOIN users u ON u.id = m.user_id JOIN institutions i ON i.id = m.institution_id
      WHERE u.email = ${`teach-${RUN}-invite@example.ng`} AND m.role = 'facilitator' ORDER BY i.slug`;
    await check.end();
    expect(Object.fromEntries(apps.map((r) => [r.email.includes('invite') ? 'invite' : 'decline', r.status]))).toEqual({
      decline: 'declined',
      invite: 'invited',
    });
    expect(where.map((r) => r.slug)).toEqual(['kasu', 'unilag']);
  });
});
