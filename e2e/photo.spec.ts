/**
 * AP-06 passport photo crop (APP-05).
 *
 * The claims worth testing are the two the flow states outright: a photograph
 * too small to print is refused with the reason, and what gets saved is a
 * 35×45 crop large enough for an ID card — whatever shape went in.
 *
 * The PNGs are built here rather than kept as fixtures, so the size under
 * test is visible in the test.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import 'dotenv/config';

const STATE = join(process.cwd(), '.auth', 'photo-candidate.json');
const PASSWORD = 'Passw0rd-seed-2026';
const CANDIDATE = 'candidate@unilag.example.ng';
const TMP = join(process.cwd(), 'test-results', 'photo-fixtures');

let applicationId = '';
let previousStatus = '';

function sql() {
  return postgres(process.env.MIGRATION_DATABASE_URL!, { max: 1, onnotice: () => {} });
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** A real, decodable RGB PNG — the browser has to open it, not just parse it. */
function png(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = (x * 255) / width;
      raw[p + 1] = (y * 255) / height;
      raw[p + 2] = 160;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test.beforeAll(async ({ browser, baseURL }) => {
  mkdirSync(join(process.cwd(), '.auth'), { recursive: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'tiny.png'), png(220, 280));
  writeFileSync(join(TMP, 'wide.png'), png(1200, 900));

  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(/Email address/).fill(CANDIDATE);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'pgd_session'), {
      timeout: 30_000,
    })
    .toBe(true);
  await context.storageState({ path: STATE });
  await context.close();

  const db = sql();
  const [app] = await db`
    SELECT a.id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.email = ${CANDIDATE} LIMIT 1`;
  applicationId = app?.id ?? '';

  // AP-06 is part of filling in an application, so the application has to be
  // in a state where a candidate may still edit it. The seeded one has moved
  // on; it is put back in afterAll.
  const [row] = await db`SELECT status FROM applications WHERE id = ${applicationId}`;
  previousStatus = row.status;
  await db`UPDATE applications SET status = 'draft' WHERE id = ${applicationId}`;
  await db.end();
});

test.afterAll(async () => {
  const db = sql();
  await db`DELETE FROM documents WHERE application_id = ${applicationId} AND kind = 'passport_photo'`;
  await db`UPDATE applications SET status = ${previousStatus} WHERE id = ${applicationId}`;
  await db.end();
});

test.describe.configure({ mode: 'serial' });

test.describe('AP-06 — the passport photograph', () => {
  test.use({ storageState: STATE });

  test('says what the photograph is for, and what it is not', async ({ page }) => {
    await page.goto('/apply/documents/photo');
    await expect(page.getByRole('heading', { level: 1, name: 'Your photograph' })).toBeVisible();
    // §6.4's edge case: stated where the person is handing over their face,
    // not only in the privacy notice.
    await expect(page.getByText(/not.*run through facial recognition/i)).toBeVisible();
  });

  test('a photograph too small to print is refused, with the numbers', async ({ page }) => {
    await page.goto('/apply/documents/photo');
    await page.waitForLoadState('networkidle');

    await page.locator('#photo-file').setInputFiles(join(TMP, 'tiny.png'));

    await expect(page.getByText(/220×280/)).toBeVisible({ timeout: 30_000 });
    // Scoped to the banner: the helper text under the file input names the
    // same minimum, which is the point of it.
    await expect(page.getByText(/at least 413×531/).first()).toBeVisible();
    // Refused before there is anything to save.
    await expect(page.getByRole('button', { name: 'Save photo' })).toHaveCount(0);
  });

  test('a landscape photograph is cropped to 35×45 and saved big enough to print', async ({
    page,
  }) => {
    await page.goto('/apply/documents/photo');
    await page.waitForLoadState('networkidle');

    await page.locator('#photo-file').setInputFiles(join(TMP, 'wide.png'));
    await expect(page.getByRole('button', { name: 'Save photo' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Save photo' }).click();
    await expect(page.getByText('Your photograph is on your application')).toBeVisible({
      timeout: 30_000,
    });

    const db = sql();
    const [row] = await db`
      SELECT content_type, size_bytes, status FROM documents
      WHERE application_id = ${applicationId} AND kind = 'passport_photo' AND status = 'uploaded'`;
    await db.end();

    expect(row.content_type).toBe('image/jpeg');
    expect(row.status).toBe('uploaded');
    // A 600×771 JPEG of real pixels is never a handful of bytes; a canvas
    // that failed to draw would still produce a valid but tiny file.
    expect(Number(row.size_bytes)).toBeGreaterThan(2000);

    // The dimensions the *server* measured on the bytes it received — the
    // claim the whole screen exists to make, and the one a byte count cannot
    // prove. A 1200×900 landscape photograph went in.
    const log = sql();
    const [entry] = await log`
      SELECT detail FROM audit_log
      WHERE action = 'document.uploaded' AND detail->>'kind' = 'passport_photo'
      ORDER BY created_at DESC LIMIT 1`;
    await log.end();
    expect(entry.detail).toMatchObject({ width: 600, height: 771 });
  });

  test('and the documents checklist now offers to crop it again', async ({ page }) => {
    await page.goto('/apply/documents');
    await expect(page.getByRole('link', { name: 'Crop it again' })).toBeVisible();
  });
});
