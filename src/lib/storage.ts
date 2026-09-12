import 'server-only';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/**
 * Object storage — §7.6, CMP-13.
 *
 * Production is Cloudflare R2 (S3-compatible, zero egress, which is the whole
 * reason it is not S3: students downloading PDFs all month is exactly the
 * pattern that makes an S3 bill ugly). Locally the same interface writes under
 * `.storage/`.
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

export async function putObject(key: string, body: Buffer) {
  const path = resolve(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

export async function getObject(key: string) {
  return readFileSync(resolve(key));
}

/** CMP-10. The purge job calls this, and the deletion is verified, not assumed. */
export async function deleteObject(key: string) {
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
