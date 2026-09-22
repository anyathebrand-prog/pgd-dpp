/**
 * The Faculty page, and each facilitator's control over their own profile.
 *
 * One central faculty (Data Protection Hub with ALDAPCON), the same on every
 * site; only published profiles appear; unpublishing takes the card and the photograph offline
 * together; and "Teach with us" has moved from the programme menu to the
 * foot of this page.
 */
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import sharp from 'sharp';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const FACILITATOR = 'facilitator@unilag.example.ng';
const NAME = 'Dr Yemi Sowande';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

const apex = (baseURL: string | undefined) => baseURL!.replace('//unilag.', '//');

test.afterAll(async () => {
  // Back to the seeded state: published, no photograph.
  const db = sql();
  await db`
    UPDATE facilitator_profiles SET published = true, photo_object_key = NULL
    WHERE user_id = (SELECT id FROM users WHERE email = ${FACILITATOR})`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Faculty', () => {
  test('is in the main menu, and Teach with us has left the programme menu', async ({ page, baseURL }) => {
    // The desktop bar; at 360px the same links sit behind the Menu button.
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(apex(baseURL));
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Faculty' })).toBeVisible();
    await nav.getByRole('button', { name: /The programme/ }).click();
    await expect(nav.getByRole('link', { name: 'Teach with us' })).toHaveCount(0);
  });

  test('lists published profiles, with Teach with us at the foot', async ({ page, baseURL }) => {
    await page.goto(`${apex(baseURL)}/faculty`);
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Teach with us' }).last()).toHaveAttribute('href', '/teach-with-us');
  });

  test('is one central faculty, the same on every site', async ({ page, baseURL }) => {
    await page.goto(`${baseURL!.replace('//unilag.', '//fulokoja.')}/faculty`);
    await expect(page.getByText('Data Protection Hub · in collaboration with ALDAPCON')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dr Ngozi Okafor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  });

  test('the facilitator adds a photograph, and unpublishing takes card and photograph down', async ({ page, baseURL }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill(FACILITATOR);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/teach/, { timeout: 30_000 });

    await page.getByRole('link', { name: 'My profile' }).click();
    await page.waitForURL(/\/teach\/profile/);
    const portrait = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#1f6adc' } }).png().toBuffer();
    await page.locator('#photo').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: portrait });
    await page.getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: 'Save my profile' }).click();
    await expect(page.getByText('Saved, and kept private')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`
      SELECT user_id, published, photo_object_key FROM facilitator_profiles
      WHERE user_id = (SELECT id FROM users WHERE email = ${FACILITATOR})`;
    await db.end();
    expect(row.published).toBe(false);
    expect(row.photo_object_key).toMatch(/^faculty\/.+\.png$/);

    const visitor = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
    const v = await visitor.newPage();
    await v.goto(`${apex(baseURL)}/faculty`);
    await expect(v.getByRole('heading', { name: NAME })).toHaveCount(0);
    const hidden = await v.evaluate(async (id) => (await fetch(`/api/faculty/${id}/photo`)).status, row.user_id);
    expect(hidden).toBe(404);

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Save my profile' }).click();
    await expect(page.getByText('Your profile is on the Faculty page now.')).toBeVisible({ timeout: 30_000 });

    await v.goto(`${apex(baseURL)}/faculty`);
    await expect(v.getByRole('img', { name: `Photograph of ${NAME}` })).toBeVisible();
    const shown = await v.evaluate(async (id) => (await fetch(`/api/faculty/${id}/photo`)).status, row.user_id);
    expect(shown).toBe(200);
    await visitor.close();
  });
});
