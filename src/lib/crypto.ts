import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * AUTH-03. Argon2id. Never logged, never emailed, never shown to an admin.
 * Parameters follow OWASP's current minimum for Argon2id (19 MiB, t=2, p=1).
 */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string) {
  return argonHash(plain, ARGON);
}

export async function verifyPassword(hashValue: string, plain: string) {
  try {
    return await argonVerify(hashValue, plain, ARGON);
  } catch {
    return false;
  }
}

/** Tokens are random, stored hashed, and compared in constant time. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** AU-02. Six digits, from a CSPRNG rather than Math.random. */
export function randomOtp() {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function constantTimeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * IPs are pepper-hashed rather than stored raw. We need them for rate limiting
 * and for the audit log; we do not need to be able to read them back, and an
 * IP is personal data under the NDPA.
 */
export function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  return createHmac('sha256', process.env.SESSION_SECRET ?? 'dev-secret').update(ip).digest('hex');
}

/** PAY-04. HMAC SHA512 over the raw body, compared in constant time. */
export function paystackSignatureValid(rawBody: string, signature: string | null) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  return constantTimeEqual(expected, signature);
}

/** Human-readable, unambiguous references. No O/0/I/1 confusion on the phone. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function humanCode(length = 10) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
