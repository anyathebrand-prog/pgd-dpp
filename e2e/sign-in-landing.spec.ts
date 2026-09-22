/**
 * Where signing in lands each person (AU-03).
 *
 * A facilitator used to arrive at /apply, the applicant's page, under the
 * student menu: only 'alumni' and 'student' were routed and every other
 * account fell through. Each role now lands in its own place.
 */
import { expect, test, type Browser } from '@playwright/test';

const PASSWORD = 'Passw0rd-seed-2026';

async function landing(browser: Browser, baseURL: string | undefined, email: string) {
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  const path = new URL(page.url()).pathname;
  await ctx.close();
  return path;
}

test.describe('signing in lands each role in its own place', () => {
  for (const [who, email, where] of [
    ['a facilitator, in the teaching console', 'facilitator@unilag.example.ng', '/teach'],
    ['a student, on their dashboard', 'student@unilag.example.ng', '/dashboard'],
    ['an applicant, on their application', 'candidate@unilag.example.ng', '/apply'],
    ['the library curator, in the curation console', 'curator@example.ng', '/curate'],
  ] as const) {
    test(who, async ({ browser, baseURL }) => {
      expect(await landing(browser, baseURL, email)).toBe(where);
    });
  }
});
