/**
 * School channels — ALM-10, ALM-11, ALM-12, ALM-08.
 *
 * ALM-12 is the requirement with a knife in it: a School A alumnus "can see
 * School B graduates in the directory but cannot enter School B's channel —
 * enforced server-side, not by hiding the link". So the test that carries
 * this file types the other school's URL directly. Anything that only checked
 * for an absent link would pass while the channel leaked.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const UNILAG_ALUM = join(process.cwd(), '.auth', 'channel-unilag.json');
const UNN_ALUM = join(process.cwd(), '.auth', 'channel-unn.json');
const ADMIN = join(process.cwd(), '.auth', 'channel-admin.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const unilagAlum = `chan-unilag-${RUN}@example.ng`;
const unnAlum = `chan-unn-${RUN}@example.ng`;
const POST = `Enforcement notice worth reading ${RUN}`;

let unilagId = '';
let unnId = '';
let postId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function currentTotp(secret: string) {
  const { createHmac } = await import('node:crypto');
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[o] & 0x7f) << 24) | (digest[o + 1] << 16) | (digest[o + 2] << 8) | digest[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** One graduate of each university, so the boundary has two sides. */
async function makeAlumnus(db: ReturnType<typeof sql>, email: string, institutionId: string) {
  const hash = (
    await db`SELECT password_hash FROM users WHERE email = 'student@unilag.example.ng'`
  )[0].password_hash;
  const [u] = await db`
    INSERT INTO users (email, full_name, status, email_verified_at, password_hash)
    VALUES (${email}, ${'Alum ' + email.slice(0, 12)}, 'alumni', now(), ${hash}) RETURNING id`;
  await db`INSERT INTO memberships (user_id, institution_id, role) VALUES (${u.id}, ${institutionId}, 'alumni')`;
  await db`
    INSERT INTO alumni_profiles (user_id, institution_id, cohort_year, directory_visible, visible_fields)
    VALUES (${u.id}, ${institutionId}, 2026, false, ARRAY[]::text[])`;
  return u.id;
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  unnId = (await db`SELECT id FROM institutions WHERE slug = 'unn'`)[0].id;
  await makeAlumnus(db, unilagAlum, unilagId);
  await makeAlumnus(db, unnAlum, unnId);
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  for (const [email, state] of [
    [unilagAlum, UNILAG_ALUM],
    [unnAlum, UNN_ALUM],
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

  // The UNILAG admin moderates the UNILAG channel, through AUTH-08.
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await context.storageState({ path: ADMIN });
  await context.close();
});

test.afterAll(async () => {
  const db = sql();
  const ids = await db`SELECT id FROM users WHERE email IN (${unilagAlum}, ${unnAlum})`;
  const list = ids.map((r) => r.id);
  if (list.length) {
    await db`DELETE FROM content_reports WHERE reporter_id = ANY(${list})`;
    await db`DELETE FROM channel_posts WHERE author_id = ANY(${list})`;
    await db`DELETE FROM alumni_profiles WHERE user_id = ANY(${list})`;
    await db`DELETE FROM memberships WHERE user_id = ANY(${list})`;
    await db`DELETE FROM users WHERE id = ANY(${list})`;
  }
  await db`DELETE FROM channel_posts WHERE body LIKE ${'%' + RUN + '%'}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a school channel is private to that school', () => {
  test('a graduate posts into their own channel', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: UNILAG_ALUM });
    const page = await context.newPage();

    await page.goto(`/alumni/school/${unilagId}`);
    await expect(page.getByRole('heading', { level: 1, name: /UNILAG channel/ })).toBeVisible();

    await page.getByLabel(/Say something/).fill(POST);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText(POST)).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [row] = await db`SELECT id, institution_id FROM channel_posts WHERE body = ${POST}`;
    await db.end();
    postId = row.id;
    expect(row.institution_id).toBe(unilagId);

    await context.close();
  });

  test('a graduate of another school cannot open it, even knowing the URL', async ({
    browser,
    baseURL,
  }) => {
    // ALM-12, tested the only way that means anything: by typing the URL.
    const context = await browser.newContext({ baseURL, storageState: UNN_ALUM });
    const page = await context.newPage();

    const response = await page.goto(`/alumni/school/${unilagId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(POST)).toHaveCount(0);

    await context.close();
  });

  test('and cannot post into it either', async ({ browser, baseURL }) => {
    // The page refusing to render is not the control; the action refusing to
    // write is. A 404 that still accepted writes would be a leak with a
    // polite front door.
    const context = await browser.newContext({ baseURL, storageState: UNN_ALUM });
    const page = await context.newPage();
    await page.goto('/alumni');

    const before = sql();
    const [{ n: countBefore }] =
      await before`SELECT count(*)::int AS n FROM channel_posts WHERE institution_id = ${unilagId}`;
    await before.end();

    // Drive the action the way a crafted client would: the form is not on
    // this page, so this posts to it directly.
    await page.evaluate(async (id) => {
      const body = new FormData();
      body.set('institutionId', id);
      body.set('body', 'A message from a university that is not this one.');
      await fetch('/alumni', { method: 'POST', body }).catch(() => {});
    }, unilagId);

    const after = sql();
    const [{ n: countAfter }] =
      await after`SELECT count(*)::int AS n FROM channel_posts WHERE institution_id = ${unilagId}`;
    await after.end();

    expect(countAfter).toBe(countBefore);
    await context.close();
  });

  test('but the two of them can still see each other in the directory', async ({
    browser,
    baseURL,
  }) => {
    // The other half of ALM-12: the wall is around the channel, not around
    // the network.
    const db = sql();
    await db`UPDATE alumni_profiles SET directory_visible = true WHERE user_id IN (SELECT id FROM users WHERE email IN (${unilagAlum}, ${unnAlum}))`;
    await db.end();

    const context = await browser.newContext({ baseURL, storageState: UNN_ALUM });
    const page = await context.newPage();
    await page.goto('/alumni/directory');

    await expect(page.getByText('You are listed')).toBeVisible();
    // A UNILAG graduate, seen by a UNN one.
    await expect(page.getByText(`Alum ${unilagAlum.slice(0, 12)}`)).toBeVisible();
    await context.close();
  });
});

test.describe('moderation is the institution’s own', () => {
  test('a report reaches the school admin, and removal leaves a marker', async ({
    browser,
    baseURL,
  }) => {
    // The alumnus reports the post.
    const alum = await browser.newContext({ baseURL, storageState: UNILAG_ALUM });
    const alumPage = await alum.newPage();
    await alumPage.goto(`/alumni/school/${unilagId}`);
    await alumPage.waitForLoadState('networkidle');

    const post = alumPage.locator('li', { hasText: POST });
    await post.getByRole('button', { name: 'Report this post' }).click();
    await post.getByLabel(/What is wrong with it/).selectOption('personal_data');
    await post.getByRole('button', { name: 'Send the report' }).click();
    await expect(alumPage.getByText(/moderator sees it/)).toBeVisible({ timeout: 30_000 });
    await alum.close();

    // The admin sees it and removes the post with a reason.
    const admin = await browser.newContext({ baseURL, storageState: ADMIN });
    const adminPage = await admin.newPage();
    await adminPage.goto('/admin/alumni');
    await expect(adminPage.getByText(/Reported as personal data/)).toBeVisible();

    await adminPage.getByLabel(/Remove it, and say why/).fill('Named a student who had not consented.');
    await adminPage.getByRole('button', { name: 'Remove the post' }).click();
    await adminPage.waitForLoadState('networkidle');
    await admin.close();

    const db = sql();
    const [row] = await db`SELECT removed_at, removed_reason FROM channel_posts WHERE id = ${postId}`;
    const [report] = await db`SELECT resolved_at FROM content_reports WHERE post_id = ${postId}`;
    await db.end();

    expect(row.removed_at).toBeTruthy();
    expect(row.removed_reason).toContain('consented');
    // Removing the post answers every report about it.
    expect(report.resolved_at).toBeTruthy();

    // And the channel shows that a moderator was there rather than a gap.
    const back = await browser.newContext({ baseURL, storageState: UNILAG_ALUM });
    const backPage = await back.newPage();
    await backPage.goto(`/alumni/school/${unilagId}`);
    await expect(backPage.getByText(/A moderator removed this post/)).toBeVisible();
    await expect(backPage.getByText(POST)).toHaveCount(0);
    await back.close();
  });

  test('a broadcast reaches this school’s alumni and nobody else’s', async ({
    browser,
    baseURL,
  }) => {
    const subject = `Annual lecture ${RUN}`;

    const admin = await browser.newContext({ baseURL, storageState: ADMIN });
    const adminPage = await admin.newPage();
    await adminPage.goto('/admin/alumni');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.getByLabel('Subject (required)').fill(subject);
    await adminPage
      .getByLabel(/^Message/)
      .fill('The annual data protection lecture is on the 14th. All graduates welcome.');
    await adminPage.getByRole('button', { name: /Broadcast to our alumni/ }).click();
    await expect(adminPage.getByText(/in their school channel now/)).toBeVisible({
      timeout: 30_000,
    });
    await admin.close();

    const mine = await browser.newContext({ baseURL, storageState: UNILAG_ALUM });
    const minePage = await mine.newPage();
    await minePage.goto(`/alumni/school/${unilagId}`);
    await expect(minePage.getByText(subject)).toBeVisible();
    await mine.close();

    // ALM-11's "own alumni only" needs no send-time filter: the broadcast is
    // a row in this institution's channel, and there is nowhere else for it
    // to go.
    const theirs = await browser.newContext({ baseURL, storageState: UNN_ALUM });
    const theirsPage = await theirs.newPage();
    await theirsPage.goto(`/alumni/school/${unnId}`);
    await expect(theirsPage.getByText(subject)).toHaveCount(0);
    await theirs.close();
  });
});
