import 'server-only';
import { createHmac } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { signRequest } from './sigv4';

/**
 * Object storage — §7.6, CMP-13.
 *
 * Production is Cloudflare R2 (S3-compatible, zero egress, which is the whole
 * reason it is not S3: students downloading PDFs all month is exactly the
 * pattern that makes an S3 bill ugly). Locally the same interface writes under
 * `.storage/`.
 *
 * The driver is chosen by environment, like mail and payments:
 *
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *     all set: R2. The bucket stays private; nothing here makes it public.
 *   otherwise, in development: `.storage/` on this disk.
 *   otherwise, in production: refused, unless STORAGE_DRIVER=local says so.
 *     A hosted server's disk is wiped on deploy, and an applicant's degree
 *     certificate silently written there is a certificate lost.
 *
 * The rules that hold in both drivers, because they are the compliance
 * requirement rather than a driver detail:
 *
 *  - Keys are namespaced `institutions/{id}/...`, so storage isolation mirrors
 *    row isolation.
 *  - Nothing is ever public. Every read goes through a short-lived signed URL.
 *  - Originals are immutable. A replacement gets a new key; it does not
 *    overwrite, so a queried-and-replaced transcript leaves a trail.
 */

const ROOT = join(process.cwd(), '.storage');
const TTL_MS = 5 * 60_000;

export function documentKey(institutionId: string, applicationId: string, kind: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `institutions/${institutionId}/applications/${applicationId}/${kind}/${Date.now()}-${safe}`;
}

function resolve(key: string) {
  // A key is never allowed to escape its prefix, whatever a filename contained.
  const path = normalize(join(ROOT, key));
  if (!path.startsWith(normalize(ROOT))) throw new Error('Refusing to resolve a key outside the store');
  return path;
}

/* ------------------------------------------------------------ the driver */

function r2Config() {
  const account = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!account || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { account, accessKeyId, secretAccessKey, bucket };
}

function driver(): 'r2' | 'local' {
  if (r2Config()) return 'r2';
  if (process.env.NODE_ENV !== 'production' || process.env.STORAGE_DRIVER === 'local') return 'local';
  throw new Error(
    'File storage is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET. ' +
      'STORAGE_DRIVER=local keeps files on this disk, which a hosted deploy wipes.',
  );
}

async function r2(
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  opts: { body?: Buffer; headers?: Record<string, string> } = {},
) {
  const cfg = r2Config()!;
  // Each segment encoded, the slashes kept: keys are paths.
  const path = key.split('/').map(encodeURIComponent).join('/');
  const url = `https://${cfg.account}.r2.cloudflarestorage.com/${cfg.bucket}/${path}`;
  const { headers } = signRequest({
    method,
    url,
    headers: opts.headers,
    body: opts.body,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
  });
  return fetch(url, {
    method,
    headers,
    body: opts.body ? new Uint8Array(opts.body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
}

export async function putObject(key: string, body: Buffer) {
  if (driver() === 'r2') {
    const res = await r2('PUT', key, { body });
    if (!res.ok) throw new Error(`Storage refused the upload (${res.status})`);
    return;
  }
  const path = resolve(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export async function getObject(key: string) {
  if (driver() === 'r2') {
    const res = await r2('GET', key);
    if (!res.ok) throw new Error(`Storage could not return the file (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFileSync(resolve(key));
}

/**
 * Bytes `start` to `end` inclusive, and only those. A player seeking in a
 * lecture asks for a slice many times over; fetching the whole recording
 * for each one is the difference between a seek and a stall on 3G.
 */
export async function getObjectRange(key: string, start: number, end: number) {
  if (driver() === 'r2') {
    const res = await r2('GET', key, { headers: { Range: `bytes=${start}-${end}` } });
    if (!res.ok) throw new Error(`Storage could not return the range (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  const length = end - start + 1;
  const buffer = Buffer.alloc(length);
  const fd = openSync(resolve(key), 'r');
  try {
    const read = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * LRN-02. Lesson video lives under the institution prefix like everything
 * else, so storage isolation still mirrors row isolation — a uid on its own
 * names nothing.
 */
export function videoKey(institutionId: string, uid: string) {
  const safe = uid.replace(/[^a-zA-Z0-9._-]/g, '');
  return `institutions/${institutionId}/video/${safe}.mp4`;
}

/**
 * Size without reading the bytes, for range requests.
 *
 * Returns null rather than throwing when the object is missing: a lesson row
 * pointing at a video the store does not have is a content problem for a
 * facilitator, not a 500 for a student in the middle of a lesson.
 */
export async function objectSize(key: string): Promise<number | null> {
  if (driver() === 'r2') {
    const res = await r2('HEAD', key);
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length'));
    return Number.isFinite(length) ? length : null;
  }
  try {
    return statSync(resolve(key)).size;
  } catch {
    return null;
  }
}

/** CMP-10. The purge job calls this, and the deletion is verified, not assumed. */
export async function deleteObject(key: string) {
  if (driver() === 'r2') {
    const res = await r2('DELETE', key);
    // 404 means it is already gone, which is what the purge set out to make
    // true; anything else is a failure the retention report must show.
    return res.ok || res.status === 404;
  }
  try {
    rmSync(resolve(key), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Short-lived signed URL. The signature covers the key AND the expiry, so a
 * link cannot be extended by editing the query string, and it expires whether
 * or not anyone remembers it exists.
 */
export function signedUrl(key: string, ttlMs = TTL_MS) {
  const expires = Date.now() + ttlMs;
  const sig = createHmac('sha256', process.env.SESSION_SECRET ?? 'dev-secret')
    .update(`${key}:${expires}`)
    .digest('hex');
  return `/api/files?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sig}`;
}

export function signatureValid(key: string, expires: string, sig: string) {
  if (Number(expires) < Date.now()) return false;
  const expected = createHmac('sha256', process.env.SESSION_SECRET ?? 'dev-secret')
    .update(`${key}:${expires}`)
    .digest('hex');
  return expected === sig;
}

/**
 * APP-04 accepts PDF/JPG/PNG at 5MB. The size limit is checked here as well as
 * client-side, because client-side compression is a courtesy to the user's data
 * bundle, not a control.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function uploadProblem(file: File): string | null {
  if (file.size === 0) return 'That file is empty. Choose the file again.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB — photograph the page again at a lower quality, or save the PDF smaller.`;
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'That file type is not accepted. Upload a PDF, JPG or PNG.';
  }
  return null;
}
