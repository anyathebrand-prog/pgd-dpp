/**
 * The Resource Centre — RES-01 to RES-06, and CU-03.
 *
 * Two claims are worth testing here, and neither is the search box.
 *
 * The first is that a contributed paper cannot reach a reader on its own.
 * §5.7 permits faculty-authored work "with author licence", so a submission
 * without the contributor licence does not exist, and an accepted one becomes
 * a draft rather than a publication — its licence and provenance still have
 * to be recorded before anybody can read it.
 *
 * The second is that a reading list is one person's. It is a record of what
 * someone has been reading, which is exactly the kind of thing this
 * programme teaches people to be careful with.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STUDENT_STATE = join(process.cwd(), '.auth', 'resources-student.json');
const CURATOR_STATE = join(process.cwd(), '.auth', 'resources-curator.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const PAPER = `Consent fatigue in Nigerian fintech ${RUN}`;
const PUBLISHED = `Data localisation after GAID ${RUN}`;

let publishedId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  // A published paper to read, cite and bookmark.
  const db = sql();
  const [licence] = await db`SELECT id FROM licences WHERE code = 'NG-GOV'`;
  const [row] = await db`
    INSERT INTO library_items
      (collection, title, authors, year, abstract, instrument_type, licence_id,
       source_attribution, status)
    VALUES ('resource_centre', ${PUBLISHED}, 'Adeyemi, N. and Okafor, T.', 2026,
            'Whether the GAID 2025 localisation rules survive contact with cloud procurement.',
            'article', ${licence.id}, 'Author deposit under the contributor licence.', 'published')
    RETURNING id`;
  publishedId = row.id;
  await db.end();

  for (const [email, state] of [
    ['student@unilag.example.ng', STUDENT_STATE],
    ['curator@example.ng', CURATOR_STATE],
  ] as const) {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === 'pgd_session'), {
        timeout: 30_000,
      })
      .toBe(true);
    await context.storageState({ path: state });
    await context.close();
  }
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM bookmarks WHERE item_id IN (SELECT id FROM library_items WHERE title IN (${PAPER}, ${PUBLISHED}))`;
  await db`DELETE FROM library_items WHERE title IN (${PAPER}, ${PUBLISHED})`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a researcher uses the collection', () => {
  test.use({ storageState: STUDENT_STATE });

  test('finds a paper by searching its abstract', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByRole('heading', { level: 1, name: 'Resource Centre' })).toBeVisible();

    await page.getByLabel('Search papers').fill('localisation');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('heading', { name: PUBLISHED })).toBeVisible();
  });

  test('the citation is generated from the record, in three styles', async ({ page }) => {
    await page.goto(`/resources/${publishedId}`);
    await page.waitForLoadState('networkidle');

    // APA is the default, and the ampersand form is the one a marker checks.
    const box = page.locator('#citation-text');
    await expect(box).toHaveValue(/Adeyemi, N\., & Okafor, T\. \(2026\)/);

    await page.getByRole('button', { name: 'Harvard' }).click();
    await expect(box).toHaveValue(/Adeyemi, N\. and Okafor, T\. \(2026\)/);

    await page.getByRole('button', { name: 'BibTeX' }).click();
    await expect(box).toHaveValue(/^@article\{adeyemi2026data,/);
  });

  test('a reading list is kept, and it is one person’s', async ({ page, browser, baseURL }) => {
    await page.goto(`/resources/${publishedId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Save to reading list' }).click();

    await page.goto('/resources/saved');
    await expect(page.getByRole('heading', { name: PUBLISHED })).toBeVisible();

    // Someone else's list does not contain it. A bookmark says what a person
    // has been reading, and that is not a shared fact.
    const other = await browser.newContext({ baseURL, storageState: undefined });
    const theirs = await other.newPage();
    await theirs.goto('/login');
    await theirs.getByLabel(/Email address/).fill('candidate@unilag.example.ng');
    await theirs.getByLabel(/^Password/).fill(PASSWORD);
    await theirs.getByRole('button', { name: 'Log in' }).click();
    await theirs.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    await theirs.goto('/resources/saved');
    await expect(theirs.getByText('Nothing saved yet')).toBeVisible();
    await other.close();
  });
});

test.describe('someone contributes a paper', () => {
  test.use({ storageState: STUDENT_STATE });

  test('the contributor licence is not optional', async ({ page }) => {
    await page.goto('/resources/submit');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Title (required)').fill(PAPER);
    await page.getByLabel(/^Authors/).fill('Obi, K.');
    await page
      .getByLabel(/^Abstract/)
      .fill('Whether repeated consent prompts in Nigerian fintech apps produce meaningful consent at all.');
    await page.getByLabel(/Or a link to it/).fill('https://example.com/paper');
    await page.getByRole('button', { name: 'Submit for review' }).click();

    // §5.7 permits faculty work "with author licence" — without it there is
    // no lawful basis to host the paper, so there is nothing to submit.
    await expect(page.getByText(/contributor licence has to be agreed/)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT count(*)::int AS n FROM library_items WHERE title = ${PAPER}`;
    await db.end();
    expect(row.n).toBe(0);
  });

  test('with it agreed, the paper goes to the curator and not to readers', async ({ page }) => {
    await page.goto('/resources/submit');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Title (required)').fill(PAPER);
    await page.getByLabel(/^Authors/).fill('Obi, K.');
    await page
      .getByLabel(/^Abstract/)
      .fill('Whether repeated consent prompts in Nigerian fintech apps produce meaningful consent at all.');
    await page.getByLabel(/Or a link to it/).fill('https://example.com/paper');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Submit for review' }).click();

    await expect(page.getByText('With the curator')).toBeVisible({ timeout: 30_000 });

    // In review, not published — and therefore not in the Resource Centre.
    const db = sql();
    const [row] = await db`SELECT status FROM library_items WHERE title = ${PAPER}`;
    await db.end();
    expect(row.status).toBe('in_review');

    await page.goto('/resources');
    await page.getByLabel('Search papers').fill('consent fatigue');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: PAPER })).toHaveCount(0);
  });
});

test.describe('and a curator decides', () => {
  test.use({ storageState: CURATOR_STATE });

  test('accepting sends it to curation as a draft, not to the collection', async ({ page }) => {
    await page.goto('/curate/submissions');
    await expect(page.getByRole('heading', { name: PAPER })).toBeVisible();
    // The claim the contributor made is what a curator is checking.
    await expect(page.getByText(/under the contributor licence/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Accept for curation' }).click();
    await expect(page.getByText(/Accepted for curation/)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT status FROM library_items WHERE title = ${PAPER}`;
    await db.end();
    // Not published. RES-04 is a request to consider, not a queue-jump past
    // the licence rule that governs everything else in the corpus.
    expect(row.status).toBe('draft');
  });
});
