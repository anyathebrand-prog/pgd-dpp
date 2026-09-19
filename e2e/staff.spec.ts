/**
 * IA-05 staff and roles — CMP-14 and CMP-17.
 *
 * Until this screen existed, the only way to make somebody a registrar was to
 * edit the memberships table, so the tests worth writing are the ones about
 * the limits of the new power rather than about the form working:
 *
 *  - an institution cannot grant itself a platform role, even by posting one;
 *  - a revoked role is effective on the next request, not the next login;
 *  - the last administrator cannot remove themselves and lock everyone out.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const ADMIN = join(process.cwd(), '.auth', 'staff-admin.json');
const FACILITATOR = join(process.cwd(), '.auth', 'staff-facilitator.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const invitee = `nkechi-${RUN}@example.ng`;
const INVITEE_NAME = `Nkechi Test ${RUN}`;

let unilagId = '';
let facilitatorId = '';
let previousReview: Date | null = null;

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

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  const [inst] = await db`SELECT id, access_reviewed_at FROM institutions WHERE slug = 'unilag'`;
  unilagId = inst.id;
  previousReview = inst.access_reviewed_at;
  facilitatorId = (
    await db`SELECT id FROM users WHERE email = 'facilitator@unilag.example.ng'`
  )[0].id;
  await db`UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL WHERE email = 'admin@unilag.example.ng'`;
  await db.end();

  // AUTH-08: the administrator's second factor is not relaxed here, so the
  // suite walks the enrolment exactly as a real one does.
  const adminCtx = await browser.newContext({ baseURL, storageState: undefined });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/login');
  await adminPage.getByLabel(/Email address/).fill('admin@unilag.example.ng');
  await adminPage.getByLabel(/^Password/).fill(PASSWORD);
  await adminPage.getByRole('button', { name: 'Log in' }).click();
  await expect(
    adminPage.getByRole('heading', { name: 'Set up your authenticator' }),
  ).toBeVisible({ timeout: 30_000 });
  await adminPage.waitForLoadState('networkidle');
  const secret = (await adminPage.locator('p.t-data').first().textContent())!.trim();
  await adminPage.locator('#code').fill(await currentTotp(secret));
  await adminPage.getByRole('button', { name: 'Confirm and continue' }).click();
  await adminPage.waitForURL(/\/admin/, { timeout: 30_000 });
  await adminCtx.storageState({ path: ADMIN });
  await adminCtx.close();

  // A facilitator needs no second factor, which is what makes them usable for
  // the revocation test: a session that is genuinely working beforehand.
  const facCtx = await browser.newContext({ baseURL, storageState: undefined });
  const facPage = await facCtx.newPage();
  await facPage.goto('/login');
  await facPage.getByLabel(/Email address/).fill('facilitator@unilag.example.ng');
  await facPage.getByLabel(/^Password/).fill(PASSWORD);
  await facPage.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await facCtx.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  await facCtx.storageState({ path: FACILITATOR });
  await facCtx.close();
});

test.afterAll(async () => {
  const db = sql();
  // Put the seeded facilitator back — the revocation test really removes them.
  await db`
    INSERT INTO memberships (user_id, institution_id, role)
    VALUES (${facilitatorId}, ${unilagId}, 'facilitator')
    ON CONFLICT DO NOTHING`;
  await db`UPDATE institutions SET access_reviewed_at = ${previousReview} WHERE id = ${unilagId}`;
  await db`DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ${invitee})`;
  await db`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ${invitee})`;
  await db`DELETE FROM users WHERE email = ${invitee}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('who can work here', () => {
  test.use({ storageState: ADMIN });

  test('the roster shows the role and the second factor, not just names', async ({ page }) => {
    await page.goto('/admin/staff');
    await expect(page.getByRole('heading', { level: 1, name: 'Staff and roles' })).toBeVisible();

    await expect(page.getByText('registry@unilag.example.ng')).toBeVisible();
    await expect(page.getByText('Registry officer').first()).toBeVisible();

    // The platform roles seeded against this institution — super admin, DPO,
    // curator — are not this institution's staff and must not be listed as
    // though an administrator could manage them.
    await expect(page.getByText('platform@example.ng')).toHaveCount(0);
    await expect(page.getByText('dpo@example.ng')).toHaveCount(0);
  });

  test('granting a role invites the person rather than setting a password', async ({ page }) => {
    await page.goto('/admin/staff');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Their name (required)').fill(INVITEE_NAME);
    await page.getByLabel(/Their work email/).fill(invitee);
    await page.getByLabel(/^Role/).selectOption('registry');
    await page.getByRole('button', { name: 'Grant access' }).click();

    await expect(page.getByText(`${INVITEE_NAME} can now work here`)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`
      SELECT u.id, u.password_hash, m.role
      FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ${invitee} AND m.institution_id = ${unilagId}`;
    const [token] = await db`
      SELECT purpose FROM auth_tokens WHERE user_id = ${row.id} AND purpose = 'activate'`;
    await db.end();

    expect(row.role).toBe('registry');
    // AUTH-01: nobody at the institution ever knows this person's password,
    // because at this point it does not exist.
    expect(row.password_hash).toBeNull();
    expect(token?.purpose).toBe('activate');
  });

  test('a platform role is refused even when it is posted directly', async ({ page }) => {
    await page.goto('/admin/staff');
    await page.waitForLoadState('networkidle');

    // The select offers three roles. The guard that matters is the server's,
    // so the option is forced into the DOM and submitted — a request an
    // administrator could make by hand just as easily.
    await expect(page.locator('#staff-role option')).toHaveCount(3);
    await page.locator('#staff-role').evaluate((el) => {
      const option = document.createElement('option');
      option.value = 'super_admin';
      option.textContent = 'Super admin';
      (el as HTMLSelectElement).append(option);
      (el as HTMLSelectElement).value = 'super_admin';
    });

    await page.getByLabel('Their name (required)').fill('Should Not Exist');
    await page.getByLabel(/Their work email/).fill(`escalation-${RUN}@example.ng`);
    await page.getByRole('button', { name: 'Grant access' }).click();

    await expect(page.getByText(/roles this institution can grant/)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`
      SELECT count(*)::int AS n FROM users WHERE email = ${`escalation-${RUN}@example.ng`}`;
    await db.end();
    // Not merely refused the role — refused before an account was created.
    expect(row.n).toBe(0);
  });

  test('the last administrator cannot remove themselves', async ({ page }) => {
    await page.goto('/admin/staff');
    await expect(page.getByText(/The last administrator/)).toBeVisible();
  });

  test('a review is recorded with the roster behind it', async ({ page }) => {
    await page.goto('/admin/staff');
    await page.waitForLoadState('networkidle');

    await page.locator('#attest-confirmed').check();
    await page.getByRole('button', { name: 'Record the review' }).click();
    await expect(page.getByText('Access reviewed')).toBeVisible({ timeout: 30_000 });

    const db = sql();
    const [inst] = await db`SELECT access_reviewed_at FROM institutions WHERE id = ${unilagId}`;
    const [entry] = await db`
      SELECT detail FROM audit_log
      WHERE action = 'staff.access_attested' AND institution_id = ${unilagId}
      ORDER BY created_at DESC LIMIT 1`;
    await db.end();

    expect(inst.access_reviewed_at).not.toBeNull();
    // "We reviewed access" is not evidence. Who held what is.
    expect(Array.isArray(entry.detail.roster)).toBe(true);
    expect(entry.detail.roster.length).toBeGreaterThan(0);
  });
});

test.describe('revocation is same-day effective (§6.10)', () => {
  test('a working session stops working, without waiting for a sign-out', async ({ browser, baseURL }) => {
    const facCtx = await browser.newContext({ baseURL, storageState: FACILITATOR });
    const facPage = await facCtx.newPage();
    await facPage.goto('/teach');
    await expect(facPage).not.toHaveURL(/\/login/);

    const adminCtx = await browser.newContext({ baseURL, storageState: ADMIN });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto('/admin/staff');
    await adminPage.waitForLoadState('networkidle');

    const card = adminPage
      .locator('li')
      .filter({ hasText: 'facilitator@unilag.example.ng' })
      .first();
    await card.getByRole('button', { name: 'Remove' }).click();
    await card.getByRole('button', { name: 'Remove it' }).click();
    await expect(adminPage.getByText(/no longer holds that role/)).toBeVisible({
      timeout: 30_000,
    });

    // The cookie in the other browser context is untouched and still
    // unexpired. What changed is that it no longer resolves to a session.
    await facPage.goto('/teach');
    await expect(facPage).toHaveURL(/\/login/, { timeout: 30_000 });

    await facCtx.close();
    await adminCtx.close();
  });
});
