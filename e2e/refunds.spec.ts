/**
 * PAY-12 refunds — the approval chain.
 *
 * The claims are the ones a refund workflow exists to hold. Money does not
 * move on a request. The person who asked cannot approve. The application fee
 * stays non-refundable except when it was paid twice. And the double-payment
 * case returns the sponsor's transfer rather than reversing the card payment
 * that counted — getting that wrong would mark a paid student unpaid.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const REGISTRY = join(process.cwd(), '.auth', 'refund-registry.json');
const ADMIN = join(process.cwd(), '.auth', 'refund-admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const TUITION = `RF-TUI-${RUN}`;
const FEE = `RF-APP-${RUN}`;
const DOUBLE = `RF-DBL-${RUN}`;
const OWN = `RF-OWN-${RUN}`;

const REGISTRY_SECRET = 'KRUGS4ZANFZSAYJAORSXG5A2KRUGS4ZA';
const ADMIN_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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

async function staffSignIn(
  browser: import('@playwright/test').Browser,
  baseURL: string,
  email: string,
  secret: string,
  state: string,
) {
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
  await page.locator('#code').fill(totpFor(secret));
  await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await context.storageState({ path: state });
  await context.close();
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  const [student] = await db`SELECT id FROM users WHERE email = 'student@unilag.example.ng'`;

  // Four settled payments, one per claim.
  for (const [reference, context, amount, channel, metadata] of [
    [TUITION, 'tuition', 51_500_000, 'paystack', {}],
    [FEE, 'application', 2_500_000, 'paystack', {}],
    [
      DOUBLE,
      'tuition',
      51_500_000,
      'paystack',
      { probableDoublePayment: { settledBy: 'paystack', pendingTransferProof: { payerName: 'A Sponsor' } } },
    ],
    [OWN, 'tuition', 51_500_000, 'paystack', {}],
  ] as const) {
    await db`
      INSERT INTO transactions (institution_id, user_id, reference, context, amount_kobo, channel, status, paid_at, metadata)
      VALUES (${unilagId}, ${student.id}, ${reference}, ${context}, ${amount}, ${channel}, 'success', now(), ${db.json(metadata as never)})`;
  }

  await db`UPDATE users SET totp_secret = ${REGISTRY_SECRET}, totp_confirmed_at = now() WHERE email = 'registry@unilag.example.ng'`;
  await db`UPDATE users SET totp_secret = ${ADMIN_SECRET}, totp_confirmed_at = now() WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  await staffSignIn(browser, baseURL!, 'registry@unilag.example.ng', REGISTRY_SECRET, REGISTRY);
  // Past the next 30-second window, so the admin's code is not the same step.
  await staffSignIn(browser, baseURL!, 'admin@unilag.example.ng', ADMIN_SECRET, ADMIN);
});

test.afterAll(async () => {
  const db = sql();
  const refs = [TUITION, FEE, DOUBLE, OWN];
  await db`DELETE FROM refunds WHERE transaction_id IN (SELECT id FROM transactions WHERE reference IN ${db(refs)})`;
  await db`DELETE FROM transactions WHERE reference IN ${db(refs)}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

async function requestOn(
  page: import('@playwright/test').Page,
  reference: string,
  opts: { reason?: string; note?: string } = {},
) {
  await page.goto(`/admin/refunds?ref=${encodeURIComponent(reference)}`);
  await page.waitForLoadState('networkidle');
  if (opts.reason) await page.locator('#refund-reason').selectOption(opts.reason);
  await page.locator('#refund-note').fill(opts.note ?? 'Withdrew in week two, within the refund window.');
  await page.getByRole('button', { name: 'Request the refund' }).click();
}

async function statusOf(reference: string) {
  const db = sql();
  const [row] = await db`
    SELECT r.status, r.method, r.bank_reference, t.status AS txn_status
    FROM refunds r JOIN transactions t ON t.id = r.transaction_id
    WHERE t.reference = ${reference} ORDER BY r.created_at DESC LIMIT 1`;
  await db.end();
  return row;
}

test.describe('the registry asks, an administrator decides', () => {
  test('a request moves no money', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: REGISTRY });
    const page = await ctx.newPage();
    await requestOn(page, TUITION, { reason: 'withdrawal' });
    await expect(page.getByText(`Refund requested on ${TUITION}`)).toBeVisible({ timeout: 30_000 });
    await ctx.close();

    const row = await statusOf(TUITION);
    expect(row.status).toBe('requested');
    // The payment is untouched until a second person acts.
    expect(row.txn_status).toBe('success');
  });

  test('a second person approves it, and a full refund reverses the payment', async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ baseURL, storageState: ADMIN });
    const page = await ctx.newPage();
    await page.goto('/admin/refunds');
    await page.waitForLoadState('networkidle');

    const card = page.locator('li').filter({ hasText: TUITION }).first();
    await card.getByRole('button', { name: /Approve and refund through Paystack/ }).click();
    await expect(page.getByText('Refund processed')).toBeVisible({ timeout: 30_000 });
    await ctx.close();

    const row = await statusOf(TUITION);
    expect(row.status).toBe('processed');
    expect(row.txn_status).toBe('reversed');
  });
});

test.describe('the approval chain holds', () => {
  test('whoever asks cannot approve', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: ADMIN });
    const page = await ctx.newPage();
    await requestOn(page, OWN, { reason: 'withdrawal' });
    await expect(page.getByText(`Refund requested on ${OWN}`)).toBeVisible({ timeout: 30_000 });

    // The one administrator asked, so there is nobody who can approve — and
    // the page says so rather than offering a button that would be refused.
    const card = page.locator('li').filter({ hasText: OWN }).first();
    await expect(card.getByText(/a different administrator has to decide it/)).toBeVisible();
    await expect(card.getByRole('button', { name: /Approve/ })).toHaveCount(0);
    await expect(page.getByText('There is only one administrator here')).toBeVisible();
    await ctx.close();

    expect((await statusOf(OWN)).status).toBe('requested');
  });
});

test.describe('the application fee', () => {
  test('stays non-refundable for a withdrawal, as candidates are told before paying', async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ baseURL, storageState: REGISTRY });
    const page = await ctx.newPage();
    await requestOn(page, FEE, { reason: 'withdrawal' });
    await expect(page.getByText(/non-refundable/).first()).toBeVisible({ timeout: 30_000 });
    await ctx.close();

    const db = sql();
    const [row] = await db`
      SELECT count(*)::int AS n FROM refunds r JOIN transactions t ON t.id = r.transaction_id
      WHERE t.reference = ${FEE}`;
    await db.end();
    expect(row.n).toBe(0);
  });
});

test.describe('a payment made twice', () => {
  test('returns the transfer and leaves the card payment that counted alone', async ({
    browser,
    baseURL,
  }) => {
    const registry = await browser.newContext({ baseURL, storageState: REGISTRY });
    const rPage = await registry.newPage();
    await rPage.goto(`/admin/refunds?ref=${DOUBLE}`);
    await rPage.waitForLoadState('networkidle');

    // Defaults to the only method that is right for this case.
    await expect(rPage.locator('#refund-method')).toHaveValue('manual_transfer');
    await expect(rPage.locator('#refund-reason')).toHaveValue('duplicate_payment');
    await rPage.locator('#refund-note').fill('Sponsor paid by transfer after the card had already gone through.');
    await rPage.getByRole('button', { name: 'Request the refund' }).click();
    await expect(rPage.getByText(`Refund requested on ${DOUBLE}`)).toBeVisible({ timeout: 30_000 });
    await registry.close();

    const admin = await browser.newContext({ baseURL, storageState: ADMIN });
    const aPage = await admin.newPage();
    await aPage.goto('/admin/refunds');
    await aPage.waitForLoadState('networkidle');
    const card = aPage.locator('li').filter({ hasText: DOUBLE }).first();

    // A manual transfer needs the bank's reference: without it there is no
    // record the money went back.
    await card.getByRole('button', { name: /Approve, transfer recorded/ }).click();
    await expect(aPage.getByText(/Enter the reference from your bank/)).toBeVisible({
      timeout: 30_000,
    });

    await card.getByLabel(/Your bank's reference/).fill('GTB-FT-99102');
    await card.getByRole('button', { name: /Approve, transfer recorded/ }).click();
    await expect(aPage.getByText('Refund processed')).toBeVisible({ timeout: 30_000 });
    await admin.close();

    const row = await statusOf(DOUBLE);
    expect(row.status).toBe('processed');
    expect(row.method).toBe('manual_transfer');
    expect(row.bank_reference).toBe('GTB-FT-99102');
    // The card payment stands. Reversing it would mark a paid student unpaid.
    expect(row.txn_status).toBe('success');
  });
});
