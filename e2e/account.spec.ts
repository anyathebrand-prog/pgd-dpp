/**
 * ST-14 and ST-17 — the self-service half of CMP-07.
 *
 * The point of these screens is that a rectification never becomes a DPO
 * ticket. So the tests are about whether someone can actually fix their own
 * record, and about the two rules that make that safe: a password change
 * needs the current password, and it takes every other session with it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STATE = join(process.cwd(), '.auth', 'account.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();
const STUDENT = 'student@unilag.example.ng';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeAll(async ({ browser, baseURL }) => {
  // Earlier runs leave live sessions for this account, and the session test
  // below asserts on "the other one" — which is only unambiguous if there is
  // exactly one other one. Start from a clean slate rather than writing a
  // test that passes by picking the right row out of a pile.
  const db = sql();
  await db`
    UPDATE sessions SET revoked_at = now()
    WHERE user_id = (SELECT id FROM users WHERE email = ${STUDENT}) AND revoked_at IS NULL`;
  await db.end();

  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(STUDENT);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

  await context.storageState({ path: STATE });
  await context.close();
});

/** Leave the fixture as it was found: the name is asserted by other suites. */
test.afterAll(async () => {
  const db = sql();
  await db`UPDATE users SET full_name = 'Kelechi Obi', phone = NULL WHERE email = ${STUDENT}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('your account', () => {
  test.use({ storageState: STATE });

  test('is reachable from the header, rather than being a link to a 404', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /Kelechi Obi|student@unilag/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  });

  test('a phone number can be corrected without asking anyone', async ({ page }) => {
    await page.goto('/account');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Phone number/).fill('+234 803 000 0000');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Your details are saved.')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT phone FROM users WHERE email = ${STUDENT}`;
    await db.end();
    expect(row.phone).toBe('+234 803 000 0000');
  });

  test('the legal name is locked while enrolled, with a route rather than a dead end', async ({
    page,
  }) => {
    // §5 is specific: a locked field that is merely greyed out sends the
    // person to the DPO anyway, having first made them feel obstructed.
    await page.goto('/account');
    await expect(page.getByLabel(/Full name/)).toHaveAttribute('readonly', '');
    await expect(page.getByText('Your legal name is part of an academic record')).toBeVisible();
    await page.getByRole('link', { name: 'Request a correction to your name' }).click();
    await expect(page).toHaveURL(/\/dpo\/request$/);
  });

  test('a password change needs the current password', async ({ page }) => {
    await page.goto('/account');
    await page.waitForLoadState('networkidle');

    // By id rather than by label: every label here ends in "(required)", and
    // "New password" is a prefix of "New password again".
    await page.locator('#pw-current').fill('not-the-password-1');
    await page.locator('#pw-new').fill(`Brand-New-${RUN}`);
    await page.locator('#pw-confirm').fill(`Brand-New-${RUN}`);
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByText('That is not your current password.')).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('where you are signed in', () => {
  test.use({ storageState: STATE });

  test('lists this device and marks it as this device', async ({ page }) => {
    await page.goto('/security/sessions');
    await expect(page.getByRole('heading', { name: 'Where you are signed in' })).toBeVisible();
    await expect(page.getByText('This device, right now')).toBeVisible();
    // No location column, and the page says why rather than leaving a gap.
    await expect(page.getByText(/one-way hash of the IP address/)).toBeVisible();
  });

  test('a second session can be ended from the first', async ({ page, browser, baseURL }) => {
    // A genuinely separate browser context: a second login, the way a second
    // phone would be.
    const other = await browser.newContext({ baseURL, storageState: undefined });
    const otherPage = await other.newPage();
    await otherPage.goto('/login');
    await otherPage.getByLabel(/Email address/).fill(STUDENT);
    await otherPage.getByLabel(/^Password/).fill(PASSWORD);
    await otherPage.getByRole('button', { name: 'Log in' }).click();
    await otherPage.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    await page.goto('/security/sessions');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'End this session' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'End this session' }).first().click();
    await expect(page.getByText('That session has been signed out.')).toBeVisible({
      timeout: 30_000,
    });

    // The revoked session is dead on the other device, not merely absent from
    // a list — which is the only version of this feature worth having.
    await otherPage.goto('/dashboard');
    await expect(otherPage).toHaveURL(/\/login/);
    await other.close();
  });
});
