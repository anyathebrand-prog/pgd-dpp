/**
 * The primary journey, end to end — app flow §3.1.
 *
 * discovery → account → OTP → application → documents → consent → submit
 *   → application fee → registry review → admit → accept → tuition → enrolled
 *
 * This is the one test that would have caught most of what a status-code sweep
 * cannot: a server action that silently fails, a form field that never persists,
 * a gate that lets someone through. It runs against the seeded fixture and the
 * simulated checkout, so it needs no Paystack keys but still settles through the
 * real webhook.
 *
 * OTPs and activation links are read out of `.mail/`, which is where the mailer
 * writes when no provider is configured — the same mechanism a developer uses
 * by hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

// Subdomain host, set as baseURL in playwright.config.ts. Routes are plain
// absolute paths, exactly as the application emits them in redirects.
const TENANT = '';
const MAIL_DIR = join(process.cwd(), '.mail');
const PASSWORD = 'Correct-Horse-42';

const RUN = Date.now();
const candidate = `e2e-candidate-${RUN}@example.ng`;
// Unique per run. Leftover rows from earlier runs share the registry queue, so
// a fixed name makes the row locator ambiguous the second time the suite runs.
const candidateName = `Amaka Eze ${RUN}`;

/** Reads the most recent message sent to an address and pulls out a 6-digit code. */
function latestOtp(to: string): string {
  const slug = to.replace(/[^a-z0-9]/gi, '_');
  const files = readdirSync(MAIL_DIR)
    .filter((f) => f.includes(slug))
    .sort()
    .reverse();
  expect(files.length, `no mail was written for ${to}`).toBeGreaterThan(0);
  const body = readFileSync(join(MAIL_DIR, files[0]), 'utf8');
  const code = /\b(\d{6})\b/.exec(body)?.[1];
  expect(code, `no six-digit code found in ${files[0]}`).toBeTruthy();
  return code!;
}

/**
 * The seed leaves registry staff without TOTP so the enrolment screen is
 * exercised on first login. A previous run leaves them enrolled, so reset to
 * the seeded state rather than branching the test on which screen appears.
 */
test.beforeAll(async () => {
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`
    UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL
    WHERE email = 'registry@unilag.example.ng'`;
  await sql.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a candidate goes from discovery to enrolled', () => {
  test('creates an account and verifies the email', async ({ page }) => {
    await page.goto(`${TENANT}/signup`);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    await page.getByLabel(/Full name/).fill(candidateName);
    await page.getByLabel(/Email address/).fill(candidate);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(candidate)).toBeVisible();

    await page.getByLabel(/Verification code/).fill(latestOtp(candidate));
    await page.getByRole('button', { name: 'Verify email' }).click();

    await page.waitForURL('**/apply', { timeout: 30_000 });

    // APP-07: the tracker is the first thing a verified candidate sees.
    await expect(page.getByRole('heading', { name: 'Your application' })).toBeVisible();
    await expect(page.getByText(/Your application is a draft/)).toBeVisible();
  });

  test('fills the application and it persists across steps', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/apply/personal`);

    await page.getByLabel('Full name (required)').fill(candidateName);
    await page.getByLabel(/Date of birth/).fill('1993-07-19');
    await page.getByLabel(/Gender/).selectOption('female');
    await page.getByLabel(/Phone number/).fill('08061234567');
    await page.getByLabel(/Residential address/).fill('22 Awolowo Road, Ikoyi');
    await page.getByLabel(/State of origin/).fill('Anambra');
    await page.getByLabel(/Nationality/).fill('Nigerian');
    await page.getByLabel(/Next of kin name/).fill('Chidi Eze');
    await page.getByLabel(/Next of kin phone/).fill('08067654321');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Education history' })).toBeVisible();

    await page.getByLabel(/Institution attended/).fill('University of Ibadan');
    await page.getByLabel(/Degree awarded/).fill('LLB');
    await page.getByLabel(/Class of degree/).selectOption('2:1');
    await page.getByLabel(/Year of graduation/).fill('2016');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Work and sponsor' })).toBeVisible();
    await page.getByLabel(/Sponsor \(/).selectOption('self');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

    // APP-03: go back and confirm the autosave actually landed, rather than
    // trusting that the redirect implied a write.
    await page.goto(`${TENANT}/apply/personal`);
    await expect(page.getByLabel('Full name (required)')).toHaveValue(candidateName);
    await expect(page.getByLabel(/State of origin/)).toHaveValue('Anambra');
  });

  test('uploads the five required documents', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/apply/documents`);

    const kinds = [
      'Degree certificate',
      'Academic transcript',
      'NYSC certificate or exemption',
      'Passport photograph',
      'Photo identification',
    ];

    for (const kind of kinds) {
      const slot = page.locator('li', { has: page.getByRole('heading', { name: kind, exact: true }) });
      await slot.locator('input[type=file]').setInputFiles({
        name: `${kind.toLowerCase().replace(/\W+/g, '-')}.pdf`,
        mimeType: 'application/pdf',
        // A minimal but genuine PDF, so the content-type check is not the only
        // thing standing between us and a file that is not what it claims.
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
      });
      await slot.getByRole('button', { name: /Upload|Replace/ }).click();
      await expect(slot.getByText(/on file|waiting to be checked/)).toBeVisible();
    }
  });

  test('records consent and refuses to proceed without the required one', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/apply/consent`);

    // CMP-06: the required consent is genuinely required, and the refusal has to
    // be legible rather than a silent no-op.
    await page.getByRole('button', { name: 'Record my choices' }).click();
    await expect(page.getByText(/cannot proceed without the first consent/i)).toBeVisible();

    await page.getByLabel('Processing this application').check();
    await page.getByLabel('Appearing in the alumni directory when you graduate').check();
    await page.getByRole('button', { name: 'Record my choices' }).click();

    await expect(page.getByRole('heading', { name: 'Review and submit' })).toBeVisible();
  });

  test('submits, pays the application fee, and reaches the registry', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/apply/review`);

    // AP-08: with everything complete the button must be enabled and must name
    // the amount it is about to charge.
    const submit = page.getByRole('button', { name: /Submit and pay/ });
    await expect(submit).toBeEnabled();
    await expect(submit).toContainText('25,000');
    await expect(page.getByText(/non-refundable/)).toBeVisible();
    await submit.click();

    await expect(page.getByRole('heading', { name: 'Pay your application fee' })).toBeVisible();
    await page.getByRole('button', { name: /^Pay ₦25,000$/ }).click();

    // The simulated checkout stands in for Paystack and posts a signed webhook.
    await expect(page.getByRole('heading', { name: 'Simulated checkout' })).toBeVisible();
    await page.getByRole('button', { name: 'Simulate a successful charge' }).click();

    // PY-02 then PY-03: the browser polls, the webhook decides.
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(`${TENANT}/apply`);
    await expect(page.getByText(/Your application has been received/)).toBeVisible();
  });

  test('registry admits the candidate', async ({ page }) => {
    // AUTH-08: staff TOTP is mandatory, and the seeded officer has not enrolled,
    // so login must land on the enrolment screen rather than the console.
    await page.goto(`${TENANT}/login`);
    await page.getByLabel(/Email address/).fill('registry@unilag.example.ng');
    await page.getByLabel(/^Password/).fill('Passw0rd-seed-2026');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();

    // Derive a live code from the displayed secret, the way an app would.
    const secret = (await page.locator('p.t-data').first().textContent())!.trim();
    // Computed locally rather than imported from src: the TOTP module is
    // marked `server-only`, and the point here is to behave like a real
    // authenticator app anyway.
    const code = await currentTotp(secret);

    await page.getByLabel(/Code from your authenticator app/).fill(code);
    await page.getByRole('button', { name: 'Confirm and continue' }).click();

    await page.goto(`${TENANT}/admin/applications`);
    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();

    const row = page.locator('tr', { hasText: candidateName });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: /Review/ }).click();

    await expect(page.getByRole('heading', { name: candidateName })).toBeVisible();
    // CMP-13: documents are reachable only through expiring signed links.
    await expect(page.getByRole('link', { name: /Open .*\.pdf/ }).first()).toBeVisible();

    await page.getByLabel(/^Decision/).selectOption('admitted');
    await page.getByRole('button', { name: 'Review this decision' }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await page.getByRole('button', { name: 'Admit this candidate' }).click();

    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  });

  test('candidate accepts the offer, pays tuition, and is enrolled', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/apply/outcome`);

    await expect(page.getByRole('heading', { name: 'You have been offered a place' })).toBeVisible();
    // AP-10: days remaining, never a ticking timer, and never in danger red.
    await expect(page.getByText(/days remaining/)).toBeVisible();

    await page.getByRole('button', { name: 'Accept and pay' }).click();

    await expect(page.getByRole('heading', { name: 'Accept your place' })).toBeVisible();
    await page.getByRole('button', { name: /Pay ₦.* and enrol/ }).click();

    await expect(page.getByRole('heading', { name: 'Simulated checkout' })).toBeVisible();
    await page.getByRole('button', { name: 'Simulate a successful charge' }).click();

    // PY-07: the matric number exists only because the webhook settled.
    await expect(page.getByRole('heading', { name: 'You are enrolled' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/UNILAG\/DPP\/\d{4}\//)).toBeVisible();
  });

  test('the enrolled student can reach the programme', async ({ page }) => {
    await login(page);
    await page.goto(`${TENANT}/dashboard`);
    await expect(page.getByRole('heading', { name: candidateName })).toBeVisible();
    await expect(page.getByText(/UNILAG\/DPP\/\d{4}\//)).toBeVisible();

    await page.goto(`${TENANT}/programme`);
    await expect(page.getByText('DPP-101 · The NDPA 2023 in practice')).toBeVisible();
  });
});

/* -------------------------------------------------------------------- helpers */

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${TENANT}/login`);
  await page.getByLabel(/Email address/).fill(candidate);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/(apply|dashboard)/, { timeout: 30_000 });
}

/** Generates the code an authenticator app would show for this secret, now. */
async function currentTotp(secret: string) {
  const { createHmac } = await import('node:crypto');
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));

  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}
