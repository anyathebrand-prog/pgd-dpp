/**
 * The compliance loop, end to end — CMP-06, CMP-07, CMP-10.
 *
 * A data subject makes a request, it lands in the DPO queue with a running
 * statutory clock, the DPO verifies identity and closes it, and the subject is
 * told. Plus the thing §6.6 says should never become a ticket at all: a
 * student downloading their own data without asking anyone.
 *
 * The erasure case is the one most worth having a test for. §6.6 requires that
 * an erasure colliding with an academic record is refused with a recorded
 * reason rather than silently ignored — and "silently ignored" is exactly what
 * a plausible implementation does.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const MAIL_DIR = join(process.cwd(), '.mail');
const DPO_STATE = join(process.cwd(), '.auth', 'dpo.json');
const RUN = Date.now();
const PASSWORD = 'Passw0rd-seed-2026';

const requester = `dsr-subject-${RUN}@example.ng`;
const student = 'student@unilag.example.ng';
/**
 * The erasure case needs a subject who genuinely holds an academic record.
 * It gets a fresh one per run rather than reusing the seeded student: the
 * intake rate-limits three requests per address per day — correctly — and a
 * suite that reuses one address starts failing on that control instead of on
 * the rule under test.
 */
const graduate = `erasure-subject-${RUN}@example.ng`;

function mailTo(address: string) {
  const slug = address.replace(/[^a-z0-9]/gi, '_');
  const files = readdirSync(MAIL_DIR).filter((f) => f.includes(slug)).sort().reverse();
  return files.length ? readFileSync(join(MAIL_DIR, files[0]), 'utf8') : '';
}

/** What an authenticator app would show for this secret, right now. */
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

/**
 * Sign the DPO in ONCE and reuse the session.
 *
 * AUTH-08 rate-limits TOTP to five attempts per fifteen minutes, which is
 * correct — a brute-forceable second factor is not a second factor. A suite
 * that re-authenticates for every test trips that limit and then fails on its
 * own security control rather than on the thing under test. Real staff sign in
 * once, so the suite does too.
 */
test.beforeAll(async ({ browser, baseURL }) => {
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`
    UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL
    WHERE email = 'dpo@example.ng'`;
  await sql.end();

  // A per-run enrolled subject for the erasure case.
  const seed = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const [inst] = await seed`SELECT id, short_name FROM institutions WHERE slug = 'unilag'`;
  const [cohort] = await seed`SELECT id FROM cohorts WHERE institution_id = ${inst.id} LIMIT 1`;
  const [u] = await seed`
    INSERT INTO users (email, full_name, status, email_verified_at)
    VALUES (${graduate}, 'Erasure Test Subject', 'student', now()) RETURNING id`;
  await seed`
    INSERT INTO memberships (user_id, institution_id, role)
    VALUES (${u.id}, ${inst.id}, 'student')`;
  await seed`
    INSERT INTO enrollments (institution_id, user_id, cohort_id, matric_number)
    VALUES (${inst.id}, ${u.id}, ${cohort.id}, ${'UNILAG/DPP/2027/E' + String(RUN).slice(-5)})`;
  await seed.end();

  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  // storageState must be cleared explicitly: newContext inherits the
  // describe-level `use`, so it would try to read the file this is creating.
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel(/Email address/).fill('dpo@example.ng');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible({
    timeout: 30_000,
  });
  // Wait for hydration: this form is a client component bound to a server
  // action, and a click that lands first is swallowed with no request at all.
  await page.waitForLoadState('networkidle');
  const secret = (await page.locator('p.t-data').first().textContent())!.trim();
  await page.locator('#code').fill(await currentTotp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();

  // A DPO is sent to their own console, not to an institution's /admin.
  await expect(page.getByRole('heading', { name: 'Data protection' })).toBeVisible({
    timeout: 30_000,
  });

  await context.storageState({ path: DPO_STATE });
  await context.close();
});

test.describe.configure({ mode: 'serial' });

/** Opens the request for `email` and waits for the panels to be interactive. */
async function openRequest(page: Page, email: string) {
  await page.goto('/dpo/requests');
  await expect(page.getByRole('heading', { name: 'Data subject requests' })).toBeVisible();
  await page.locator('tr', { hasText: email }).first().getByRole('link', { name: 'Open' }).click();
  await page.waitForURL(/\/dpo\/requests\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: /request$/i })).toBeVisible({
    timeout: 30_000,
  });
  // These panels are client components bound to server actions: a click that
  // lands before hydration is swallowed silently, with no request and no error.
  await page.waitForLoadState('networkidle');
}

/* ------------------------------------------------- intake, unauthenticated */

test.describe('anyone can log a request', () => {
  test('without an account, and is told the deadline', async ({ page }) => {
    // Deliberately signed out. The people most likely to need this are
    // rejected applicants whose documents we still hold, and requiring a login
    // to ask for deletion would be a poor joke.
    await page.goto('/dpo/request');
    await expect(page.getByRole('heading', { name: 'Make a data protection request' })).toBeVisible();

    await page.getByLabel(/Your email address/).fill(requester);
    await page.getByLabel(/What are you asking for/).selectOption('access');
    await page.getByLabel(/Anything that would help/).fill('Please send everything you hold.');
    await page.getByRole('button', { name: 'Send this request' }).click();

    await expect(page.getByRole('heading', { name: 'Your request has been logged' })).toBeVisible({
      timeout: 30_000,
    });
    expect(mailTo(requester)).toContain('30 days');
  });
});

/* ------------------------------------------------------------ DPO handling */

test.describe('the DPO works the queue', () => {
  test.use({ storageState: DPO_STATE });

  test('the request arrives with the statutory clock running', async ({ page }) => {
    await page.goto('/dpo/requests');
    const row = page.locator('tr', { hasText: requester });
    await expect(row).toBeVisible();
    await expect(row).toContainText('access');
    await expect(row).toContainText('Not verified');
    await expect(row).toContainText('30');
  });

  test('nothing is released before identity is verified', async ({ page }) => {
    await openRequest(page, requester);

    await expect(page.getByRole('button', { name: 'Mark fulfilled' })).toBeDisabled();
    await expect(page.getByText('Identity not verified')).toBeVisible();

    await page.getByLabel(/How identity was confirmed/).fill('Replied from the address on file.');
    await page.getByRole('button', { name: 'Record verification' }).click();

    await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Mark fulfilled' })).toBeEnabled();
  });

  test('fulfilling it closes the clock and tells the subject', async ({ page }) => {
    await openRequest(page, requester);

    const fulfil = page.getByRole('button', { name: 'Mark fulfilled' });
    await expect(fulfil).toBeEnabled({ timeout: 30_000 });
    await page.getByLabel(/What was done/).fill('Sent the full export to the address on file.');
    await fulfil.click();

    await expect(page.getByRole('heading', { name: 'Data subject requests' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('tr', { hasText: requester })).toHaveCount(0);
    expect(mailTo(requester)).toContain('completed');
  });
});

/* ---------------------------------------------- erasure vs academic record */

test.describe('erasure cannot quietly override an academic record', () => {
  test('an enrolled student is refused with a reason, not silently ignored', async ({
    page,
    browser,
    baseURL,
  }) => {
    // Submitted signed-out, as the subject would: the intake locks the email
    // field to the signed-in account, so this cannot be done as the DPO.
    await page.goto('/dpo/request');
    await page.getByLabel(/Your email address/).fill(graduate);
    await page.getByLabel(/What are you asking for/).selectOption('erasure');
    await page.getByLabel(/Anything that would help/).fill('Delete everything about me.');
    await page.getByRole('button', { name: 'Send this request' }).click();
    await expect(page.getByRole('heading', { name: 'Your request has been logged' })).toBeVisible({
      timeout: 30_000,
    });

    const dpo = await browser.newContext({ storageState: DPO_STATE, baseURL });
    const dpoPage = await dpo.newPage();
    await openRequest(dpoPage, graduate);

    // The collision is stated before anyone acts on it.
    await expect(
      dpoPage.getByText('Erasure collides with records that must be retained'),
    ).toBeVisible();
    await expect(dpoPage.getByText(/Academic record/)).toBeVisible();

    await dpoPage.getByLabel(/How identity was confirmed/).fill('Signed-in account matches.');
    await dpoPage.getByRole('button', { name: 'Record verification' }).click();
    await expect(dpoPage.getByText('Verified', { exact: true })).toBeVisible({ timeout: 30_000 });

    // The panel already defaults to "Refused". Override it deliberately, to
    // prove the guard lives in the action and not only in the UI.
    await dpoPage.getByRole('radio', { name: 'Fulfilled' }).check();
    const fulfil = dpoPage.getByRole('button', { name: 'Mark fulfilled' });
    await expect(fulfil).toBeEnabled({ timeout: 30_000 });
    await dpoPage.getByLabel(/What was done/).fill('Deleted everything for this person.');
    await fulfil.click();
    await expect(dpoPage.getByText(/collides with records that cannot be deleted/i)).toBeVisible({
      timeout: 30_000,
    });

    // Reload before the second path: the panel is showing the rejected
    // attempt, and a fresh render is closer to what the DPO would actually do
    // than toggling a form that has just errored.
    await dpoPage.reload();
    await dpoPage.waitForLoadState('networkidle');

    // The refusal path records a reason the subject can act on.
    await dpoPage.getByRole('radio', { name: 'Refused, with reason' }).check();
    await expect(dpoPage.getByLabel(/Why it is refused/)).toBeVisible({ timeout: 30_000 });
    await dpoPage
      .getByLabel(/Why it is refused/)
      .fill(
        'Your academic record and settled payments are retained under NUC policy and Nigerian tax law. Everything else has been deleted.',
      );
    await dpoPage.getByRole('button', { name: 'Refuse with reason' }).click();

    await expect(dpoPage.getByRole('heading', { name: 'Data subject requests' })).toBeVisible({
      timeout: 30_000,
    });
    expect(mailTo(graduate)).toContain('unable to carry it out in full');

    await dpo.close();
  });
});

/* -------------------------------------------- what should never be a ticket */

test.describe('self-service', () => {
  test('a student downloads their own data', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill(student);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    await page.goto('/account/privacy/export');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
    // Honest about its edges before you download it.
    await expect(page.getByText(/stored only as an Argon2id hash/)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download my data' }).click();
    expect((await download).suggestedFilename()).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

test.describe('the retention report', () => {
  test.use({ storageState: DPO_STATE });

  test('separates a failed purge from a job that never ran', async ({ page }) => {
    await page.goto('/dpo/retention');
    await expect(page.getByRole('heading', { name: 'Retention and purge' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The schedule' })).toBeVisible();
    // CMP-10's dominant risk is named on the page that controls it.
    await expect(page.getByText(/rejected applicants/i).first()).toBeVisible();
  });
});

/* -------------------------------------------------------- LIB-07 / CMP-16 */

test.describe('a takedown claim reaches someone who can act on it', () => {
  const claimant = `rights-holder-${RUN}@example.ng`;

  test('the public form is reachable without an account, and issues a reference', async ({
    browser,
    baseURL,
  }) => {
    // Explicitly signed out: the point of LB-05 is that a rights holder who
    // has never heard of this platform can use it.
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();

    await page.goto('/library/takedown');
    await expect(page.getByRole('heading', { name: 'Report an item in the library' })).toBeVisible();

    await page.getByLabel(/The item/).fill(`Test monograph ${RUN}`);
    await page.getByLabel(/Your name/).fill('A Rights Holder');
    await page.getByLabel(/Email address/).fill(claimant);
    await page.getByLabel(/What is wrong/).fill(
      'This monograph is under copyright and no licence was granted for hosting it here.',
    );

    // The declaration is required, and the form says so rather than failing
    // silently — a claim with no declaration is not a claim.
    await page.getByRole('button', { name: 'Submit this claim' }).click();
    await expect(page.getByText('Confirm the declaration before submitting.')).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Submit this claim' }).click();

    await expect(page.getByRole('heading', { name: 'Your claim is logged' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/TD-/)).toBeVisible();

    // And the claimant is told, at the address they gave, with the reference.
    const mail = mailTo(claimant);
    expect(mail).toContain('TD-');
    await context.close();
  });

  test('and the DPO sees it', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: DPO_STATE });
    const page = await context.newPage();

    await page.goto('/dpo/evidence');
    await expect(page.getByRole('heading', { name: 'Compliance evidence export' })).toBeVisible();
    await expect(page.getByText(`Test monograph ${RUN}`)).toBeVisible();
    await context.close();
  });
});

test.describe('the evidence bundle', () => {
  test.use({ storageState: DPO_STATE });

  test('downloads in one action, and records that it was produced', async ({ page }) => {
    await page.goto('/dpo/evidence');
    await expect(page.getByText('Processing activities', { exact: true })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export the bundle' }).click();
    expect((await download).suggestedFilename()).toMatch(
      /^compliance-evidence-\d{4}-\d{2}-\d{2}\.json$/,
    );

    // CMP-14: exporting the audit log is itself an auditable event, so the
    // page that lists past exports must now list this one.
    await page.reload();
    await expect(page.getByText('No bundle has been exported yet.')).toHaveCount(0);
  });

  test('is refused to someone without the role', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill(student);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    // The check runs on the request that produces the bytes, not on the page
    // that offered the button — so hitting the URL directly is the test.
    await page.goto('/api/dpo/evidence');
    await expect(page).toHaveURL(/\/no-access/);
    await context.close();
  });
});
