/**
 * SA-02 platform analytics and SA-03 feature flags.
 *
 * The two claims worth testing are the ones that would be embarrassing to get
 * wrong:
 *
 *  - SA-02 aggregates before anything leaves tenant scope (§6.3), so no
 *    candidate's name or email may appear anywhere on it however many
 *    applications it counted;
 *  - a flag actually gates the feature it names. A switch that changes nothing
 *    is worse than no switch, because it gets turned off in an incident and
 *    the feature keeps running.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PLATFORM = join(process.cwd(), '.auth', 'console-platform.json');
const STUDENT = join(process.cwd(), '.auth', 'console-student.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const MISSING = `nothing about ${RUN} exists here`;

let unilagId = '';

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

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'platform@example.ng'`;
  await db`DELETE FROM feature_flags`;
  await db`DELETE FROM feature_flag_overrides`;
  await db.end();

  const ctx = await browser.newContext({ baseURL, storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('platform@example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForURL(/\/platform/, { timeout: 30_000 });
  await ctx.storageState({ path: PLATFORM });
  await ctx.close();

  const student = await browser.newContext({ baseURL, storageState: undefined });
  const studentPage = await student.newPage();
  await studentPage.goto('/login');
  await studentPage.getByLabel(/Email address/).fill('student@unilag.example.ng');
  await studentPage.getByLabel(/^Password/).fill(PASSWORD);
  await studentPage.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await student.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  await student.storageState({ path: STUDENT });
  await student.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM feature_flags`;
  await db`DELETE FROM feature_flag_overrides`;
  await db`DELETE FROM search_events WHERE query = ${MISSING}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('SA-02 — platform analytics', () => {
  test.use({ storageState: PLATFORM });

  test('reports the funnel across institutions', async ({ page }) => {
    await page.goto('/platform/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Platform analytics' })).toBeVisible();
    await expect(page.getByText('Started an application')).toBeVisible();
    await expect(page.getByText('Payment success by channel')).toBeVisible();
  });

  test('names nobody, however many people it counted', async ({ page }) => {
    await page.goto('/platform/analytics');
    await page.waitForLoadState('networkidle');

    const html = await page.content();

    /*
     * §6.3: aggregated before it leaves tenant scope. The seeded candidates
     * and students are real rows counted by the funnel above, so if any
     * identifier reached the markup the aggregation leaked.
     */
    const db = sql();
    const people = await db`
      SELECT email, full_name FROM users
      WHERE email LIKE '%@unilag.example.ng' OR email LIKE '%@fulokoja.example.ng'`;
    await db.end();

    for (const person of people) {
      expect(html).not.toContain(person.email);
      if (person.full_name) expect(html).not.toContain(person.full_name);
    }
  });

  test('a search that finds nothing becomes a curation signal', async ({ browser, baseURL }) => {
    // LB-01 has always told readers this happens. It now does.
    const student = await browser.newContext({ baseURL, storageState: STUDENT });
    const studentPage = await student.newPage();
    await studentPage.goto(`/library?q=${encodeURIComponent(MISSING)}`);
    await expect(studentPage.getByText('Nothing matches that yet')).toBeVisible();
    await student.close();

    const db = sql();
    await expect
      .poll(
        async () => {
          const [row] =
            await db`SELECT result_count FROM search_events WHERE query = ${MISSING} LIMIT 1`;
          return row ? Number(row.result_count) : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(0);

    // And no data subject on the row: a search history on this product is a
    // record of what a named privacy professional was researching.
    const columns = await db`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'search_events'`;
    await db.end();
    expect(columns.map((c) => c.column_name)).not.toContain('user_id');
  });
});

test.describe('SA-03 — feature flags', () => {
  test.use({ storageState: PLATFORM });

  test('lists only flags the code actually branches on', async ({ page }) => {
    await page.goto('/platform/flags');
    await expect(page.getByRole('heading', { level: 1, name: 'Feature flags' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live sessions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bank transfer payments' })).toBeVisible();
  });

  test('turning one off for an institution closes the feature there', async ({
    page,
    browser,
    baseURL,
  }) => {
    // It works first — otherwise the assertion after the flip proves nothing.
    const before = await browser.newContext({ baseURL, storageState: STUDENT });
    const beforePage = await before.newPage();
    await beforePage.goto('/live');
    await expect(beforePage.getByRole('heading', { level: 1, name: 'Live sessions' })).toBeVisible();
    await before.close();

    await page.goto('/platform/flags');
    await page.waitForLoadState('networkidle');
    await page.locator(`#flag-live_sessions-${unilagId}`).selectOption('off');
    await page
      .locator(`form:has(#flag-live_sessions-${unilagId})`)
      .getByRole('button', { name: 'Apply' })
      .click();
    await expect(page.getByText(/changed/).first()).toBeVisible({ timeout: 30_000 });

    const after = await browser.newContext({ baseURL, storageState: STUDENT });
    const afterPage = await after.newPage();
    await afterPage.goto('/live');
    // Not a 404: the feature exists and has been switched off, and saying
    // "not found" sends a student to support with an unreproducible bug.
    await expect(afterPage.getByText(/has this turned off/)).toBeVisible();
    await after.close();
  });

  test('and the platform switch overrides what an institution chose', async ({ page }) => {
    await page.goto('/platform/flags');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: /Turn bank transfer payments off everywhere/ })
      .click();
    await expect(page.getByText('Something is switched off platform-wide')).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT enabled, changed_by FROM feature_flags WHERE key = 'offline_payments'`;
    const [entry] = await db`
      SELECT detail FROM audit_log WHERE action = 'flag.disabled' ORDER BY created_at DESC LIMIT 1`;
    await db.end();

    expect(row.enabled).toBe(false);
    // A flag flip is a deploy without a commit, so the log is the only record
    // it leaves: who, which flag, and what it was before.
    expect(row.changed_by).toBeTruthy();
    expect(entry.detail).toMatchObject({ flag: 'offline_payments', to: false });
  });

  test('a flag the code has never heard of is refused', async ({ page }) => {
    await page.goto('/platform/flags');
    await page.waitForLoadState('networkidle');

    await page.locator(`#flag-live_sessions-${unilagId}`).evaluate((el) => {
      (el as HTMLSelectElement).name = 'value';
    });
    await page.locator(`form:has(#flag-live_sessions-${unilagId})`).evaluate((form) => {
      const input = form.querySelector('input[name="key"]') as HTMLInputElement;
      input.value = 'invented_flag';
    });
    await page
      .locator(`form:has(#flag-live_sessions-${unilagId})`)
      .getByRole('button', { name: 'Apply' })
      .click();

    await expect(page.getByText(/not a flag this product has/)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT count(*)::int AS n FROM feature_flag_overrides WHERE key = 'invented_flag'`;
    await db.end();
    expect(row.n).toBe(0);
  });
});
