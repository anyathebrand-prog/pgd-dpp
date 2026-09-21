/**
 * RG-05 cohort capacity and RG-06 applicant export — two P1 screens that were
 * missing, one of them behind a link already on the page.
 *
 * The export is tested for what matters about an export: it needs a stated
 * purpose, it is on the audit record, it contains exactly the view it was
 * taken from, and a value an applicant typed cannot run as a formula when the
 * registrar opens the file.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const REGISTRY = join(process.cwd(), '.auth', 'p1-registry.json');
const PASSWORD = 'Passw0rd-seed-2026';
const SECRET = 'KRUGS4ZANFZSAYJAORSXG5A2KRUGS4ZA';
const RUN = Date.now();

const INJECTED = `=HYPERLINK("http://evil.example","Click ${RUN}")`;
const COHORT = `Capacity test intake ${RUN}`;

let unilagId = '';
let cohortId = '';
const userIds: string[] = [];

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
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  const [programme] = await db`SELECT id FROM programmes WHERE institution_id = ${unilagId} LIMIT 1`;

  // A two-seat intake, so capacity states are reachable with a few rows.
  const [cohort] = await db`
    INSERT INTO cohorts (institution_id, programme_id, name, capacity, status)
    VALUES (${unilagId}, ${programme.id}, ${COHORT}, 2, 'open') RETURNING id`;
  cohortId = cohort.id;

  // Four applicants: one submitted with a hostile name, and three holding or
  // having held a seat.
  for (const [name, status] of [
    [INJECTED, 'submitted'],
    [`Offered ${RUN}`, 'admitted'],
    [`Enrolled ${RUN}`, 'enrolled'],
    [`Lapsed ${RUN}`, 'offer_lapsed'],
  ] as const) {
    const [u] = await db`
      INSERT INTO users (email, full_name, status, email_verified_at)
      VALUES (${`p1-${randomUUID()}@example.ng`}, ${name}, 'candidate', now()) RETURNING id`;
    userIds.push(u.id);
    await db`
      INSERT INTO applications (institution_id, cohort_id, user_id, reference, status, submitted_at)
      VALUES (${unilagId}, ${cohortId}, ${u.id}, ${`P1-${randomUUID().slice(0, 8)}`}, ${status}, now())`;
  }

  await db`UPDATE users SET totp_secret = ${SECRET}, totp_confirmed_at = now() WHERE email = 'registry@unilag.example.ng'`;
  await db.end();

  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('registry@unilag.example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
  await page.locator('#code').fill(totpFor(SECRET));
  await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await context.storageState({ path: REGISTRY });
  await context.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM applications WHERE cohort_id = ${cohortId}`;
  await db`DELETE FROM cohorts WHERE id = ${cohortId}`;
  if (userIds.length) await db`DELETE FROM users WHERE id IN ${db(userIds)}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('RG-01 filter', () => {
  test.use({ storageState: REGISTRY });

  test('"Everything" shows everything, not just what needs action', async ({ page }) => {
    // It used to fall through to the needs-action branch.
    await page.goto('/admin/applications?status=all');
    await expect(page.getByText(`Enrolled ${RUN}`)).toBeVisible();
  });
});

test.describe('RG-05 cohort capacity', () => {
  test.use({ storageState: REGISTRY });

  test('counts seats the way offer issuance does', async ({ page }) => {
    await page.goto(`/admin/cohorts/${cohortId}`);
    await expect(page.getByRole('heading', { level: 1, name: COHORT })).toBeVisible();
    // Offered and enrolled each hold a seat in a two-seat intake: full.
    // The lapsed offer holds none.
    await expect(page.getByText('The intake is full')).toBeVisible();
    await expect(page.getByText(/2 of 2/)).toBeVisible();
  });

  test('says loudly when more people hold a seat than exist', async ({ page }) => {
    const db = sql();
    await db`UPDATE cohorts SET capacity = 1 WHERE id = ${cohortId}`;
    await db.end();

    await page.goto(`/admin/cohorts/${cohortId}`);
    // Not a softer shade of full: somebody who accepted a place has none.
    await expect(page.getByText('More people hold a seat than the intake has')).toBeVisible();

    const reset = sql();
    await reset`UPDATE cohorts SET capacity = 2 WHERE id = ${cohortId}`;
    await reset.end();
  });
});

test.describe('RG-06 applicant export', () => {
  test.use({ storageState: REGISTRY });

  test('the link on the queue goes somewhere now, carrying the view', async ({ page }) => {
    await page.goto('/admin/applications?status=all');
    await page.getByRole('link', { name: 'Export this view as CSV' }).click();
    await expect(page).toHaveURL(/\/admin\/applications\/export\?status=all/);
    await expect(page.getByRole('heading', { level: 1, name: 'Export applicants' })).toBeVisible();
  });

  test('refuses to export without a stated purpose', async ({ page }) => {
    await page.goto('/admin/applications/export?status=all');
    await page.locator('#export-purpose').selectOption('registry_reporting');
    await page.locator('#export-note').fill('short');
    await page.getByRole('button', { name: 'Download the CSV' }).click();
    await expect(page.getByText(/Say who it is for/)).toBeVisible({ timeout: 30_000 });
  });

  test('produces a file that is safe to open, and is on the audit record', async ({ page }) => {
    await page.goto('/admin/applications/export?status=all');
    await page.locator('#export-purpose').selectOption('accreditation_return');
    await page.locator('#export-note').fill(`Annual return to the accrediting body ${RUN}`);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download the CSV' }).click(),
    ]);
    const path = await download.path();
    const csv = readFileSync(path!, 'utf8');

    // The hostile name is in the file, and defused: a leading quote makes a
    // spreadsheet show it as text instead of running it.
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/(^|,|")=HYPERLINK/m);
    // Exactly the view: everything, including the enrolled applicant.
    expect(csv).toContain(`Enrolled ${RUN}`);
    // No documents: minimisation, and gap G-17 decided.
    expect(csv.split('\r\n')[0]).not.toMatch(/document|photo|birth/i);

    const db = sql();
    const [entry] = await db`
      SELECT detail FROM audit_log
      WHERE action = 'applications.exported' AND detail->>'note' = ${`Annual return to the accrediting body ${RUN}`}
      LIMIT 1`;
    await db.end();
    expect(entry.detail).toMatchObject({ purpose: 'accreditation_return', status: 'all' });
    expect(Number(entry.detail.rows)).toBeGreaterThanOrEqual(4);
  });
});
