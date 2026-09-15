/**
 * IA-02 programme & module setup — LRN-01.
 *
 * Nothing in the application could create a module before this screen: the
 * seed made them and a real institution had no way to. So the tests are about
 * the structure actually being created, and about the two refusals that keep
 * the screen honest — a module code cannot repeat, and a module somebody has
 * taught in cannot be deleted out from under the grades attached to it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const ADMIN = join(process.cwd(), '.auth', 'programme-admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const CODE = `DPP ${String(RUN).slice(-3)}`;
const TITLE = `Cross-border transfers ${RUN}`;

let unilagId = '';
let programmeId = '';
let previous: { entry: string | null; bands: unknown } = { entry: null, bands: null };

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
  const [inst] = await db`SELECT id FROM institutions WHERE slug = 'unilag'`;
  unilagId = inst.id;
  const [prog] = await db`
    SELECT id, entry_requirements, grading_bands FROM programmes WHERE institution_id = ${unilagId}`;
  programmeId = prog.id;
  previous = { entry: prog.entry_requirements, bands: prog.grading_bands };
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  const ctx = await browser.newContext({ baseURL, storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await ctx.storageState({ path: ADMIN });
  await ctx.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM modules WHERE programme_id = ${programmeId} AND code LIKE ${'DPP ' + String(RUN).slice(-3) + '%'}`;
  await db`
    UPDATE programmes
    SET entry_requirements = ${previous.entry}, grading_bands = ${db.json(previous.bands as never)}
    WHERE id = ${programmeId}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('IA-02 — the structure of the programme', () => {
  test.use({ storageState: ADMIN });

  test('lists the modules by semester', async ({ page }) => {
    await page.goto('/admin/programme');
    await expect(page.getByRole('heading', { level: 1, name: 'The programme' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Semester 1/ })).toBeVisible();
  });

  test('a module can be added, and starts unpublished', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    await page.locator('#module-code').fill(CODE);
    await page.locator('#module-title').fill(TITLE);
    await page.locator('#module-semester').fill('2');
    await page.getByRole('button', { name: 'Add the module' }).click();

    await expect(page.getByText(`${CODE} added`)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT published, semester, title FROM modules
      WHERE programme_id = ${programmeId} AND code = ${CODE}`;
    await db.end();

    expect(row.title).toBe(TITLE);
    expect(row.semester).toBe(2);
    // Publishing belongs to the facilitator at FC-02, once there is something
    // inside. An administrator creating a module must not put an empty one on
    // every student's list.
    expect(row.published).toBe(false);
  });

  test('the same code cannot be used twice', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    // Spaced differently on purpose: DPP-501 and DPP 501 are the same module
    // to everyone except a string comparison.
    await page.locator('#module-code').fill(CODE.replace(' ', '-'));
    await page.locator('#module-title').fill('A duplicate by another name');
    await page.getByRole('button', { name: 'Add the module' }).click();

    await expect(page.getByText(/already exists/)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT count(*)::int AS n FROM modules
      WHERE programme_id = ${programmeId} AND title = 'A duplicate by another name'`;
    await db.end();
    expect(row.n).toBe(0);
  });

  test('a module that has been taught in cannot be deleted', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    // The seeded modules have lessons and grades behind them. The control is
    // that the remove button is not offered for them at all — deleting one
    // would cascade to the grades hanging off its assessments.
    const seeded = page.locator('li').filter({ hasText: 'DPP-101' }).first();
    await expect(seeded).toBeVisible();
    await expect(seeded.getByRole('button', { name: 'Remove' })).toHaveCount(0);

    // The new one is empty, so it is removable.
    const fresh = page.locator('li').filter({ hasText: CODE }).first();
    await expect(fresh.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  test('entry requirements are what a candidate reads, so they are required', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    await page.locator('#programme-entry').fill('Too short');
    await page.getByRole('button', { name: 'Save the programme' }).click();
    await expect(page.getByText(/before paying an application fee/).first()).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT entry_requirements FROM programmes WHERE id = ${programmeId}`;
    await db.end();
    expect(row.entry_requirements).not.toBe('Too short');
  });
});

test.describe('IA-02 — the grading scheme', () => {
  test.use({ storageState: ADMIN });

  test('two bands cannot start at the same mark', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    // Merit already starts at 60. Making Pass start there too is not a
    // duplicate to be cleaned up — it is two words for the same score.
    await page.locator('#band-min-2').fill('60');
    await page.getByRole('button', { name: 'Save the scheme' }).click();

    await expect(page.getByText(/both start at 60%/)).toBeVisible({ timeout: 30_000 });
  });

  test('a saved scheme is what a student’s result is read through', async ({ page }) => {
    await page.goto('/admin/programme');
    await page.waitForLoadState('networkidle');

    await page.locator('#band-label-0').fill('First class');
    await page.locator('#band-min-0').fill('75');
    await page.getByRole('button', { name: 'Save the scheme' }).click();
    await expect(page.getByText('Grading scheme saved')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT grading_bands FROM programmes WHERE id = ${programmeId}`;
    await db.end();

    const bands = row.grading_bands as { minPercent: number; label: string }[];
    // Stored highest first, whatever order the form was in.
    expect(bands[0]).toMatchObject({ label: 'First class', minPercent: 75 });
    expect(bands.map((b) => b.minPercent)).toEqual([...bands.map((b) => b.minPercent)].sort((a, b) => b - a));
  });
});
