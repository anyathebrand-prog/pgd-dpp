import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';

/**
 * RFC 6238 TOTP, implemented directly.
 *
 * This is thirty lines of well-specified arithmetic. Pulling a dependency into
 * the authentication path for it would add a supply-chain surface and a
 * sub-processor question (CMP-11/CMP-12) to save nothing.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side, for clock drift on a cheap phone. */
const WINDOW = 1;

export function generateSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret: string) {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret: string, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpValid(secret: string, code: string, now = Date.now()) {
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  const candidate = code.replace(/\s/g, '');
  for (let drift = -WINDOW; drift <= WINDOW; drift++) {
    if (codeAt(secret, counter + drift) === candidate) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
