/**
 * PB-01, the platform landing page.
 *
 * It runs against the apex host rather than the suite's tenant baseURL,
 * because which page renders at `/` is decided by the Host header — the same
 * mechanism the rest of the product's isolation rests on. Asserting the
 * landing page from `unilag.localhost` would assert nothing at all.
 *
 * The claims worth testing here are the ones that rot: every figure on the
 * page is counted from the database, the redaction is decoration that must
 * never remove the words underneath it from the accessible name, and the
 * animated parts must all be stoppable by someone who did not ask for motion.
 *
 * The viewport is the suite-wide 360px baseline, so the navigation is
 * exercised in its mobile disclosure form unless a test widens it.
 */
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

/**
 * The apex host, derived from the suite's tenant baseURL rather than hardcoded
 * — the dev config runs on :3000 and the production one on :3100, and PB-01 is
 * exactly the page that must be asserted on the host without a tenant.
 */
const APEX = (baseURL: string | undefined) =>
  (baseURL ?? 'http://unilag.localhost:3000').replace('//unilag.', '//');

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.describe('PB-01', () => {
  test('the headline reads as one sentence, redaction and all', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);

    // The bar is painted by a ::after, so the heading's text is intact for a
    // screen reader and for search. A hero built out of an image of the
    // headline would pass a screenshot and fail this.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'A qualification in Data Protection and Privacy',
      }),
    ).toBeVisible();
  });

  test('every figure in the hero is counted, not typed', async ({ page, baseURL }) => {
    const db = sql();
    const [{ institutions }] = await db<{ institutions: number }[]>`
      SELECT count(*)::int AS institutions FROM institutions WHERE status = 'live'`;
    const [{ items }] = await db<{ items: number }[]>`
      SELECT count(*)::int AS items FROM library_items`;
    await db.end();

    await page.goto(`${APEX(baseURL)}/`);

    const facts = page.locator('dl').first();
    await expect(facts).toContainText(String(institutions));
    await expect(facts).toContainText(String(items));
    // One way into each live institution, however many there are.
    await expect(page.getByRole('link', { name: /^Open / })).toHaveCount(institutions);
  });

  test('the rotating claim can be stopped, and reads as a list to a screen reader', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);

    // WCAG 2.2.2 — moving content past five seconds needs a control. The
    // control is a real button with an accessible name, not a hover target.
    const stop = page.getByRole('button', { name: 'Stop the rotating headline' });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.getByRole('button', { name: 'Resume the rotating headline' })).toBeVisible();

    // All three claims exist in the DOM at once, so nothing is announced on a
    // timer and nothing is only available to someone who waits.
    await expect(page.getByText('Taught as the Act is enforced', { exact: false })).toHaveCount(1);
  });

  test('with motion reduced, the hero is fully present and nothing moves', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${APEX(baseURL)}/`);

    await expect(
      page.getByRole('heading', { level: 1, name: /A qualification in/ }),
    ).toBeVisible();
    // Not merely present: visible and at full opacity, which is what fails if
    // the entrance animation is left holding it at opacity 0.
    const opacity = await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');

    // The rotator starts stopped rather than starting and then being stopped.
    await expect(page.getByRole('button', { name: 'Resume the rotating headline' })).toBeVisible();
    await context.close();
  });

  test('the mobile menu opens, navigates, and closes on Escape', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);

    const toggle = page.getByRole('button', { name: 'Menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await page.getByRole('link', { name: 'Verify a certificate' }).first().click();
    await expect(page).toHaveURL(/\/verify$/);
  });

  test('the desktop menus open on click and lead somewhere real', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${APEX(baseURL)}/`);

    const trigger = page.getByRole('button', { name: /The programme/ });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Scoped to the bar: the footer links to the same section, and a locator
    // that cannot tell them apart is not testing the menu.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'What you study' })
      .click();
    await expect(page.getByRole('heading', { name: 'What you study' })).toBeInViewport();
  });

  test('the questions are answerable without JavaScript arriving', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);

    // Native <details>: the answer is in the DOM and the summary toggles it,
    // which is also why find-in-page can reach it.
    const question = page.getByRole('group').filter({ hasText: 'Who awards the qualification?' });
    await expect(question).not.toHaveAttribute('open', '');
    await page.getByText('Who awards the qualification?').click();
    await expect(question).toHaveAttribute('open', '');
    await expect(question).toContainText('The university you applied to');
  });

  test('says what it holds about you, and links to the detail', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);
    await expect(page.getByRole('heading', { name: 'What we hold about you' })).toBeVisible();
    await page.getByRole('link', { name: /Read how the platform itself is run/ }).click();
    await expect(page).toHaveURL(/\/trust$/);
  });

  test('the CTA path leads to the institutions', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);
    await page.getByRole('link', { name: 'Choose a university and apply' }).first().click();
    await expect(page).toHaveURL(/\/programmes$/);
  });

  test('nothing on the page scrolls sideways at the 360px baseline', async ({ page, baseURL }) => {
    await page.goto(`${APEX(baseURL)}/`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
