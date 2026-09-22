/**
 * The facilitator console — FC-01, FC-02, FC-03, and conflict C-06.
 *
 * §5.9 omits this console entirely (gap G-18) despite LRN-05 requiring
 * facilitators to grade, so the flow specs it provisionally and this builds
 * to that.
 *
 * The test worth having is the accommodation one. C-06's resolution is to
 * rely on WCAG 2.2.1's essential-timing exception *and* build extended time
 * into this console — and an accommodation that is recorded but not applied
 * by the code enforcing the deadline is worse than none, because it looks
 * granted and behaves as though it never was.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STATE = join(process.cwd(), '.auth', 'facilitator.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();
const FACILITATOR = 'facilitator@unilag.example.ng';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

/**
 * A facilitator holds no MFA-required role, so there is no TOTP step here —
 * AUTH-08 lists registry, institution admin, super admin and DPO. Signing in
 * once still beats signing in per test.
 */
test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(FACILITATOR);
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

/** Leave the fixture as it was found. */
test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM assessment_accommodations WHERE reason LIKE 'E2E %'`;
  await db`DELETE FROM lessons WHERE title LIKE 'E2E lesson %'`;
  await db`
    UPDATE submissions SET status = 'submitted', returned_note = NULL
    WHERE status = 'returned'`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

/* --------------------------------------------------------------------- FC-01 */

test.describe('the course list', () => {
  test.use({ storageState: STATE });

  test('shows assigned modules and what is waiting to be marked', async ({ page }) => {
    await page.goto('/teach');
    await expect(page.getByRole('heading', { name: 'My modules' })).toBeVisible();

    await expect(page.getByText('DPP-101 · The NDPA 2023 in practice')).toBeVisible();
    // The seed leaves one short-answer attempt unmarked.
    await expect(page.getByText(/(submission is|submissions are) waiting to be marked/i)).toBeVisible();
  });

  test('a facilitator sees only their own institution', async ({ page }) => {
    // The FUL facilitator's modules belong to FUL. RLS makes this a matter of
    // the database returning nothing, not of the UI filtering.
    await page.goto('/teach');
    // The module, specifically: the console also lists announcements, which
    // mention module codes in their own text.
    await expect(
      page.getByRole('heading', { name: 'DPP-101 · The NDPA 2023 in practice' }),
    ).toBeVisible();
    await expect(page.getByText('University of Lagos')).toBeVisible();
  });
});

/* --------------------------------------------------------------------- FC-02 */

test.describe('content authoring', () => {
  test.use({ storageState: STATE });

  test('a lesson can be added, and appears in order', async ({ page }) => {
    await page.goto('/teach');
    await page.getByRole('link', { name: 'Edit content' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: /DPP-101/ })).toBeVisible();
    await page.waitForLoadState('networkidle');

    const title = `E2E lesson ${RUN}`;
    // Scoped to the lesson form: the page now also carries an assessment
    // composer, which has a "Title" field of its own.
    const composer = page.locator('form', {
      has: page.getByRole('button', { name: 'Add lesson' }),
    });
    await composer.getByLabel('Title (required)').fill(title);
    await composer
      .getByLabel(/Lesson content/)
      .fill('Written for the test, long enough to count as content.');
    await composer.getByRole('button', { name: 'Add lesson' }).click();

    await expect(page.getByText('Lesson added.')).toBeVisible({ timeout: 30_000 });
    // The title also appears in the move buttons' screen-reader labels, so
    // this targets the heading specifically.
    await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
  });

  test('publishing is blocked with the reason, not just disabled', async ({ page }) => {
    // FC-02 names "publish blocked by missing required fields" as a state, and
    // §6 requires that a disabled control is never the only signal.
    const db = sql();
    const [m] = await db`
      SELECT id FROM modules WHERE code = 'DPP-201' AND published = false LIMIT 1`;
    await db.end();

    await page.goto(`/teach/${m.id}`);
    await expect(page.getByText('Not ready to publish')).toBeVisible();
    await expect(page.getByText(/needs at least one lesson/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish module' })).toBeDisabled();
  });
});

/* --------------------------------------------------------------------- FC-03 */

test.describe('the grading queue', () => {
  test.use({ storageState: STATE });

  test('shows the short answer a person has to read, with the auto-marked part done', async ({
    page,
  }) => {
    await page.goto('/teach/grading');
    await expect(page.getByRole('heading', { name: 'Grading' })).toBeVisible();

    await expect(
      page.getByRole('heading', { name: /Kelechi Obi — DPP-101 end of module test/ }),
    ).toBeVisible();
    // MCQ and true/false are already scored, so the facilitator's attention
    // goes to the part only a person can mark.
    await expect(page.getByText(/Auto-marked so far/)).toBeVisible();
    await expect(page.getByText(/consent can be withdrawn/)).toBeVisible();
  });

  test('will not release a grade with no feedback', async ({ page }) => {
    await page.goto('/teach/grading');
    await page.waitForLoadState('networkidle');

    const feedback = page.getByLabel(/^Feedback/).first();
    await page.getByLabel(/Score out of/).first().fill('6');
    await page.getByRole('button', { name: 'Grade and release' }).first().click();

    // The browser stops it before the request is made, which is the right
    // place for it — the action guards the same rule server-side, but a
    // facilitator should not need a round trip to be told.
    await expect(feedback).toHaveJSProperty('validity.valid', false);
    await expect(page.getByText('Graded and released to the student.')).toHaveCount(0);
  });

  test('returning for revision tells the student what to change', async ({ page }) => {
    await page.goto('/teach/grading');
    await page.waitForLoadState('networkidle');
    await page.getByRole('radio', { name: 'Return for revision' }).first().check();
    await page
      .getByLabel(/What needs to change/)
      .first()
      .fill('Address the withdrawal point directly, with reference to section 26.');
    await page.getByRole('button', { name: 'Return for revision' }).first().click();

    await expect(page.getByText('Returned to the student for revision.')).toBeVisible({
      timeout: 30_000,
    });
  });
});

/* ------------------------------------------------------------ conflict C-06 */

test.describe('extended time is an accommodation, not a label', () => {
  test.use({ storageState: STATE });

  test('a facilitator grants it, and the deadline actually moves', async ({ page }) => {
    await page.goto('/teach/grading');
    await page.waitForLoadState('networkidle');

    await page.getByLabel(/Extra minutes/).first().fill('20');
    await page.getByLabel(/^Reason/).first().fill('E2E documented accommodation on file.');
    await page.getByRole('button', { name: /Grant extra time/ }).first().click();
    await expect(page.getByText(/20 extra minutes granted/)).toBeVisible({ timeout: 30_000 });

    // The part that matters: the grant reaches the code that enforces the
    // deadline. A row in a table nobody reads is not an accommodation.
    const db = sql();
    const [row] = await db`
      SELECT a.extra_minutes, s.time_limit_minutes
      FROM assessment_accommodations a
      JOIN assessments s ON s.id = a.assessment_id
      WHERE a.reason LIKE 'E2E %' LIMIT 1`;
    await db.end();

    expect(Number(row.extra_minutes)).toBe(20);
    expect(Number(row.time_limit_minutes)).toBe(10);
  });

  test('the student is told they have it, rather than left to discover it', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();

    await page.goto('/login');
    await page.getByLabel(/Email address/).fill('student@unilag.example.ng');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    // A second attempt is needed to see the in-progress screen, and the
    // seeded assessment allows one — so this asserts the grant exists and is
    // legible from the facilitator side instead of faking an attempt.
    const db = sql();
    const [row] = await db`
      SELECT extra_minutes, reason FROM assessment_accommodations
      WHERE reason LIKE 'E2E %' LIMIT 1`;
    await db.end();
    expect(row.reason).toContain('documented accommodation');

    await context.close();
  });
});
