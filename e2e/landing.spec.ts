/**
 * PB-01, the platform landing page.
 *
 * It runs against the apex host rather than the suite's tenant baseURL,
 * because which page renders at `/` is decided by the Host header — the same
 * mechanism the rest of the product's isolation rests on. Asserting the
 * landing page from `unilag.localhost` would assert nothing at all.
 *
 * The claims worth testing here are the ones that rot: the institution count
 * in the headline is generated from the database, and the redaction is a
 * decoration that must never remove the words underneath it from the
 * accessible name.
 */
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const APEX = 'http://localhost:3000';

test.describe('PB-01', () => {
  test('the headline reads as one sentence, redaction and all', async ({ page }) => {
    await page.goto(`${APEX}/`);

    // The bar is painted by a ::after, so the heading's text is intact for a
    // screen reader and for search. A hero built out of an image of the
    // headline would pass a screenshot and fail this.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Post Graduate Diploma in Data Protection and Privacy',
      }),
    ).toBeVisible();
  });

  test('the institution count comes from the database, not from the copy', async ({ page }) => {
    const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM institutions WHERE status = 'live'`;
    await sql.end();

    const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
    const n = Number(count);

    await page.goto(`${APEX}/`);
    await expect(
      page.getByText(`One application. ${words[n]} ${n === 1 ? 'university' : 'universities'}.`),
    ).toBeVisible();

    // And each live institution is actually listed, linked to its own host.
    await expect(page.getByRole('heading', { name: 'Where you can study' })).toBeVisible();
    await expect(page.getByRole('link', { name: /View the programme at/ })).toHaveCount(n);
  });

  test('says what it holds about you, and links to the detail', async ({ page }) => {
    await page.goto(`${APEX}/`);
    await expect(page.getByRole('heading', { name: 'What we hold about you' })).toBeVisible();
    await page
      .getByRole('link', { name: /Read the detail, including who is responsible/ })
      .click();
    await expect(page).toHaveURL(/\/trust$/);
  });

  test('an employer can reach verification without an account', async ({ page }) => {
    // §7 puts Verify in the signed-out header for someone who will never be a
    // user of this product and should not have to become one.
    await page.goto(`${APEX}/`);
    await page.getByRole('link', { name: 'Verify', exact: true }).click();
    await expect(page).toHaveURL(/\/verify$/);
  });

  test('the CTA path leads to the institutions', async ({ page }) => {
    await page.goto(`${APEX}/`);
    await page.getByRole('link', { name: 'Browse programmes' }).first().click();
    await expect(page).toHaveURL(/\/programmes$/);
  });
});
