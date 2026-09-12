/**
 * The institution admin console — IA-01, IA-03, IA-04, IA-06, IA-08.
 *
 * The point of this block is that a university can configure itself. Before
 * it, fees and intakes were seed data that only someone with database access
 * could change, which is not a product anyone can pilot.
 *
 * The branding test is the one that matters most: §2.5 and conflict C-04 say
 * the contrast check must **block**, not warn. "Warn and allow" is the easy
 * implementation and the wrong one, so the test proves refusal.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const ADMIN_STATE = join(process.cwd(), '.auth', 'admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

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

/** One sign-in for the whole file: AUTH-08 rate-limits TOTP, correctly. */
test.beforeAll(async ({ browser, baseURL }) => {
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`
    UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL
    WHERE email = 'admin@unilag.example.ng'`;
  // Restore the seeded brand colour so the preview assertions start from a
  // known state however the previous run left it.
  await sql`UPDATE institutions SET brand_colour = '#1B3A6B' WHERE slug = 'unilag'`;
  await sql.end();

  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  // storageState must be cleared explicitly: newContext inherits the
  // describe-level `use`, so it would try to read the file this is creating.
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  // Wait for hydration: this form is a client component bound to a server
  // action, and a click that lands first is swallowed with no request at all.
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page.getByRole('heading', { name: 'University of Lagos' })).toBeVisible({
    timeout: 30_000,
  });

  await context.storageState({ path: ADMIN_STATE });
  await context.close();
});

/**
 * Restore what this suite changed.
 *
 * These screens edit configuration the rest of the product reads — the funnel
 * suite asserts on the seeded application fee, and would fail against a
 * number this file left behind. A suite that mutates shared state cleans up
 * after itself rather than making every other suite defensive.
 */
test.afterAll(async () => {
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [inst] = await sql`SELECT id FROM institutions WHERE slug = 'unilag'`;
  await sql`
    UPDATE fee_items SET amount_kobo = 2500000, label = 'Application fee'
    WHERE institution_id = ${inst.id} AND kind = 'application' AND cohort_id IS NULL`;
  await sql`UPDATE institutions SET brand_colour = '#1B3A6B' WHERE id = ${inst.id}`;
  // Intakes this suite created are drafts and invisible to candidates, but
  // they clutter the fixture, so they go too.
  await sql`
    DELETE FROM cohorts
    WHERE institution_id = ${inst.id} AND (name LIKE 'Test intake %' OR name LIKE 'Bad dates %')`;
  await sql.end();
});

test.describe.configure({ mode: 'serial' });

// Applied per describe, not at file scope: a file-level `use` is resolved
// before `beforeAll` runs, so the state file would not exist yet.

/* --------------------------------------------------------------------- IA-01 */

test.describe('the setup checklist', () => {
  test.use({ storageState: ADMIN_STATE });

  test('tells the admin what is missing before a candidate finds out', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible();

    // The seed configures fees and an intake, so those read as done.
    await expect(page.getByRole('link', { name: 'Application fee set' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'An intake is open' })).toBeVisible();
  });
});

/* --------------------------------------------------------------------- IA-03 */

test.describe('fees', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin can change a fee, and is told who it affects', async ({ page }) => {
    await page.goto('/admin/fees');
    await expect(page.getByRole('heading', { name: 'Fees' })).toBeVisible();

    // G-19 is an open gap, so the screen has to surface the exposure rather
    // than pretend fee versioning exists.
    await expect(page.getByText(/mid-application/i).first()).toBeVisible();

    const amount = 26500 + (RUN % 100);
    await page.getByLabel(/Which fee/).selectOption('application');
    await page.getByLabel(/Label candidates see/).fill('Application fee');
    await page.getByLabel(/Amount in naira/).fill(String(amount));
    await page.getByRole('button', { name: 'Save fee' }).click();

    await expect(page.getByText('Saved', { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(amount.toLocaleString('en-NG'))).toBeVisible();
  });

  test('rejects an amount that is not money', async ({ page }) => {
    await page.goto('/admin/fees');
    await page.getByLabel(/Label candidates see/).fill('Application fee');
    await page.getByLabel(/Amount in naira/).fill('twenty thousand');
    await page.getByRole('button', { name: 'Save fee' }).click();
    await expect(page.getByText(/Enter an amount in naira/)).toBeVisible({ timeout: 30_000 });
  });
});

/* --------------------------------------------------------------------- IA-04 */

test.describe('intakes', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin can create one', async ({ page }) => {
    await page.goto('/admin/cohorts');
    await expect(page.getByRole('heading', { name: 'Intakes' })).toBeVisible();

    const name = `Test intake ${RUN}`;
    await page.getByLabel(/^Name/).fill(name);
    await page.getByLabel(/^Places/).fill('25');
    await page.getByLabel(/^Status/).selectOption('draft');
    await page.getByRole('button', { name: /Create intake|Update intake/ }).click();

    await expect(page.getByText('Saved', { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name })).toBeVisible();
  });

  test('refuses a capacity below the seats already committed', async ({ page }) => {
    // §5.1 enforces capacity at offer issuance. Shrinking below what is
    // already promised would silently oversell, so it is refused outright
    // rather than accepted and quietly violated.
    await page.goto('/admin/cohorts');
    await page.getByLabel(/^Editing/).selectOption({ index: 1 });
    await page.getByLabel(/^Places/).fill('1');
    await page.getByRole('button', { name: 'Update intake' }).click();

    await expect(page.getByText(/already committed|places are already/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('refuses teaching that starts before applications close', async ({ page }) => {
    await page.goto('/admin/cohorts');
    await page.getByLabel(/^Name/).fill(`Bad dates ${RUN}`);
    await page.getByLabel(/^Places/).fill('10');
    await page.getByLabel(/Applications close/).fill('2027-06-01');
    await page.getByLabel(/Teaching starts/).fill('2027-01-01');
    await page.getByRole('button', { name: /Create intake|Update intake/ }).click();

    await expect(page.getByText(/cannot start before applications close/i)).toBeVisible({
      timeout: 30_000,
    });
  });
});

/* ------------------------------------------------- IA-06, and conflict C-04 */

test.describe('branding blocks a failing colour', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a colour that fails contrast cannot be saved at all', async ({ page }) => {
    await page.goto('/admin/branding');
    await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();

    // A cheerful yellow: roughly 1.6:1 on Paper, unreadable.
    await page.locator('#brandColour').fill('#F2C94C');

    await expect(page.getByText('This colour cannot be saved')).toBeVisible();
    // Blocked, not warned — the brief says explicitly "do not warn-and-allow".
    await expect(page.getByRole('button', { name: 'Save branding' })).toBeDisabled();
    await expect(page.getByText(/not a warning that can be dismissed/i)).toBeVisible();
  });

  test('it offers the nearest passing colour, and that one saves', async ({ page }) => {
    await page.goto('/admin/branding');
    await page.locator('#brandColour').fill('#F2C94C');

    // A refusal without an alternative is just an obstacle.
    const useInstead = page.getByRole('button', { name: 'Use that instead' });
    await expect(useInstead).toBeVisible();
    await useInstead.click();

    await expect(page.getByRole('button', { name: 'Save branding' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 30_000 });
  });

  test('a dark brand colour is accepted', async ({ page }) => {
    await page.goto('/admin/branding');
    await page.locator('#brandColour').fill('#1B3A6B');
    await expect(page.getByText(/That passes\./)).toBeVisible();
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 30_000 });
  });
});

/* --------------------------------------------------------------------- IA-08 */

test.describe('reconciliation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reports what the nightly job found, and does not self-heal', async ({ page }) => {
    await page.goto('/admin/reconciliation');
    await expect(page.getByRole('heading', { name: 'Reconciliation' })).toBeVisible();

    await expect(page.getByText(/flags and never corrects/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By fee type' })).toBeVisible();
    // The institution's own share is the number they care about.
    await expect(page.getByRole('heading', { name: 'Your share' })).toBeVisible();
  });
});
