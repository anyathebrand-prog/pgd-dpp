/**
 * Live sessions and attendance — LRN-07 and LRN-10.
 *
 * The claim worth testing is the one an accreditation panel would ask about:
 * attendance is recorded at the moment the platform hands over the join link,
 * and the link is never printed on a page. If it were, a student could attend
 * without a record or hold a record without ever being given the link, and
 * the register would be evidence of nothing.
 *
 * The second claim is scoping: a session for one cohort is not offered to
 * another, which is what stops a register counting the wrong people.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const FACILITATOR = join(process.cwd(), '.auth', 'sessions-facilitator.json');
const STUDENT = join(process.cwd(), '.auth', 'sessions-student.json');
const PASSWORD = 'Passw0rd-seed-2026';
const RUN = Date.now();

const TITLE = `Breach response walkthrough ${RUN}`;
const OTHER = `Another cohort entirely ${RUN}`;

let sessionId = '';
let otherId = '';
let studentId = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  for (const [email, state] of [
    ['facilitator@unilag.example.ng', FACILITATOR],
    ['student@unilag.example.ng', STUDENT],
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

  const db = sql();
  studentId = (await db`SELECT id FROM users WHERE email = 'student@unilag.example.ng'`)[0].id;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM session_attendance WHERE session_id IN (SELECT id FROM live_sessions WHERE title IN (${TITLE}, ${OTHER}))`;
  await db`DELETE FROM live_sessions WHERE title IN (${TITLE}, ${OTHER})`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a facilitator schedules a session', () => {
  test.use({ storageState: FACILITATOR });

  test('it appears for the cohort it names', async ({ page }) => {
    await page.goto('/teach/sessions');
    await expect(page.getByRole('heading', { level: 1, name: 'Live sessions' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    // An hour from now, so it is upcoming rather than live.
    const soon = new Date(Date.now() + 60 * 60_000);
    const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

    await page.getByLabel('Title (required)').fill(TITLE);
    await page.getByLabel(/Join link/).fill('https://meet.example.com/breach-walkthrough');
    await page.locator('#session-new-starts').fill(local);
    await page.getByRole('button', { name: 'Schedule it' }).click();

    await expect(page.getByText(/Students on that cohort can see it/)).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`SELECT id, join_url FROM live_sessions WHERE title = ${TITLE}`;
    await db.end();
    sessionId = row.id;
    expect(row.join_url).toContain('meet.example.com');
  });

  test('a bad join link is refused rather than stored', async ({ page }) => {
    await page.goto('/teach/sessions');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Title (required)').fill('Not going to be scheduled');
    await page.getByLabel(/Join link/).fill('meet.example.com/no-scheme');
    await page.locator('#session-new-starts').fill('2027-01-01T10:00');
    await page.getByRole('button', { name: 'Schedule it' }).click();

    await expect(page.getByText(/starting with https/)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('a student joins it', () => {
  test.use({ storageState: STUDENT });

  test('the page never prints the link', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    // The whole point: the URL is not in the markup. Printing it would let
    // someone attend without a record, or copy it to somebody who should not
    // have it.
    expect(await page.content()).not.toContain('meet.example.com/breach-walkthrough');
    await expect(page.getByRole('button', { name: /Get the link|Join now/ })).toBeVisible();
  });

  test('and joining is what records attendance', async ({ page }) => {
    await page.goto('/live');
    await page.waitForLoadState('networkidle');

    const before = sql();
    const [{ n: countBefore }] =
      await before`SELECT count(*)::int AS n FROM session_attendance WHERE session_id = ${sessionId}`;
    await before.end();
    expect(countBefore).toBe(0);

    // The click leaves this application for the conferencing vendor, which is
    // what the button is for — so the navigation failing is expected and the
    // record is what is asserted.
    await page
      .getByRole('button', { name: /Get the link|Join now/ })
      .click()
      .catch(() => {});

    const after = sql();
    await expect
      .poll(
        async () => {
          const [row] =
            await after`SELECT count(*)::int AS n FROM session_attendance WHERE session_id = ${sessionId} AND user_id = ${studentId}`;
          return Number(row.n);
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    await after.end();
  });

  test('a session for another cohort is not offered', async ({ page }) => {
    // Scoped by cohort, so a register counts the people the session was for.
    const db = sql();
    const [inst] = await db`SELECT id FROM institutions WHERE slug = 'unilag'`;
    const [other] = await db`
      INSERT INTO cohorts (institution_id, programme_id, name, capacity, status)
      SELECT ${inst.id}, p.id, ${'Ghost intake ' + RUN}, 10, 'open' FROM programmes p
      WHERE p.institution_id = ${inst.id} LIMIT 1 RETURNING id`;
    const [row] = await db`
      INSERT INTO live_sessions (institution_id, cohort_id, title, join_url, starts_at)
      VALUES (${inst.id}, ${other.id}, ${OTHER}, 'https://meet.example.com/not-yours', now() + interval '2 hours')
      RETURNING id`;
    otherId = row.id;
    await db.end();

    await page.goto('/live');
    await expect(page.getByRole('heading', { name: OTHER })).toHaveCount(0);

    const cleanup = sql();
    await cleanup`DELETE FROM live_sessions WHERE id = ${otherId}`;
    await cleanup`DELETE FROM cohorts WHERE name = ${'Ghost intake ' + RUN}`;
    await cleanup.end();
  });

  test('the calendar invite carries the session but not the link', async ({ page }) => {
    // Back onto the site first: the join click in the previous test navigated
    // to a conferencing URL that does not resolve, and a relative fetch from
    // there has no origin to resolve against.
    await page.goto('/live');

    const ics = await page.evaluate(async (id) => {
      const res = await fetch(`/api/sessions/${id}/calendar`);
      return { status: res.status, body: await res.text() };
    }, sessionId);

    expect(ics.status).toBe(200);
    expect(ics.body).toContain('BEGIN:VCALENDAR');
    expect(ics.body).toContain(TITLE);
    // An .ics sits in an inbox for months. Putting the join URL in it would
    // route around the attendance record entirely.
    expect(ics.body).not.toContain('meet.example.com/breach-walkthrough');
  });
});

test.describe('and the facilitator reads the register', () => {
  test.use({ storageState: FACILITATOR });

  test('it counts against the cohort, and says what it can honestly claim', async ({ page }) => {
    await page.goto('/teach/sessions');
    await expect(page.getByText(/What the register actually says/)).toBeVisible();

    const row = page.locator('li', { hasText: TITLE });
    await expect(row.getByText(/of \d+/)).toBeVisible();
    await row.getByRole('group').click();
    await expect(row.getByText(/Kelechi Obi/)).toBeVisible();
  });
});
