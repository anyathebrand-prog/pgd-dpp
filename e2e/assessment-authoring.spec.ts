/**
 * FC-02 — building a quiz (LRN-04).
 *
 * Until now assessments existed only in the seed, which meant the attempt →
 * auto-mark → grade → release path ran on data no facilitator could have
 * created. This covers making one.
 *
 * The tests that matter are the refusals. A submission stores answers keyed by
 * question id and a grade is a mark out of a total derived from those
 * questions, so editing a paper after someone has answered it rewrites what
 * every existing grade meant — silently, with nothing in the UI to notice.
 * Two of these tests exist to prove that cannot happen.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STATE = join(process.cwd(), '.auth', 'authoring.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();
const TITLE = `E2E quiz ${RUN}`;

let moduleId = '';
let assessmentId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeAll(async ({ browser, baseURL }) => {
  const db = sql();
  const [m] = await db`
    SELECT m.id FROM modules m
    JOIN institutions i ON i.id = m.institution_id
    WHERE i.slug = 'unilag' AND m.code = 'DPP-101' LIMIT 1`;
  moduleId = m.id;
  await db.end();

  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('facilitator@unilag.example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  await context.storageState({ path: STATE });
  await context.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM assessments WHERE title = ${TITLE}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a facilitator builds a quiz', () => {
  test.use({ storageState: STATE });

  test('creates the paper, which starts unpublishable', async ({ page }) => {
    await page.goto(`/teach/${moduleId}`);
    await expect(page.getByRole('heading', { level: 1, name: /DPP-101/ })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Located by the form rather than by the surrounding section: two panels
    // on this page have a "Title" field, and the button is what distinguishes
    // the one being tested.
    const panel = page.locator('form', {
      has: page.getByRole('button', { name: 'Create assessment' }),
    });
    await panel.getByLabel(/Title/).fill(TITLE);
    await panel.getByLabel(/Attempts allowed/).fill('2');
    await panel.getByLabel(/Pass mark/).fill('60');
    await panel.getByRole('button', { name: 'Create assessment' }).click();

    await expect(page.getByText('Assessment created.')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT id, published FROM assessments WHERE title = ${TITLE}`;
    await db.end();
    assessmentId = row.id;
    // A paper with no questions is a draft, whatever anyone clicks.
    expect(row.published).toBe(false);
  });

  test('a quiz with no questions cannot be published, and says why', async ({ page }) => {
    await page.goto(`/teach/${moduleId}/assessment/${assessmentId}`);
    await expect(page.getByText('A quiz needs at least one question.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish to students' })).toBeDisabled();
  });

  test('a multiple-choice question needs a correct option marked', async ({ page }) => {
    await page.goto(`/teach/${moduleId}/assessment/${assessmentId}`);
    await page.waitForLoadState('networkidle');

    const panel = page.locator('form', {
      has: page.getByRole('button', { name: 'Add question' }),
    });
    await panel.getByLabel('Question (required)').fill('Which lawful basis does the NDPA list first?');
    await panel.getByRole('textbox', { name: 'Option A' }).fill('Consent');
    await panel.getByRole('textbox', { name: 'Option B' }).fill('Legitimate interest');
    await panel.getByRole('button', { name: 'Add question' }).click();

    // Options but no radio checked: the server refuses rather than storing a
    // question the auto-marker would score zero for everyone.
    await expect(page.getByText('Mark which option is correct.')).toBeVisible({ timeout: 30_000 });
  });

  test('with the answer marked it saves, and the quiz becomes publishable', async ({ page }) => {
    await page.goto(`/teach/${moduleId}/assessment/${assessmentId}`);
    await page.waitForLoadState('networkidle');

    const panel = page.locator('form', {
      has: page.getByRole('button', { name: 'Add question' }),
    });
    await panel.getByLabel('Question (required)').fill('Which lawful basis does the NDPA list first?');
    await panel.getByRole('textbox', { name: 'Option A' }).fill('Consent');
    await panel.getByRole('textbox', { name: 'Option B' }).fill('Legitimate interest');
    await panel.getByRole('radio', { name: 'Option A is correct' }).check();
    await panel.getByLabel('Marks (required)').fill('4');
    await panel.getByRole('button', { name: 'Add question' }).click();

    await expect(page.getByText('Question added.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('A. Consent — correct')).toBeVisible();

    await page.getByRole('button', { name: 'Publish to students' }).click();
    await expect(page.getByText('Students on this module can attempt it now.')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('once a student has answered, the questions are frozen', async ({ page }) => {
    // A submission, created directly: the point under test is the freeze, not
    // the sitting of the paper, which the assessment suite already covers.
    const db = sql();
    const [inst] = await db`SELECT id FROM institutions WHERE slug = 'unilag'`;
    const [student] = await db`SELECT id FROM users WHERE email = 'student@unilag.example.ng'`;
    await db`
      INSERT INTO submissions (institution_id, assessment_id, user_id, attempt, status, answers, submitted_at)
      VALUES (${inst.id}, ${assessmentId}, ${student.id}, 1, 'submitted', '{}'::jsonb, now())`;
    await db.end();

    await page.goto(`/teach/${moduleId}/assessment/${assessmentId}`);
    await expect(page.getByText('1 attempt already submitted')).toBeVisible();
    await expect(page.getByText('This paper is closed to changes')).toBeVisible();

    // And the server refuses, not just the screen: the edit form is still
    // reachable on an existing question.
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.getByLabel('Question (required)').first().fill('A different question entirely');
    await page.getByRole('button', { name: 'Save question' }).click();
    await expect(page.getByText(/already answered this paper/)).toBeVisible({ timeout: 30_000 });

    const db2 = sql();
    const [q] = await db2`SELECT prompt FROM questions WHERE assessment_id = ${assessmentId}`;
    await db2.end();
    expect(q.prompt).toContain('Which lawful basis');
  });

  test('and the pass mark is fixed too', async ({ page }) => {
    await page.goto(`/teach/${moduleId}/assessment/${assessmentId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator(`#assessment-${assessmentId}-pass`)).toHaveAttribute('readonly', '');
    await expect(page.getByText('Some of this is fixed now')).toBeVisible();
  });
});

/* ----------------------------------------------------------------- LRN-06 */

test.describe('a facilitator tells a cohort something', () => {
  test.use({ storageState: STATE });

  const subject = `Deadline moved ${RUN}`;

  test.afterAll(async () => {
    const db = sql();
    await db`DELETE FROM announcements WHERE title = ${subject}`;
    await db.end();
  });

  test('posts it, and every student in that cohort sees it', async ({ page, browser, baseURL }) => {
    await page.goto('/teach');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Subject (required)').fill(subject);
    await page
      .getByLabel(/^Announcement/)
      .fill('The end-of-module test now closes on Friday rather than Wednesday.');
    await page.getByRole('button', { name: 'Post to the cohort' }).click();

    await expect(page.getByText(/Everyone in that cohort sees it/)).toBeVisible({
      timeout: 30_000,
    });

    // The half that matters: it reaches the dashboard of someone in the
    // cohort. A console that lists its own announcements back to itself would
    // pass a weaker test.
    const student = await browser.newContext({ baseURL, storageState: undefined });
    const theirs = await student.newPage();
    await theirs.goto('/login');
    await theirs.getByLabel(/Email address/).fill('student@unilag.example.ng');
    await theirs.getByLabel(/^Password/).fill(PASSWORD);
    await theirs.getByRole('button', { name: 'Log in' }).click();
    await theirs.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await expect(theirs.getByText(subject)).toBeVisible();
    await student.close();
  });

  test('and can take it down again', async ({ page }) => {
    await page.goto('/teach');
    await page.waitForLoadState('networkidle');

    const row = page.locator('li', { hasText: subject });
    await row.getByRole('button', { name: /^Remove/ }).click();

    await expect(page.getByText(subject)).toHaveCount(0, { timeout: 30_000 });
  });
});
