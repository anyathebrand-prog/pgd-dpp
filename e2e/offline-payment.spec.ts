/**
 * PAY-11 — PY-06 and IA-09, the bank-transfer path.
 *
 * §5.2 calls this how a great many Nigerian sponsors actually pay, so the
 * journey worth testing is the whole of it: a candidate who owes an
 * application fee sends a transfer, uploads the evidence, and an institution
 * admin approves it — after which the application has to be in exactly the
 * state a card payment would have left it in.
 *
 * The assertion that carries the requirement is the last one. IA-09 says
 * approval "moves the application forward exactly as a webhook would", and
 * that is a claim about the database, not about the screen.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const ADMIN_STATE = join(process.cwd(), '.auth', 'offline-admin.json');
const PAYER_STATE = join(process.cwd(), '.auth', 'offline-payer.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const payer = `transfer-payer-${RUN}@example.ng`;
const reference = `PGD-OFFLINE-${RUN}`;
const PROOF = join(process.cwd(), '.auth', `proof-${RUN}.pdf`);

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

/** What an authenticator app would show for this secret, right now. */
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

let applicationId = '';

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  // A minimal but genuine PDF, so the upload is exercised rather than mocked.
  writeFileSync(PROOF, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  const db = sql();
  const [inst] = await db`SELECT id FROM institutions WHERE slug = 'unilag'`;
  const [cohort] = await db`SELECT id FROM cohorts WHERE institution_id = ${inst.id} LIMIT 1`;

  // A candidate who owes an application fee: the state PY-06 is reached from.
  const hash = (
    await db`SELECT password_hash FROM users WHERE email = 'student@unilag.example.ng'`
  )[0].password_hash;
  const [u] = await db`
    INSERT INTO users (email, full_name, status, email_verified_at, password_hash)
    VALUES (${payer}, 'Sponsored Candidate', 'candidate', now(), ${hash}) RETURNING id`;
  await db`INSERT INTO memberships (user_id, institution_id, role) VALUES (${u.id}, ${inst.id}, 'candidate')`;
  const [app] = await db`
    INSERT INTO applications (institution_id, user_id, cohort_id, reference, status)
    VALUES (${inst.id}, ${u.id}, ${cohort.id}, ${'APP-OFF-' + RUN}, 'awaiting_application_fee')
    RETURNING id`;
  applicationId = app.id;
  await db`
    INSERT INTO transactions (institution_id, user_id, application_id, reference, context, amount_kobo, status)
    VALUES (${inst.id}, ${u.id}, ${app.id}, ${reference}, 'application', 2500000, 'pending')`;

  // The admin is TOTP-enrolled by the seed; reset so enrolment runs here.
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  // Sign the payer in.
  const payerContext = await browser.newContext({ baseURL, storageState: undefined });
  const payerPage = await payerContext.newPage();
  await payerPage.goto('/login');
  await payerPage.getByLabel(/Email address/).fill(payer);
  await payerPage.getByLabel(/^Password/).fill(PASSWORD);
  await payerPage.getByRole('button', { name: 'Log in' }).click();
  await payerPage.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });
  await payerContext.storageState({ path: PAYER_STATE });
  await payerContext.close();

  // And the admin, through the second factor AUTH-08 requires of the role.
  const adminContext = await browser.newContext({ baseURL, storageState: undefined });
  const adminPage = await adminContext.newPage();
  await adminPage.goto('/login');
  await adminPage.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await adminPage.getByLabel(/^Password/).fill(PASSWORD);
  await adminPage.getByRole('button', { name: 'Log in' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  await adminPage.waitForLoadState('networkidle');
  const secret = (await adminPage.locator('p.t-data').first().textContent())!.trim();
  await adminPage.locator('#code').fill(await currentTotp(secret));
  await adminPage.getByRole('button', { name: 'Confirm and continue' }).click();
  await adminPage.waitForURL(/\/admin/, { timeout: 30_000 });
  await adminContext.storageState({ path: ADMIN_STATE });
  await adminContext.close();
});

test.afterAll(async () => {
  if (!applicationId) return;
  const db = sql();
  await db`DELETE FROM enrollments WHERE user_id IN (SELECT id FROM users WHERE email = ${payer})`;
  await db`DELETE FROM documents WHERE application_id = ${applicationId}`;
  await db`DELETE FROM transactions WHERE reference = ${reference}`;
  await db`DELETE FROM applications WHERE id = ${applicationId}`;
  await db`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ${payer})`;
  await db`DELETE FROM users WHERE email = ${payer}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a sponsor pays by transfer', () => {
  test.use({ storageState: PAYER_STATE });

  test('the page gives the account details and the reference to quote', async ({ page }) => {
    await page.goto(`/pay/offline?ref=${reference}`);
    await expect(page.getByRole('heading', { name: 'Pay by bank transfer' })).toBeVisible();

    await expect(page.getByText('First Bank of Nigeria')).toBeVisible();
    await expect(page.getByText('2031457789')).toBeVisible();
    // The reference is the whole reason a transfer can be attributed at all.
    await expect(page.getByText(reference).first()).toBeVisible();
    await expect(page.getByText(/cannot be matched to you/)).toBeVisible();
  });

  test('proof is uploaded and the payment moves to awaiting approval', async ({ page }) => {
    await page.goto(`/pay/offline?ref=${reference}`);
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Name on the account/).fill('Zenith Compliance Ltd');
    await page.locator('#paidOn').fill('2026-09-10');
    await page.locator('#file').setInputFiles(PROOF);
    await page.getByRole('button', { name: 'Submit proof of payment' }).click();

    await expect(page.getByText('With the institution for approval')).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT status, channel FROM transactions WHERE reference = ${reference}`;
    await db.end();
    expect(row.status).toBe('awaiting_approval');
    expect(row.channel).toBe('offline_transfer');
  });
});

test.describe('and the institution approves it', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the queue shows who sent it, for how much, and what they sent', async ({ page }) => {
    await page.goto('/admin/payments/offline');
    await expect(page.getByRole('heading', { name: 'Offline payments' })).toBeVisible();

    await expect(page.getByText('Sponsored Candidate — application fee')).toBeVisible();
    await expect(page.getByText('Zenith Compliance Ltd')).toBeVisible();
    // The rule that keeps this queue from being a fraud route with a UI.
    await expect(page.getByText('Check the bank statement, not the attachment')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open what the payer sent/ })).toBeVisible();
  });

  test('approval needs a note saying what it was matched against', async ({ page }) => {
    await page.goto('/admin/payments/offline');
    await page.waitForLoadState('networkidle');

    const note = page.getByLabel(/What you matched it against/);
    await page.getByRole('button', { name: `Approve ${reference}` }).click();

    // The browser stops it before the request is made, which is the right
    // place for it — the action guards the same rule server-side, but nobody
    // should need a round trip to be told a required field is empty.
    await expect(note).toHaveJSProperty('validity.valid', false);
    await expect(page.getByText(`${reference} approved and settled.`)).toHaveCount(0);

    const db = sql();
    const [row] = await db`SELECT status FROM transactions WHERE reference = ${reference}`;
    await db.end();
    expect(row.status).toBe('awaiting_approval');
  });

  test('and approving moves the application forward exactly as a webhook would', async ({
    page,
  }) => {
    await page.goto('/admin/payments/offline');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/What you matched it against/).fill('Statement line 0912/4471');
    await page.getByRole('button', { name: `Approve ${reference}` }).click();

    // The confirmation is rendered by the page above the queue, not inside the
    // row — the row leaves the queue on approval, and a message that unmounts
    // with it would tell the admin nothing.
    await expect(page.getByText(`${reference} approved and settled.`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/approved=/);

    const db = sql();
    const [txn] = await db`SELECT status, paid_at FROM transactions WHERE reference = ${reference}`;
    const [app] = await db`SELECT status, submitted_at FROM applications WHERE id = ${applicationId}`;
    const [entry] = await db`
      SELECT actor_role, actor_id FROM audit_log
      WHERE action = 'payment.settled'
        AND entity_id = (SELECT id::text FROM transactions WHERE reference = ${reference})`;
    await db.end();

    expect(txn.status).toBe('success');
    expect(txn.paid_at).toBeTruthy();
    // The application is in the registry queue, which is what the fee buys.
    expect(app.status).toBe('submitted');
    expect(app.submitted_at).toBeTruthy();
    // And the audit entry names a person rather than `system:webhook`, which
    // is the one thing that should differ from the card path.
    expect(entry.actor_role).toBe('institution_admin');
    expect(entry.actor_id).toBeTruthy();
  });
});
