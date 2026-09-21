/**
 * AU-10 — the institution chooser (SSO-04), end to end.
 *
 * The seeded UNILAG student is given an application at UNN for the length of
 * this file: gap G-03's person, enrolled at one school and applying to
 * another. Signing in asks which; switching moves the session to the other
 * host through a single-use token; a default skips the question.
 */
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const EMAIL = 'student@unilag.example.ng';
const UNN = 'http://unn.localhost:3000';

let userId = '';
let unnId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function logIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(EMAIL);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test.beforeAll(async () => {
  const db = sql();
  userId = (await db`SELECT id FROM users WHERE email = ${EMAIL}`)[0].id;
  unnId = (await db`SELECT id FROM institutions WHERE slug = 'unn'`)[0].id;
  await db`DELETE FROM memberships WHERE user_id = ${userId} AND institution_id = ${unnId}`;
  await db`INSERT INTO memberships (user_id, institution_id, role) VALUES (${userId}, ${unnId}, 'candidate')`;
  await db`UPDATE users SET default_institution_id = NULL WHERE id = ${userId}`;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM memberships WHERE user_id = ${userId} AND institution_id = ${unnId}`;
  await db`UPDATE users SET default_institution_id = NULL WHERE id = ${userId}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('AU-10', () => {
  test('signing in with two affiliations asks which, with a card for each', async ({ page }) => {
    await logIn(page);
    await page.waitForURL(/\/choose-institution/, { timeout: 30_000 });

    const unilag = page.locator('li').filter({ hasText: 'University of Lagos' });
    await expect(unilag).toContainText('You are here');
    await expect(unilag).toContainText('Student');
    await expect(unilag).toContainText('Enrolled');

    const unn = page.locator('li').filter({ hasText: 'University of Nigeria' });
    await expect(unn).toContainText('Applicant');
    await expect(unn).toContainText('Applying');
  });

  test('continuing moves the session to the other host, and back again', async ({ page }) => {
    await logIn(page);
    await page.waitForURL(/\/choose-institution/, { timeout: 30_000 });

    await page.getByRole('button', { name: /Continue to University of Nigeria/ }).click();
    await page.waitForURL(/unn\.localhost:3000\/apply/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Switch institution' })).toBeVisible();

    // The persistent switcher, from inside the other institution.
    await page.getByRole('link', { name: 'Switch institution' }).click();
    await page.waitForURL(/unn\.localhost:3000\/choose-institution/);
    await expect(page.locator('li').filter({ hasText: 'University of Nigeria' })).toContainText('You are here');
    await page.getByRole('button', { name: /Continue to University of Lagos/ }).click();
    await page.waitForURL(/unilag\.localhost:3000\/dashboard/, { timeout: 30_000 });
  });

  test('a switch token works once, and only at the institution it names', async ({ page, browser }) => {
    let switchUrl = '';
    page.on('request', (r) => {
      if (r.url().includes('/switch?token=')) switchUrl = r.url();
    });
    await logIn(page);
    await page.waitForURL(/\/choose-institution/, { timeout: 30_000 });
    await page.getByRole('button', { name: /Continue to University of Nigeria/ }).click();
    await page.waitForURL(/unn\.localhost:3000\/apply/, { timeout: 30_000 });
    expect(switchUrl).toContain('unn.localhost');

    // Replayed by a browser with no session: spent, so no session is made.
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const sp = await stranger.newPage();
    await sp.goto(switchUrl);
    await expect(sp).toHaveURL(/\/login/);
    expect((await stranger.cookies()).some((c) => c.name === 'pgd_session')).toBe(false);

    // A live, unspent token for UNN, presented at UNILAG, is refused there,
    // and the same token still works where it belongs: the refusal was the
    // host binding, not a bad token.
    const token = randomBytes(32).toString('base64url');
    const db = sql();
    await db`
      INSERT INTO auth_tokens (user_id, purpose, token_hash, institution_id, mfa_satisfied, expires_at)
      VALUES (${userId}, 'institution_switch', ${createHash('sha256').update(token).digest('hex')},
        ${unnId}, true, now() + interval '60 seconds')`;
    await db.end();
    await sp.goto(`http://unilag.localhost:3000/switch?token=${token}`);
    await expect(sp).toHaveURL(/\/login/);
    await sp.goto(`${UNN}/switch?token=${token}`);
    await expect(sp).toHaveURL(`${UNN}/apply`);
    await stranger.close();
  });

  test('a default skips the question and goes straight there', async ({ page }) => {
    await logIn(page);
    await page.waitForURL(/\/choose-institution/, { timeout: 30_000 });
    await page.getByRole('button', { name: /Set University of Nigeria.* as default/ }).click();
    await expect(page.getByText('Default saved')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('li').filter({ hasText: 'University of Nigeria' })).toContainText('Default');

    // Signing in at UNILAG now lands at UNN, without the chooser.
    await page.context().clearCookies();
    await logIn(page);
    await page.waitForURL(`${UNN}/apply`, { timeout: 30_000 });

    // And it can be undone.
    await page.goto(`${UNN}/choose-institution`);
    await page.getByRole('button', { name: /Stop using University of Nigeria.* as default/ }).click();
    await expect(page.getByText('No default')).toBeVisible({ timeout: 30_000 });
  });
});
