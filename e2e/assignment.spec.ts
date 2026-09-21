/**
 * ST-07 — file-upload assignments, end to end.
 *
 * The student attaches, checks and submits; a disguised executable is
 * refused by its bytes; a submission after the deadline is flagged for the
 * facilitator; a return for revision reopens it, and the resubmission leaves
 * both files in the history.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STUDENT = join(process.cwd(), '.auth', 'assignment-student.json');
const FACILITATOR = join(process.cwd(), '.auth', 'assignment-facilitator.json');
const PASSWORD = 'Passw0rd-seed-2026';
const TITLE = `E2E assignment ${Date.now()}`;

let assignmentId = '';

const PDF = (text: string) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${text}\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

/**
 * Fetched from inside the page, as the video spec does: Node does not resolve
 * `*.localhost` here, and the browser does, with the session cookie attached.
 */
async function fetchIn(page: import('@playwright/test').Page, href: string) {
  return page.evaluate(async (url) => {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      status: res.status,
      disposition: res.headers.get('content-disposition') ?? '',
      head: String.fromCharCode(...bytes.slice(0, 5)),
    };
  }, href);
}

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function signIn(browser: import('@playwright/test').Browser, baseURL: string | undefined, email: string, path: string) {
  const ctx = await browser.newContext({ baseURL, storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await ctx.cookies()).some((c) => c.name === 'pgd_session'), { timeout: 30_000 })
    .toBe(true);
  await ctx.storageState({ path });
  await ctx.close();
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const db = sql();
  const [mod] = await db`
    SELECT m.id, m.institution_id FROM modules m
    JOIN institutions i ON i.id = m.institution_id
    WHERE i.slug = 'unilag' AND m.published ORDER BY m.position LIMIT 1`;
  // Due yesterday, so the submission below is late by construction.
  const [row] = await db`
    INSERT INTO assessments (institution_id, module_id, title, kind, instructions, published, closes_at)
    VALUES (${mod.institution_id}, ${mod.id}, ${TITLE}, 'assignment',
      'Write 1,500 words on the lawful basis for processing student records.', true, now() - interval '1 day')
    RETURNING id`;
  assignmentId = row.id;
  await db.end();

  await signIn(browser, baseURL, 'student@unilag.example.ng', STUDENT);
  await signIn(browser, baseURL, 'facilitator@unilag.example.ng', FACILITATOR);
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM assessments WHERE title = ${TITLE}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('ST-07', () => {
  test('an assessment link that is an assignment lands on the assignment', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: STUDENT });
    const page = await ctx.newPage();
    await page.goto(`/assessment/${assignmentId}`);
    await expect(page).toHaveURL(new RegExp(`/assignment/${assignmentId}`));
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByText('Not started')).toBeVisible();
    await ctx.close();
  });

  test('a program renamed to .pdf is refused by what it contains', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: STUDENT });
    const page = await ctx.newPage();
    await page.goto(`/assignment/${assignmentId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('#file').setInputFiles({
      name: 'essay.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    });
    await page.getByRole('button', { name: 'Attach file' }).click();
    await expect(page.getByText(/Upload a PDF or a Word/)).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });

  test('attach, check, then submit; late is flagged', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: STUDENT });
    const page = await ctx.newPage();
    await page.goto(`/assignment/${assignmentId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/The deadline has passed/)).toBeVisible();

    await page.locator('#file').setInputFiles({ name: 'essay-v1.pdf', mimeType: 'application/pdf', buffer: PDF('v1') });
    await page.getByRole('button', { name: 'Attach file' }).click();
    await expect(page.getByText('File attached, not yet submitted')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Draft, not yet submitted')).toBeVisible();
    await expect(page.getByText(/not submitted$/)).toHaveCount(1);

    // The student can open what they attached before sending it.
    const href = await page.getByRole('link', { name: 'Open what you attached' }).getAttribute('href');
    const res = await fetchIn(page, href!);
    expect(res.status).toBe(200);
    expect(res.head).toBe('%PDF-');

    await page.getByRole('button', { name: 'Submit to my facilitator' }).click();
    await expect(page.getByText(/arrived after the deadline and is marked as late/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Submitted late')).toBeVisible();
    // Nothing to change now: the upload control has gone.
    await expect(page.locator('#file')).toHaveCount(0);
    await ctx.close();
  });

  test('the facilitator sees it flagged late, with the file', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: FACILITATOR });
    const page = await ctx.newPage();
    await page.goto('/teach/grading');
    const card = page.locator('li').filter({ hasText: TITLE }).first();
    await expect(card).toContainText('late');
    await expect(card).toContainText('Submitted after the deadline.');
    const href = await card.getByRole('link', { name: /Download essay-v1\.pdf/ }).getAttribute('href');
    const res = await fetchIn(page, href!);
    expect(res.status).toBe(200);
    expect(res.disposition).toMatch(/^attachment/);

    await page.waitForLoadState('networkidle');
    await card.getByRole('radio', { name: 'Return for revision' }).check();
    await card.getByLabel(/What needs to change/).fill('Engage with section 25 on legitimate interest, not only consent.');
    await card.getByRole('button', { name: 'Return for revision' }).click();
    await expect(page.getByText('Returned to the student for revision.')).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });

  test('a return reopens it, and the resubmission keeps both files in the history', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: STUDENT });
    const page = await ctx.newPage();
    await page.goto(`/assignment/${assignmentId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Engage with section 25/)).toBeVisible();

    await page.locator('#file').setInputFiles({ name: 'essay-v2.pdf', mimeType: 'application/pdf', buffer: PDF('v2') });
    await page.getByRole('button', { name: 'Attach this file instead' }).click();
    await expect(page.getByText('File attached, not yet submitted')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Resubmit to my facilitator' }).click();
    await expect(page.getByText('Submitted late')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('essay-v1.pdf')).toBeVisible();
    await expect(page.getByText('essay-v2.pdf')).toBeVisible();
    await ctx.close();
  });

  test('another student cannot open the file, even holding the link', async ({ browser, baseURL }) => {
    const db = sql();
    const [f] = await db`
      SELECT af.object_key FROM assignment_files af
      JOIN submissions s ON s.id = af.submission_id WHERE s.assessment_id = ${assignmentId} LIMIT 1`;
    await db.end();

    // A valid, unexpired signature, exactly what the student would forward.
    // The signature is not the authorisation; being the owner or their
    // facilitator is.
    const expires = Date.now() + 60_000;
    const sig = createHmac('sha256', process.env.SESSION_SECRET ?? 'dev-secret')
      .update(`${f.object_key}:${expires}`)
      .digest('hex');
    const href = `/api/files?key=${encodeURIComponent(f.object_key)}&expires=${expires}&sig=${sig}`;

    const owner = await browser.newContext({ baseURL, storageState: STUDENT });
    const own = await owner.newPage();
    await own.goto('/dashboard');
    expect((await fetchIn(own, href)).status).toBe(200);
    await owner.close();

    const candidate = join(process.cwd(), '.auth', 'assignment-candidate.json');
    await signIn(browser, baseURL, 'candidate@unilag.example.ng', candidate);
    const other = await browser.newContext({ baseURL, storageState: candidate });
    const op = await other.newPage();
    await op.goto('/apply');
    expect((await fetchIn(op, href)).status).toBe(403);
    await other.close();
  });
});
