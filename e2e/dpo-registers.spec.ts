/**
 * DP-04 SNAG, DP-05 breach register, DP-06 consent records.
 *
 * CMP-08 and CMP-09 are both Musts, and both are evidence a regulator asks for
 * without notice. The claims tested are the ones that would embarrass the DPO
 * in front of the Commission: the 72-hour clock reads correctly and cannot be
 * closed out without a notification on record; the scoping answer is a real
 * count; a SNAG cannot be answered without taking a position; and consent
 * records cannot be edited by the person reading them.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const DPO = join(process.cwd(), '.auth', 'registers-dpo.json');
const PASSWORD = 'Passw0rd-seed-2026';
const SECRET = 'KRUGS4ZANFZSAYJAORSXG5A2KRUGS4ZA';
const RUN = Date.now();

const DUE_SOON = `Laptop left in a taxi ${RUN}`;
const OVERDUE = `Misdirected email ${RUN}`;
const SUBJECT = `Grievance Subject ${RUN}`;

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

/** A datetime-local value, in the same local time the server parses it in. */
function localAgo(hours: number) {
  const d = new Date(Date.now() - hours * 3_600_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  await db`UPDATE users SET totp_secret = ${SECRET}, totp_confirmed_at = now() WHERE email = 'dpo@example.ng'`;
  await db.end();

  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('dpo@example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/login\/2fa/, { timeout: 30_000 });
  await page.locator('#code').fill(totpFor(SECRET));
  await page.getByRole('button', { name: /Verify|Continue|Confirm/ }).click();
  await page.waitForURL(/\/dpo/, { timeout: 30_000 });
  await context.storageState({ path: DPO });
  await context.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM breaches WHERE title IN (${DUE_SOON}, ${OVERDUE})`;
  await db`DELETE FROM grievance_notices WHERE subject_name = ${SUBJECT}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

async function logBreach(page: import('@playwright/test').Page, title: string, hoursAgo: number) {
  await page.goto('/dpo/breaches');
  await page.waitForLoadState('networkidle');
  await page.locator('#breach-title').fill(title);
  await page.locator('#breach-discovered').fill(localAgo(hoursAgo));
  await page.locator('#breach-severity').selectOption('high');
  await page.locator('#breach-inst').selectOption(unilagId);
  await page.locator('#breach-description').fill('Records for a cohort were exposed; details below.');
  await page.getByRole('button', { name: 'Log it and start the clock' }).click();
  await expect(page.getByText('Breach logged')).toBeVisible({ timeout: 30_000 });
}

test.describe('DP-05 the breach register', () => {
  test.use({ storageState: DPO });

  test('the clock runs from discovery, not from logging', async ({ page }) => {
    // Found 70 hours ago and only logged now: two hours left, not seventy-two.
    await logBreach(page, DUE_SOON, 70);
    const card = page.locator('li').filter({ hasText: DUE_SOON }).first();
    await expect(card).toContainText(/^.*[12]h \d+m left/s);
  });

  test('an unnotified breach past 72 hours is impossible to miss', async ({ page }) => {
    await logBreach(page, OVERDUE, 80);
    await expect(page.getByText(/past the 72-hour deadline/).first()).toBeVisible();
    const card = page.locator('li').filter({ hasText: OVERDUE }).first();
    await expect(card).toContainText(/overdue/);
  });

  test('cannot be closed until the Commission notification is on record', async ({ page }) => {
    await page.goto('/dpo/breaches');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: OVERDUE }).first();
    await card.getByRole('button', { name: 'Close the breach' }).click();
    await expect(page.getByText(/looks, to an auditor, like one that was never reported/)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT status FROM breaches WHERE title = ${OVERDUE}`;
    await db.end();
    expect(row.status).not.toBe('closed');
  });

  test('a late notification is recorded as late', async ({ page }) => {
    await page.goto('/dpo/breaches');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: OVERDUE }).first();
    await card.getByRole('button', { name: 'Record: Commission notified' }).click();
    await expect(page.getByText('Register updated')).toBeVisible({ timeout: 30_000 });

    const updated = page.locator('li').filter({ hasText: OVERDUE }).first();
    await expect(updated).toContainText('Notified late');
  });

  test('scoping counts the distinct people whose records were touched', async ({ page }) => {
    // Three reads of two people's records, in a window nothing else occupies.
    const a = randomUUID();
    const b = randomUUID();
    const db = sql();
    for (const [subject, at] of [
      [a, '2001-03-01T10:00:00Z'],
      [a, '2001-03-01T11:00:00Z'],
      [b, '2001-03-01T12:00:00Z'],
    ] as const) {
      await db`
        INSERT INTO audit_log (institution_id, action, subject_id, created_at)
        VALUES (${unilagId}, 'document.viewed', ${subject}, ${at})`;
    }
    await db.end();

    await page.goto('/dpo/breaches');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: DUE_SOON }).first();
    await card.getByText('Scope the affected data subjects').click();
    await card.locator('input[name="from"]').fill('2001-03-01T00:00');
    await card.locator('input[name="to"]').fill('2001-03-02T00:00');
    await card.getByRole('button', { name: 'Count the subjects in scope' }).click();

    // Two people, not three events.
    await expect(page.getByText('2 data subjects in scope')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('DP-04 grievance notices', () => {
  test.use({ storageState: DPO });

  test('a notice is logged and waits for a response', async ({ page }) => {
    await page.goto('/dpo/snag');
    await page.waitForLoadState('networkidle');
    await page.locator('#snag-name').fill(SUBJECT);
    await page.locator('#snag-email').fill(`snag-${RUN}@example.ng`);
    await page.locator('#snag-received').fill(localAgo(24));
    await page.locator('#snag-inst').selectOption(unilagId);
    await page.locator('#snag-grievance').fill('My transcript was shared with a third party without my consent.');
    await page.getByRole('button', { name: 'Log the notice' }).click();
    await expect(page.getByText('Notice logged')).toBeVisible({ timeout: 30_000 });
  });

  test('accepting a violation without stating a remedy is refused', async ({ page }) => {
    await page.goto('/dpo/snag');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: SUBJECT }).first();
    await card.locator('select[name="responseType"]').selectOption('accepted_violation');
    await card
      .locator('textarea[name="responseText"]')
      .fill('We have reviewed your notice and confirm the transcript was shared in error with a sponsor.');
    await card.getByRole('button', { name: 'Record the response' }).click();

    // "Substantively" is the whole requirement. Accepting a violation means
    // saying what is being done about it.
    await expect(page.getByText(/Describe the remedy/)).toBeVisible({ timeout: 30_000 });
  });

  test('with the remedy stated, and the outcome recorded as an escalation', async ({ page }) => {
    await page.goto('/dpo/snag');
    await page.waitForLoadState('networkidle');
    const card = page.locator('li').filter({ hasText: SUBJECT }).first();
    await card.locator('select[name="responseType"]').selectOption('accepted_violation');
    await card
      .locator('textarea[name="responseText"]')
      .fill('We have reviewed your notice and confirm the transcript was shared in error with a sponsor.');
    await card
      .locator('textarea[name="remedialAction"]')
      .fill('The sponsor has confirmed deletion and staff access to transcripts now requires a second approver.');
    await card.getByRole('button', { name: 'Record the response' }).click();
    await expect(page.getByText('Response recorded')).toBeVisible({ timeout: 30_000 });

    const answered = page.locator('li').filter({ hasText: SUBJECT }).first();
    await answered.locator('select[name="outcome"]').selectOption('escalated_ndpc');
    await answered.locator('textarea[name="outcomeNote"]').fill('Subject escalated despite the remedy.');
    await answered.getByRole('button', { name: 'Record the outcome' }).click();
    await expect(page.getByText('Outcome recorded')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT status, response_type, remedial_action, outcome FROM grievance_notices WHERE subject_name = ${SUBJECT}`;
    await db.end();
    expect(row).toMatchObject({
      status: 'closed',
      response_type: 'accepted_violation',
      outcome: 'escalated_ndpc',
    });
    expect(row.remedial_action).toContain('second approver');
  });
});

test.describe('DP-06 consent records', () => {
  test.use({ storageState: DPO });

  test('shows each decision with its notice version and wording, and offers no way to edit one', async ({
    page,
  }) => {
    await page.goto('/dpo/consents');
    await expect(page.getByRole('heading', { level: 1, name: 'Consent records' })).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toContainText(/v\d+/);

    // A consent a DPO could change would prove nothing about the person's
    // own choice.
    await expect(page.locator('table').getByRole('button')).toHaveCount(0);
    await expect(page.locator('table input, table textarea')).toHaveCount(0);
  });
});
