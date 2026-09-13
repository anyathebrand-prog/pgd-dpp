/**
 * LRN-02 — a facilitator attaches a video and a student watches it.
 *
 * The claim being tested is the access rule, not the playback. The route
 * follows CMP-13's principle for documents: the URL is not the authorisation.
 * A lesson video belongs to an institution, and a signed-in person from
 * anywhere else — or a stranger with the uid — gets nothing.
 *
 * Range support is asserted directly, because a player asking for bytes and
 * receiving the whole file is the difference between a lesson that seeks and
 * one that appears to have hung on a phone.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const FACILITATOR_STATE = join(process.cwd(), '.auth', 'video-facilitator.json');
const STUDENT_STATE = join(process.cwd(), '.auth', 'video-student.json');
const PASSWORD = 'Passw0rd-seed-2026';

let lessonId = '';
let uid = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

/** A tiny but structurally real MP4 — enough bytes to range over. */
function mp4() {
  const header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  return Buffer.concat([header, Buffer.alloc(64 * 1024, 0x21)]);
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });

  const db = sql();
  const [lesson] = await db`
    SELECT l.id FROM lessons l
    JOIN modules m ON m.id = l.module_id
    JOIN institutions i ON i.id = m.institution_id
    WHERE i.slug = 'unilag' AND m.code = 'DPP-101'
    ORDER BY l.position LIMIT 1`;
  lessonId = lesson.id;
  await db.end();

  for (const [email, state] of [
    ['facilitator@unilag.example.ng', FACILITATOR_STATE],
    ['student@unilag.example.ng', STUDENT_STATE],
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
});

test.afterAll(async () => {
  if (!lessonId) return;
  const db = sql();
  await db`UPDATE lessons SET video_uid = NULL, video_duration_seconds = NULL WHERE id = ${lessonId}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('a facilitator attaches a video', () => {
  test.use({ storageState: FACILITATOR_STATE });

  test('the upload lands and the lesson records it', async ({ page }) => {
    // Posted from inside the page: the upload is an XHR to a route handler
    // rather than a form action, which is the whole point of the design —
    // a lecture recording will not fit in a server action body.
    const status = await page.goto('/teach').then(async () => {
      return page.evaluate(
        async ({ id, bytes }) => {
          const file = new File([new Uint8Array(bytes)], 'lecture.mp4', { type: 'video/mp4' });
          const body = new FormData();
          body.set('lessonId', id);
          body.set('file', file);
          body.set('durationSeconds', '184');
          const res = await fetch('/api/video/upload', { method: 'POST', body });
          return res.status;
        },
        { id: lessonId, bytes: Array.from(mp4()) },
      );
    });
    expect(status).toBe(200);

    const db = sql();
    const [row] = await db`
      SELECT video_uid, video_duration_seconds FROM lessons WHERE id = ${lessonId}`;
    await db.end();
    expect(row.video_uid).toBeTruthy();
    expect(Number(row.video_duration_seconds)).toBe(184);
    uid = row.video_uid;
  });

  test('anything that is not an MP4 is refused, with a reason', async ({ page }) => {
    await page.goto('/teach');
    const result = await page.evaluate(async (id) => {
      const file = new File(['not a video'], 'notes.txt', { type: 'text/plain' });
      const body = new FormData();
      body.set('lessonId', id);
      body.set('file', file);
      const res = await fetch('/api/video/upload', { method: 'POST', body });
      return { status: res.status, body: await res.json() };
    }, lessonId);

    expect(result.status).toBe(415);
    expect(result.body.error).toMatch(/MP4/);
  });
});

test.describe('and a student watches it', () => {
  test.use({ storageState: STUDENT_STATE });

  test('serves the file, and serves ranges when asked for them', async ({ page }) => {
    await page.goto('/dashboard');

    const whole = await page.evaluate(async (id) => {
      const res = await fetch(`/api/video/${id}`);
      return { status: res.status, accept: res.headers.get('accept-ranges') };
    }, uid);
    expect(whole.status).toBe(200);
    expect(whole.accept).toBe('bytes');

    // The part that matters on a phone: a seek asks for a slice and gets a
    // slice, rather than the whole file with a 200.
    const part = await page.evaluate(async (id) => {
      const res = await fetch(`/api/video/${id}`, { headers: { Range: 'bytes=0-1023' } });
      return {
        status: res.status,
        range: res.headers.get('content-range'),
        length: (await res.arrayBuffer()).byteLength,
      };
    }, uid);
    expect(part.status).toBe(206);
    expect(part.length).toBe(1024);
    expect(part.range).toMatch(/^bytes 0-1023\/\d+$/);
  });
});

test.describe('and nobody else does', () => {
  test('a stranger with the uid gets nothing', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/login');
    const status = await page.evaluate(async (id) => {
      const res = await fetch(`/api/video/${id}`);
      return res.status;
    }, uid);
    expect(status).toBe(401);
    await context.close();
  });

  test('and a candidate who is not enrolled is refused', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel(/Email address/).fill('candidate@unilag.example.ng');
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|apply)/, { timeout: 30_000 });

    // Signed in at the right institution, but not enrolled — so the video is
    // not theirs to watch, and knowing the uid changes nothing.
    const status = await page.evaluate(async (id) => {
      const res = await fetch(`/api/video/${id}`);
      return res.status;
    }, uid);
    expect(status).toBe(403);
    await context.close();
  });
});
