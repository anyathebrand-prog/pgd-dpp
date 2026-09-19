/**
 * PAY-07, APP-10, LRN-08 — the three documents this platform issues, as PDFs.
 *
 * The point worth testing is not that a file downloads: it is that the file is
 * a real PDF rendered from the page a reader can see, and that it cannot be
 * fetched by someone the page itself would refuse. A renderer running with
 * elevated rights would turn "know the URL" into "read anyone's certificate",
 * which is the failure mode this design exists to avoid.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STATE = join(process.cwd(), '.auth', 'documents.json');
const PASSWORD = 'Passw0rd-seed-2026';
const STUDENT = 'student@unilag.example.ng';
const RUN = Date.now();

let reference = '';
let certificateCode = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeAll(async ({ browser, baseURL }) => {
  const db = sql();
  const [inst] = await db`SELECT id FROM institutions WHERE slug = 'unilag'`;
  const [user] = await db`SELECT id FROM users WHERE email = ${STUDENT}`;
  const [enrolment] = await db`
    SELECT id, matric_number FROM enrollments WHERE user_id = ${user.id} LIMIT 1`;

  // A settled payment to take a receipt from, and a certificate to print.
  reference = `PGD-DOC-${RUN}`;
  await db`
    INSERT INTO transactions (institution_id, user_id, reference, context, amount_kobo, status, paid_at)
    VALUES (${inst.id}, ${user.id}, ${reference}, 'tuition', 51500000, 'success', now())`;

  certificateCode = `DOC${RUN}`.slice(0, 12).toUpperCase();
  await db`
    INSERT INTO certificates (institution_id, enrollment_id, kind, verification_code, holder_name, programme_title)
    VALUES (${inst.id}, ${enrolment.id}, 'completion', ${certificateCode}, 'Kelechi Obi',
            'Post Graduate Diploma in Data Protection & Privacy')`;
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

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM certificates WHERE verification_code = ${certificateCode}`;
  await db`DELETE FROM transactions WHERE reference = ${reference}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('documents this platform issues', () => {
  test.use({ storageState: STATE });

  test('the receipt page carries what an employer reimbursing you needs', async ({ page }) => {
    await page.goto(`/billing/receipt/${reference}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Receipt' })).toBeVisible();

    await expect(page.getByText('University of Lagos').first()).toBeVisible();
    await expect(page.getByText(reference)).toBeVisible();
    await expect(page.getByRole('row', { name: /Total paid/ })).toContainText('₦515,000');
  });

  test('and downloads as a real PDF', async ({ page }) => {
    await page.goto(`/billing/receipt/${reference}`);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('link', { name: 'Download as PDF' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe(`receipt-${reference}.pdf`);
    const path = await file.path();
    // Not "a file arrived" — a file whose first bytes say PDF. A 503 saved to
    // disk would pass a laxer assertion.
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('a certificate prints from the page an employer can verify', async ({ page }) => {
    await page.goto(`/certificates/${certificateCode}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Certificate of completion' }),
    ).toBeVisible();
    await expect(page.getByText('Kelechi Obi')).toBeVisible();
    await expect(page.getByText(certificateCode).first()).toBeVisible();

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('link', { name: 'Download as PDF' }).click();
    const file = await download;
    expect(readFileSync(await file.path()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('someone else cannot fetch it by knowing the code', async ({ browser, baseURL }) => {
    // The renderer runs as the requester, so an unauthenticated fetch must
    // produce no document rather than a PDF of someone else's certificate.
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/verify');
    // fetch() from inside the page rather than a navigation or an API request:
    // navigating to a PDF starts a download, which Playwright reports as an
    // error, and Node cannot resolve *.localhost the way Chromium can.
    const type = await page.evaluate(async (code) => {
      const res = await fetch(`/api/pdf/certificate/${code}`);
      return res.headers.get('content-type') ?? '';
    }, certificateCode);
    expect(type).not.toContain('application/pdf');
    await context.close();
  });

  test('and a signed-in stranger gets nothing either', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill('candidate@unilag.example.ng');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    // The page 404s for anyone but the holder, so the render fails and the
    // route says so rather than returning a document.
    const result = await page.evaluate(async (code) => {
      const res = await fetch(`/api/pdf/certificate/${code}`);
      return { status: res.status, type: res.headers.get('content-type') ?? '' };
    }, certificateCode);
    expect(result.type).not.toContain('application/pdf');
    expect(result.status).toBe(503);
    await context.close();
  });
});
