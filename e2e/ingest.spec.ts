/**
 * LIB-09 bulk ingestion (CU-01).
 *
 * Two claims. A curator can see what a sheet would do before it does it. And
 * whatever arrives arrives as a draft — CU-02 makes licence and provenance
 * blocking for publication, and a bulk path that could publish would be the
 * way around the only rule the library has.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const CURATOR = join(process.cwd(), '.auth', 'ingest-curator.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const GOOD = `Bulk statute ${RUN}`;
const SECOND = `Bulk judgment ${RUN}`;

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

const sheet = [
  'title,citation,year,url,source,licence',
  `${GOOD},"Act No 37, 2023",2023,https://ndpc.gov.ng/act,NDPC website,NG-GOV`,
  `${SECOND},FHC/ABJ/CS/1145,2021,,Federal High Court,PUBLIC-RECORD`,
  `Refused ${RUN},C3,2022,,A source,NOT-A-LICENCE`,
].join('\n');

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('curator@example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  await context.storageState({ path: CURATOR });
  await context.close();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM library_items WHERE title LIKE ${'%' + RUN}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('LIB-09 — bringing in a sheet', () => {
  test.use({ storageState: CURATOR });

  test('checking the sheet writes nothing and names the refused line', async ({ page }) => {
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');

    await page.locator('#ingest-csv').fill(sheet);
    await page.getByRole('button', { name: 'Check the sheet' }).click();

    await expect(page.getByText('This is what would happen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 items would be brought in/)).toBeVisible();
    // The line number is how a curator finds the row in their spreadsheet.
    await expect(page.getByText(/Line 4/)).toBeVisible();
    await expect(page.getByText(/not a licence this platform holds/)).toBeVisible();

    const db = sql();
    const [row] = await db`SELECT count(*)::int AS n FROM library_items WHERE title LIKE ${'%' + RUN}`;
    await db.end();
    // A dry run that wrote anything would not be one.
    expect(row.n).toBe(0);
  });

  test('bringing them in creates drafts, never published items', async ({ page }) => {
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');

    await page.locator('#ingest-csv').fill(sheet);
    await page.getByRole('button', { name: 'Bring them in as drafts' }).click();

    await expect(page.getByText('Sheet brought in')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const rows = await db`
      SELECT li.title, li.status, li.year, li.citation, l.code
      FROM library_items li LEFT JOIN licences l ON l.id = li.licence_id
      WHERE li.title LIKE ${'%' + RUN} ORDER BY li.title`;
    await db.end();

    expect(rows).toHaveLength(2);
    // CU-02 is still the only way to publish.
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
    expect(rows.map((r) => r.code).sort()).toEqual(['NG-GOV', 'PUBLIC-RECORD']);
    // The quoted citation kept its comma instead of shifting every column
    // after it.
    const statute = rows.find((r) => r.title === GOOD)!;
    expect(statute.citation).toBe('Act No 37, 2023');
    expect(statute.year).toBe(2023);
  });

  test('the same sheet again does not duplicate the catalogue', async ({ page }) => {
    await page.goto('/curate');
    await page.waitForLoadState('networkidle');

    await page.locator('#ingest-csv').fill(sheet);
    await page.getByRole('button', { name: 'Bring them in as drafts' }).click();
    await expect(page.getByText(/already in the catalogue/)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT count(*)::int AS n FROM library_items WHERE title LIKE ${'%' + RUN}`;
    await db.end();
    // A reader cannot tell which of two identical entries carries the right
    // licence, so a duplicate is worse than a missing row.
    expect(row.n).toBe(2);
  });

  test('and the drafts are waiting in the queue', async ({ page }) => {
    await page.goto('/curate');
    await expect(page.getByText(GOOD).first()).toBeVisible();
  });
});
