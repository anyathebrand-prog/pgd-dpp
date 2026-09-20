/**
 * LB-03 document reader (LIB-03).
 *
 * Three claims. The reader paginates a text layer and a highlight survives a
 * reload. A scan with no text layer says so rather than offering highlighting
 * that silently does nothing — the state the flow calls out by name. And one
 * reader's notes are their own: this is a shared catalogue, and the margin is
 * the most personal thing in it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STUDENT = join(process.cwd(), '.auth', 'reader-student.json');
const OTHER = join(process.cwd(), '.auth', 'reader-other.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const QUOTE = 'Consent must be freely given, specific and unambiguous';
const BODY = `${QUOTE}. ${'The Commission has repeatedly said as much. '.repeat(60)}`;

let withText = '';
let scanned = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function signIn(
  browser: import('@playwright/test').Browser,
  baseURL: string,
  email: string,
  state: string,
) {
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

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  const [licence] = await db`SELECT id FROM licences WHERE allows_hosting = true LIMIT 1`;

  // One with an extracted text layer, one without — the two modes.
  const [a] = await db`
    INSERT INTO library_items (title, citation, source_attribution, licence_id, object_key, full_text, status)
    VALUES (${`Readable item ${RUN}`}, 'NJDP 1', 'Seeded for the reader test', ${licence.id},
            ${`library/readable-${RUN}.pdf`}, ${BODY}, 'published')
    RETURNING id`;
  const [b] = await db`
    INSERT INTO library_items (title, citation, source_attribution, licence_id, object_key, status)
    VALUES (${`Scanned judgment ${RUN}`}, 'FHC/ABJ/1', 'Seeded for the reader test', ${licence.id},
            ${`library/scanned-${RUN}.pdf`}, 'published')
    RETURNING id`;
  withText = a.id;
  scanned = b.id;
  await db.end();

  await signIn(browser, baseURL!, 'student@unilag.example.ng', STUDENT);
  await signIn(browser, baseURL!, 'facilitator@unilag.example.ng', OTHER);
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM reading_notes WHERE item_id IN (${withText}, ${scanned})`;
  await db`DELETE FROM library_items WHERE id IN (${withText}, ${scanned})`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

/** Select a stretch of the rendered page, as a reader's drag would. */
async function selectQuote(page: import('@playwright/test').Page, quote: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector('.t-read');
    if (!root) throw new Error('no reader text');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
      node = walker.nextNode();
    }
    throw new Error('quote not found in rendered page');
  }, quote);
}

test.describe('a document with a text layer', () => {
  test.use({ storageState: STUDENT });

  test('reads in the browser, paginated', async ({ page }) => {
    await page.goto(`/library/${withText}/read`);
    await expect(page.getByRole('heading', { level: 1, name: `Readable item ${RUN}` })).toBeVisible();
    await expect(page.getByText(/Page 1 of/)).toBeVisible();
    await expect(page.getByText(QUOTE, { exact: false }).first()).toBeVisible();
  });

  test('a highlight is saved against the passage and survives a reload', async ({ page }) => {
    await page.goto(`/library/${withText}/read`);
    await page.waitForLoadState('networkidle');

    await selectQuote(page, QUOTE);
    await expect(page.getByText('Selected')).toBeVisible();
    await page.locator('#reader-note').fill('The GAID tightened this.');
    await page.getByRole('button', { name: 'Save highlight' }).click();

    await expect(page.getByText('The GAID tightened this.')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT quote, note, start_offset, end_offset FROM reading_notes WHERE item_id = ${withText}`;
    await db.end();

    expect(row.quote).toBe(QUOTE);
    expect(row.note).toBe('The GAID tightened this.');
    // Anchored where the text actually is, not at zero.
    expect(Number(row.end_offset)).toBe(Number(row.start_offset) + QUOTE.length);

    // And it is still marked after a reload — the anchor is the document, not
    // the browser session.
    await page.reload();
    await expect(page.locator('mark')).toContainText(QUOTE);
  });

  test('the note can be edited and removed from the margin', async ({ page }) => {
    await page.goto(`/library/${withText}/read`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.locator('textarea').last().fill('Actually the GAID restated it.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Actually the GAID restated it.')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Remove' }).click();
    // The outcome cannot live in the row it just removed, so it is in the URL.
    await expect(page.getByText('Note removed')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('mark')).toHaveCount(0);
  });
});

test.describe('and another reader', () => {
  test('sees none of it', async ({ browser, baseURL }) => {
    // Put a highlight back, as the student.
    const student = await browser.newContext({ baseURL, storageState: STUDENT });
    const studentPage = await student.newPage();
    await studentPage.goto(`/library/${withText}/read`);
    await studentPage.waitForLoadState('networkidle');
    await selectQuote(studentPage, QUOTE);
    await studentPage.locator('#reader-note').fill('Private to me.');
    await studentPage.getByRole('button', { name: 'Save highlight' }).click();
    await expect(studentPage.getByText('Private to me.')).toBeVisible({ timeout: 30_000 });
    await student.close();

    const other = await browser.newContext({ baseURL, storageState: OTHER });
    const otherPage = await other.newPage();
    await otherPage.goto(`/library/${withText}/read`);
    await otherPage.waitForLoadState('networkidle');

    // The catalogue is shared; the margin is not.
    await expect(otherPage.getByText('Private to me.')).toHaveCount(0);
    await expect(otherPage.locator('mark')).toHaveCount(0);
    await expect(otherPage.getByText(/Nothing highlighted yet/)).toBeVisible();
    await other.close();
  });
});

test.describe('a scan with no text layer', () => {
  test.use({ storageState: STUDENT });

  test('says highlighting is unavailable rather than failing silently', async ({ page }) => {
    await page.goto(`/library/${scanned}/read`);

    // The flow: "highlighting degrades — warn rather than silently failing".
    await expect(
      page.getByText('Highlighting is not available for this document'),
    ).toBeVisible();
    await expect(page.getByText(/no text layer/)).toBeVisible();

    // The document is still readable, through the licence-checked route.
    await expect(page.locator('object')).toHaveAttribute(
      'data',
      `/api/library/${scanned}/file`,
    );
    // And no crop of a reader that cannot work here.
    await expect(page.getByText(/Select any passage/)).toHaveCount(0);
  });
});
