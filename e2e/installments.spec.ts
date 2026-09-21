/**
 * PAY-09 — tuition in parts, with learning gated on the second.
 *
 * The journey the requirement describes, end to end: an institution offers a
 * plan; a candidate pays the first part and is enrolled; the second part
 * falls overdue and lessons pause; paying it resumes them. Plus the rule the
 * flow is explicit about — with no plan offered, the option does not appear
 * at all.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();
const PLANNER = `plan-${RUN}@example.ng`;
const NOPLAN = `noplan-${RUN}@example.ng`;
const STATE = join(process.cwd(), '.auth', 'plan-candidate.json');

let unilagId = '';
let lessonId = '';
const created: string[] = [];

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

async function makeCandidate(db: ReturnType<typeof sql>, email: string) {
  const [hash] = await db`SELECT password_hash FROM users WHERE email = 'student@unilag.example.ng'`;
  const [cohort] = await db`
    SELECT id FROM cohorts WHERE institution_id = ${unilagId} AND status = 'open' LIMIT 1`;
  const [u] = await db`
    INSERT INTO users (email, full_name, status, email_verified_at, password_hash)
    VALUES (${email}, ${'Plan Candidate'}, 'candidate', now(), ${hash.password_hash}) RETURNING id`;
  await db`INSERT INTO memberships (user_id, institution_id, role) VALUES (${u.id}, ${unilagId}, 'candidate')`;
  await db`
    INSERT INTO applications (institution_id, cohort_id, user_id, reference, status, submitted_at, decision_at)
    VALUES (${unilagId}, ${cohort.id}, ${u.id}, ${`PLAN-${RUN}-${created.length}`}, 'offer_accepted', now(), now())`;
  created.push(u.id);
}

async function signIn(browser: import('@playwright/test').Browser, baseURL: string, email: string) {
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
  return { context, page };
}

test.beforeAll(async () => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  const db = sql();
  unilagId = (await db`SELECT id FROM institutions WHERE slug = 'unilag'`)[0].id;
  const [lesson] = await db`
    SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id
    WHERE m.institution_id = ${unilagId} AND m.published = true LIMIT 1`;
  lessonId = lesson.id;

  // The institution offers two parts, thirty days apart.
  await db`UPDATE institutions SET tuition_installments = 2, installment_interval_days = 30 WHERE id = ${unilagId}`;
  await makeCandidate(db, PLANNER);
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  // Put the institution back: the funnel spec's full-payment button would
  // otherwise share a name with the plan's.
  await db`UPDATE institutions SET tuition_installments = 1, installment_interval_days = 60 WHERE id = ${unilagId}`;
  if (created.length) {
    await db`DELETE FROM transaction_lines WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id IN ${db(created)})`;
    await db`DELETE FROM transactions WHERE user_id IN ${db(created)}`;
    await db`DELETE FROM enrollments WHERE user_id IN ${db(created)}`;
    await db`DELETE FROM applications WHERE user_id IN ${db(created)}`;
    await db`DELETE FROM memberships WHERE user_id IN ${db(created)}`;
    await db`DELETE FROM users WHERE id IN ${db(created)}`;
  }
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('PAY-09 — paying tuition in parts', () => {
  test('the first part enrols, and the second is scheduled rather than charged', async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await signIn(browser, baseURL!, PLANNER);
    await page.goto('/pay/tuition');
    await expect(page.getByRole('heading', { name: 'Or pay in 2 parts' })).toBeVisible();

    await page.getByRole('button', { name: /Pay part 1, ₦.*, and enrol/ }).click();
    await expect(page.getByRole('heading', { name: 'Simulated checkout' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Simulate a successful charge' }).click();
    await expect(page.getByRole('heading', { name: 'You are enrolled' })).toBeVisible({
      timeout: 30_000,
    });
    await context.storageState({ path: STATE });
    await context.close();

    const db = sql();
    const parts = await db`
      SELECT installment_number, status, amount_kobo, due_at FROM transactions
      WHERE user_id = ${created[0]} AND context = 'tuition' ORDER BY installment_number`;
    await db.end();

    expect(parts).toHaveLength(2);
    expect(parts[0].status).toBe('success');
    // Not sent to Paystack yet, and invisible to the reconcile job.
    expect(parts[1].status).toBe('scheduled');
    // Thirty days out, give or take the seconds the test took.
    const days = (new Date(parts[1].due_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  test('lessons pause when the second part is overdue, and say what is owed', async ({ browser, baseURL }) => {
    const db = sql();
    await db`
      UPDATE transactions SET due_at = now() - interval '1 day'
      WHERE user_id = ${created[0]} AND installment_number = 2`;
    await db.end();

    const context = await browser.newContext({ baseURL, storageState: STATE });
    const page = await context.newPage();
    await page.goto(`/lesson/${lessonId}`);
    await expect(page.getByRole('heading', { name: 'Lessons are paused' })).toBeVisible();
    await expect(page.getByText(/Part 2 of your tuition was due/)).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByText(/Part 2 of your tuition is overdue/)).toBeVisible();
    await context.close();
  });

  test('paying it resumes them', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: STATE });
    const page = await context.newPage();
    await page.goto('/pay/plan');
    await page.getByRole('button', { name: 'Pay part 2' }).click();
    await expect(page.getByRole('heading', { name: 'Simulated checkout' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Simulate a successful charge' }).click();

    // Settled by the webhook, as every payment is.
    const db = sql();
    await expect
      .poll(
        async () => {
          const [row] = await db`
            SELECT status FROM transactions WHERE user_id = ${created[0]} AND installment_number = 2`;
          return row.status;
        },
        { timeout: 30_000 },
      )
      .toBe('success');
    const enrolments = await db`SELECT count(*)::int AS n FROM enrollments WHERE user_id = ${created[0]}`;
    await db.end();
    // Paid, and still enrolled exactly once.
    expect(enrolments[0].n).toBe(1);

    await page.goto(`/lesson/${lessonId}`);
    await expect(page.getByRole('heading', { name: 'Lessons are paused' })).toHaveCount(0);
    await context.close();
  });

  test('with no plan offered, the option does not exist on the page', async ({ browser, baseURL }) => {
    const db = sql();
    await db`UPDATE institutions SET tuition_installments = 1 WHERE id = ${unilagId}`;
    await makeCandidate(db, NOPLAN);
    await db.end();

    const { context, page } = await signIn(browser, baseURL!, NOPLAN);
    await page.goto('/pay/tuition');
    await expect(page.getByRole('heading', { name: 'Accept your place' })).toBeVisible();
    // PY-05: hidden entirely, not shown and disabled.
    await expect(page.getByText(/pay in \d parts/i)).toHaveCount(0);
    await context.close();
  });
});
