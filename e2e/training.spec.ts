/**
 * CMP-17 — annual staff data protection training.
 *
 * A failed attempt is recorded and says which situations were missed; a pass
 * lasts a year; and an institution's administrator can see, on the staff
 * page, who has not done it.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const FACILITATOR = join(process.cwd(), '.auth', 'training-facilitator.json');
const ADMIN = join(process.cwd(), '.auth', 'training-admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

// The answer key, mirrored from training.ts: the page never sends it.
const CORRECT: Record<string, number> = { breach: 1, phone: 2, device: 1, minimum: 0, shared: 2 };

let facilitatorId = '';

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

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const db = sql();
  facilitatorId = (await db`SELECT id FROM users WHERE email = 'facilitator@unilag.example.ng'`)[0].id;
  await db`DELETE FROM staff_training WHERE user_id = ${facilitatorId}`;
  await db`UPDATE users SET totp_secret = ${SECRET}, totp_confirmed_at = now() WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  const f = await browser.newContext({ baseURL, storageState: undefined });
  const fp = await f.newPage();
  await fp.goto('/login');
  await fp.getByLabel(/Email address/).fill('facilitator@unilag.example.ng');
  await fp.getByLabel(/^Password/).fill(PASSWORD);
  await fp.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await f.cookies()).some((c) => c.name === 'pgd_session'), { timeout: 30_000 })
    .toBe(true);
  await f.storageState({ path: FACILITATOR });
  await f.close();

  const a = await browser.newContext({ baseURL, storageState: undefined });
  const ap = await a.newPage();
  await ap.goto('/login');
  await ap.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await ap.getByLabel(/^Password/).fill(PASSWORD);
  await ap.getByRole('button', { name: 'Log in' }).click();
  await ap.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
  await ap.locator('#code').fill(totpFor(SECRET));
  await ap.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
  await ap.waitForURL(/\/admin/, { timeout: 30_000 });
  await a.storageState({ path: ADMIN });
  await a.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM staff_training WHERE user_id = ${facilitatorId}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

async function answer(page: import('@playwright/test').Page, wrong: string[] = []) {
  await page.goto('/security/training');
  await page.waitForLoadState('networkidle');
  for (const [id, correct] of Object.entries(CORRECT)) {
    const value = wrong.includes(id) ? (correct + 1) % 3 : correct;
    await page.locator(`#${id}-${value}`).check();
  }
  await page.getByRole('button', { name: 'Submit my answers' }).click();
}

test.describe('CMP-17', () => {
  test('the roster says who has not been trained', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: ADMIN });
    const page = await ctx.newPage();
    await page.goto('/admin/staff');
    await expect(page.getByText('Not everyone here has current training')).toBeVisible();
    const card = page.locator('li').filter({ hasText: 'facilitator@unilag.example.ng' }).first();
    await expect(card).toContainText('Not yet taken');
    await ctx.close();
  });

  test('a failed attempt is recorded, and says which situations were missed', async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ baseURL, storageState: FACILITATOR });
    const page = await ctx.newPage();
    await answer(page, ['phone', 'shared']);
    await expect(page.getByText('Not passed this time')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Missed last time.')).toHaveCount(2);
    await ctx.close();

    const db = sql();
    const [row] = await db`SELECT passed, score, expires_at FROM staff_training WHERE user_id = ${facilitatorId}`;
    await db.end();
    // Kept, not discarded: attempts are part of the answer to "is your staff trained".
    expect(row).toMatchObject({ passed: false, score: 3, expires_at: null });
  });

  test('a pass lasts a year, and the roster reflects it', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: FACILITATOR });
    const page = await ctx.newPage();
    await answer(page);
    await expect(page.getByText(/You are trained for the next 365 days/)).toBeVisible({
      timeout: 30_000,
    });
    await ctx.close();

    const db = sql();
    const [row] = await db`
      SELECT passed, expires_at FROM staff_training WHERE user_id = ${facilitatorId} AND passed ORDER BY created_at DESC LIMIT 1`;
    await db.end();
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);

    const admin = await browser.newContext({ baseURL, storageState: ADMIN });
    const ap = await admin.newPage();
    await ap.goto('/admin/staff');
    const card = ap.locator('li').filter({ hasText: 'facilitator@unilag.example.ng' }).first();
    await expect(card).toContainText('Trained');
    await admin.close();
  });
});
