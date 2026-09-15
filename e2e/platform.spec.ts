/**
 * IA-07 payout setup and SA-01 tenant provisioning.
 *
 * Both were 404s: one linked from the IA-01 checklist that exists to stop an
 * institution discovering at checkout that it cannot be paid, the other the
 * destination `consoleFor` sends every super admin to.
 *
 * The claim under test in IA-07 is the one the flow spells out — "account
 * name resolved and displayed for explicit confirmation before saving,
 * Paystack is not liable for payouts to a wrong account" — so the tests are
 * about what happens when nobody confirms, and about whether the name the
 * browser sends back is believed.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const ADMIN = join(process.cwd(), '.auth', 'payout-admin.json');
const PLATFORM = join(process.cwd(), '.auth', 'platform-admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const slug = `test${String(RUN).slice(-6)}`;
const tenantAdmin = `vc-${RUN}@example.ng`;

let unilagId = '';
/*
 * The whole payout block, not just the two columns IA-07 writes last.
 *
 * Configuring a payout account rewrites the bank name, account number and
 * resolved account name as well, and PY-06 renders those to a sponsor about
 * to move money — so restoring half of them leaves the seeded institution
 * quoting a simulated account to the offline-payment suite.
 */
type Payout = {
  code: string | null;
  verified: Date | null;
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  sharePercent: number | null;
};
let previous: Payout | null = null;

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function currentTotp(secret: string) {
  const { createHmac } = await import('node:crypto');
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

/** Signs a staff account in through the second factor AUTH-08 requires. */
async function signInStaff(browser: Parameters<typeof test>[0] extends never ? never : any, baseURL: string, email: string, state: string, landsOn: RegExp) {
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForURL(landsOn, { timeout: 30_000 });
  await context.storageState({ path: state });
  await context.close();
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  const [inst] = await db`
    SELECT id, paystack_subaccount_code, payout_verified_at, bank_name, bank_code,
           bank_account_number, bank_account_name, paystack_share_percent
    FROM institutions WHERE slug = 'unilag'`;
  unilagId = inst.id;
  previous = {
    code: inst.paystack_subaccount_code,
    verified: inst.payout_verified_at,
    bankName: inst.bank_name,
    bankCode: inst.bank_code,
    accountNumber: inst.bank_account_number,
    accountName: inst.bank_account_name,
    sharePercent: inst.paystack_share_percent,
  };

  // Start from "not configured", which is the state IA-07 exists to resolve.
  await db`UPDATE institutions SET paystack_subaccount_code = NULL, payout_verified_at = NULL WHERE id = ${unilagId}`;
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email IN ('admin@unilag.example.ng', 'platform@example.ng')`;
  await db.end();

  await signInStaff(browser, baseURL!, 'admin@unilag.example.ng', ADMIN, /\/admin/);
  await signInStaff(browser, baseURL!, 'platform@example.ng', PLATFORM, /\/platform\/tenants/);
});

test.afterAll(async () => {
  const db = sql();
  if (previous) {
    await db`
      UPDATE institutions SET
        paystack_subaccount_code = ${previous.code},
        payout_verified_at = ${previous.verified},
        bank_name = ${previous.bankName},
        bank_code = ${previous.bankCode},
        bank_account_number = ${previous.accountNumber},
        bank_account_name = ${previous.accountName},
        paystack_share_percent = ${previous.sharePercent ?? 90}
      WHERE id = ${unilagId}`;
  }
  await db`DELETE FROM programmes WHERE institution_id IN (SELECT id FROM institutions WHERE slug = ${slug})`;
  await db`DELETE FROM memberships WHERE institution_id IN (SELECT id FROM institutions WHERE slug = ${slug})`;
  await db`DELETE FROM institutions WHERE slug = ${slug}`;
  await db`DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ${tenantAdmin})`;
  await db`DELETE FROM users WHERE email = ${tenantAdmin}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('IA-07 — where the money goes', () => {
  test.use({ storageState: ADMIN });

  test('an unconfigured institution is told it cannot take payment', async ({ page }) => {
    await page.goto('/admin/payouts');
    await expect(page.getByRole('heading', { level: 1, name: 'Where your money goes' })).toBeVisible();
    // IA-01 calls this blocking, and the blocking state is stated here rather
    // than discovered at a candidate's checkout.
    await expect(page.getByText('You cannot take payment until this is done')).toBeVisible();
  });

  test('the bank is asked who owns the account before anything is saved', async ({ page }) => {
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/^Bank/).selectOption('011');
    await page.getByLabel(/Account number/).fill('2031457789');
    await page.getByRole('button', { name: 'Look it up' }).click();

    await expect(page.getByText(/SIMULATED ACCOUNT 7789/)).toBeVisible({
      timeout: 30_000,
    });

    // Nothing is stored by a lookup. The account has been resolved, not
    // accepted.
    const db = sql();
    const [row] = await db`SELECT paystack_subaccount_code FROM institutions WHERE id = ${unilagId}`;
    await db.end();
    expect(row.paystack_subaccount_code).toBeNull();
  });

  test('saving is refused unless a person confirms the name', async ({ page }) => {
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/^Bank/).selectOption('011');
    await page.getByLabel(/Account number/).fill('2031457789');
    await page.getByRole('button', { name: 'Look it up' }).click();
    await expect(page.getByText(/SIMULATED ACCOUNT/)).toBeVisible({
      timeout: 30_000,
    });

    // The checkbox is the control: Paystack is not liable for a payout to a
    // wrong account, and a transposed digit is a valid account belonging to
    // somebody else.
    await page.getByRole('button', { name: 'That is our account' }).click();
    await expect(page.getByText(/Confirm that the name the bank returned/)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT paystack_subaccount_code FROM institutions WHERE id = ${unilagId}`;
    await db.end();
    expect(row.paystack_subaccount_code).toBeNull();
  });

  test('confirming it configures the split and clears the blocker', async ({ page }) => {
    await page.goto('/admin/payouts');
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/^Bank/).selectOption('011');
    await page.getByLabel(/Account number/).fill('2031457789');
    await page.getByRole('button', { name: 'Look it up' }).click();
    await expect(page.getByText(/SIMULATED ACCOUNT/)).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'That is our account' }).click();
    await expect(page.getByText('Payouts are configured')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT paystack_subaccount_code, payout_verified_at, bank_account_name, bank_code
      FROM institutions WHERE id = ${unilagId}`;
    await db.end();

    expect(row.paystack_subaccount_code).toBeTruthy();
    expect(row.payout_verified_at).toBeTruthy();
    // The stored name is the one the bank returned, not anything typed.
    expect(row.bank_account_name).toContain('SIMULATED ACCOUNT');
    expect(row.bank_code).toBe('011');

    // And the checklist that sent us here now agrees.
    await page.goto('/admin');
    await expect(page.getByText('Payout account configured')).toBeVisible();
  });
});

test.describe('SA-01 — provisioning an institution', () => {
  test.use({ storageState: PLATFORM });

  test('a super admin now has somewhere to land', async ({ page }) => {
    // This was a 404, and consoleFor sends every super admin to it.
    await page.goto('/platform/tenants');
    await expect(page.getByRole('heading', { level: 1, name: 'Institutions' })).toBeVisible();
    await expect(page.getByText('University of Lagos')).toBeVisible();
  });

  test('a reserved subdomain is refused', async ({ page }) => {
    await page.goto('/platform/tenants');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Legal name/).fill('The App University');
    await page.getByLabel(/Short name/).fill('APP');
    await page.getByLabel(/Subdomain/).fill('app');
    await page.getByLabel(/Their name/).fill('A Person');
    await page.getByLabel(/Their email/).fill('person@example.ng');
    await page.getByRole('button', { name: 'Provision the institution' }).click();

    await expect(page.getByText(/reserved by the platform/)).toBeVisible({ timeout: 30_000 });
  });

  test('an illegible brand colour is refused before it is stored', async ({ page }) => {
    await page.goto('/platform/tenants');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Legal name/).fill('University of Pale Yellow');
    await page.getByLabel(/Short name/).fill('UPY');
    await page.getByLabel(/Subdomain/).fill(`pale${String(RUN).slice(-5)}`);
    await page.getByLabel(/Brand colour/).fill('#FFFF00');
    await page.getByLabel(/Their name/).fill('A Person');
    await page.getByLabel(/Their email/).fill('pale@example.ng');
    await page.getByRole('button', { name: 'Provision the institution' }).click();

    // §2.5: the tenant brand is the one overridable token and it still has to
    // be legible. Refusing here beats a page refusing it later.
    await expect(page.getByText(/nearest colour that passes/)).toBeVisible({ timeout: 30_000 });
  });

  test('provisioning creates the institution, its programme and an administrator', async ({
    page,
  }) => {
    await page.goto('/platform/tenants');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Legal name/).fill('University of Ibadan');
    await page.getByLabel(/Short name/).fill('UI');
    await page.getByLabel(/Subdomain/).fill(slug);
    await page.getByLabel(/City/).fill('Ibadan');
    await page.getByLabel(/Their name/).fill('Folake Adebayo');
    await page.getByLabel(/Their email/).fill(tenantAdmin);
    await page.getByRole('button', { name: 'Provision the institution' }).click();

    await expect(page.getByText(`${slug} is provisioned`)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [inst] = await db`SELECT id, status FROM institutions WHERE slug = ${slug}`;
    const [programme] = await db`SELECT count(*)::int AS n FROM programmes WHERE institution_id = ${inst.id}`;
    const [admin] = await db`
      SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE u.email = ${tenantAdmin} AND m.institution_id = ${inst.id}`;
    const [token] = await db`
      SELECT count(*)::int AS n FROM auth_tokens
      WHERE purpose = 'activate' AND user_id = (SELECT id FROM users WHERE email = ${tenantAdmin})`;
    await db.end();

    // Provisioning, not live: an institution with no fees, no intake and no
    // payout account is not ready to be offered to a candidate.
    expect(inst.status).toBe('provisioning');
    expect(programme.n).toBe(1);
    expect(admin.role).toBe('institution_admin');
    // AUTH-01: an activation link, never a generated password.
    expect(token.n).toBe(1);
  });

  test('and it cannot go live without a verified payout account', async ({ page }) => {
    await page.goto('/platform/tenants');
    await page.waitForLoadState('networkidle');

    const row = page.locator('li', { hasText: 'University of Ibadan' });
    await row.getByRole('button', { name: /Take UI live/ }).click();

    await expect(page.getByText(/stopped at checkout/)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [inst] = await db`SELECT status FROM institutions WHERE slug = ${slug}`;
    await db.end();
    expect(inst.status).toBe('provisioning');
  });
});
