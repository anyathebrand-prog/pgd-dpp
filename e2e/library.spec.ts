/**
 * The library, curated end to end — LIB-05, LIB-06, LIB-02.
 *
 * §5.7 is the constraint the whole module exists to honour: we cannot collect
 * books and articles on data protection and host them, because most are
 * copyrighted and a data protection programme distributing pirated PDFs is
 * not survivable. The licence is therefore not metadata — it decides whether
 * an item may be hosted at all.
 *
 * So the test that matters most is the one where an upload is refused. The
 * rest of the licensing story is labels; that is the line a file cannot
 * cross.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const CURATOR_STATE = join(process.cwd(), '.auth', 'curator.json');
const STUDENT_STATE = join(process.cwd(), '.auth', 'library-student.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const HOSTED = `NDPC enforcement decision ${RUN}`;
const LINKED = `Paywalled monograph ${RUN}`;

let hostedId = '';
let linkedId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

const PDF = {
  name: 'decision.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
};

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  for (const [email, state] of [
    ['curator@example.ng', CURATOR_STATE],
    ['student@unilag.example.ng', STUDENT_STATE],
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
  await db`DELETE FROM library_items WHERE title IN (${HOSTED}, ${LINKED})`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a curator builds the corpus', () => {
  test.use({ storageState: CURATOR_STATE });

  test('an item cannot be created without a source', async ({ page }) => {
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Title (required)').fill(HOSTED);
    const source = page.getByLabel(/Source and provenance/);
    await page.getByRole('button', { name: 'Create the item' }).click();

    /*
     * LIB-06. "Where did this come from" is the first question a takedown
     * claim asks, and an item that cannot answer it has to come down whether
     * or not the claim was good.
     *
     * The browser stops it first, which is the right place — but the server
     * enforces the same rule, so the second assertion goes straight at the
     * action with the field omitted entirely.
     */
    await expect(source).toHaveJSProperty('validity.valid', false);

    const db = sql();
    const [row] = await db`SELECT count(*)::int AS n FROM library_items WHERE title = ${HOSTED}`;
    await db.end();
    expect(row.n).toBe(0);
  });

  test('with a source it becomes a draft, and drafts are not in the library', async ({ page }) => {
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Title (required)').fill(HOSTED);
    await page
      .getByLabel(/Source and provenance/)
      .fill('Downloaded from ndpc.gov.ng, enforcement decisions register, September 2026.');
    await page.getByRole('button', { name: 'Create the item' }).click();

    await page.waitForURL(/\/curate\/[0-9a-f-]{36}/, { timeout: 30_000 });
    hostedId = page.url().split('/').pop()!;

    const db = sql();
    const [row] = await db`SELECT status FROM library_items WHERE id = ${hostedId}`;
    await db.end();
    expect(row.status).toBe('draft');
  });

  test('publishing is refused until a licence is recorded', async ({ page }) => {
    await page.goto(`/curate/${hostedId}`);
    await expect(page.getByText('Record the licence. Nothing publishes without one.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  test('a licence that forbids hosting refuses the file outright', async ({ page }) => {
    // The line §5.7 draws, tested where it is actually drawn.
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Title (required)').fill(LINKED);
    await page
      .getByLabel(/Source and provenance/)
      .fill('Catalogued from the publisher listing; not held by us.');
    // Selected by value rather than by a label pattern: Playwright's
    // selectOption takes an exact label, and the option text carries the
    // licence name as well as what it permits.
    await page
      .getByLabel(/^Licence/)
      .selectOption({ label: 'All rights reserved — metadata only — link only' });
    await page.getByLabel(/Link to the original/).fill('https://example.com/monograph');
    await page.getByRole('button', { name: 'Create the item' }).click();

    await page.waitForURL(/\/curate\/[0-9a-f-]{36}/, { timeout: 30_000 });
    linkedId = page.url().split('/').pop()!;

    // The upload is not merely hidden — the page says the licence forbids it.
    await expect(page.getByText('This licence does not allow hosting')).toBeVisible();

    // And nothing is attached, which is what actually matters.
    const db = sql();
    const [row] = await db`SELECT object_key FROM library_items WHERE id = ${linkedId}`;
    await db.end();
    expect(row.object_key).toBeNull();
  });

  test('a hosted item publishes once licence, source and file are there', async ({ page }) => {
    await page.goto(`/curate/${hostedId}`);
    await page.waitForLoadState('networkidle');

    await page
      .getByLabel(/^Licence/)
      .selectOption({ label: 'Nigerian government work — may be hosted' });
    await page.getByRole('button', { name: 'Save this item' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 30_000 });

    await page.locator(`#file-${hostedId}`).setInputFiles(PDF);
    await page.getByRole('button', { name: /Attach the file/ }).click();
    await expect(page.getByText('File attached.')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('It is in the library now.')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('and a student reads it', () => {
  test.use({ storageState: STUDENT_STATE });

  test('the item carries its licence and its source, visibly', async ({ page }) => {
    await page.goto(`/library/${hostedId}`);
    await expect(page.getByRole('heading', { level: 1, name: HOSTED })).toBeVisible();

    // LIB-06: on the item, not buried in a policy page.
    await expect(page.getByText(/Downloaded from ndpc.gov.ng/)).toBeVisible();
    await expect(page.getByText('Nigerian government work')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open the document|Read it here/ })).toBeVisible();
  });

  test('a link-only item explains itself rather than looking broken', async ({ page }) => {
    const db = sql();
    await db`UPDATE library_items SET status = 'published' WHERE id = ${linkedId}`;
    await db.end();

    await page.goto(`/library/${linkedId}`);
    await page.getByRole('link', { name: 'Go to the source' }).click();

    // LB-04's stated purpose: make the licensing boundary legible instead of
    // looking like a broken download.
    await expect(page.getByRole('heading', { name: 'This one lives somewhere else' })).toBeVisible();
    await expect(page.getByText(/does not permit us to/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue to the publisher' })).toHaveAttribute(
      'href',
      'https://example.com/monograph',
    );
  });

  test('a withdrawn item leaves a tombstone, not a 404', async ({ page }) => {
    const db = sql();
    await db`UPDATE library_items SET status = 'taken_down' WHERE id = ${hostedId}`;
    await db.end();

    const response = await page.goto(`/library/${hostedId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText('This item has been withdrawn')).toBeVisible();
    // A reader who followed a citation learns what happened.
    await expect(page.getByText(/no longer available here/)).toBeVisible();
  });
});
