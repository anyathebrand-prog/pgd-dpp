/**
 * Prints the six-digit code an authenticator app would be showing right now
 * for a seeded staff account.
 *
 *     npm run totp -- registry@unilag.example.ng
 *
 * Local development only. AUTH-08 requires a second factor for registry,
 * institution admin, super admin and DPO accounts, and that requirement is
 * not relaxed in development — it would stop being tested if it were. This
 * reads the secret the server already stored and does the RFC 6238 maths on
 * it, which is what a phone would be doing, so nothing about the login path
 * is bypassed or made weaker.
 *
 * It is deliberately a script rather than anything the application imports.
 */
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import 'dotenv/config';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run totp -- <email>');
  process.exit(1);
}

const sql = postgres(process.env.MIGRATION_DATABASE_URL, { max: 1, onnotice: () => {} });
const [user] = await sql`SELECT totp_secret, totp_confirmed_at FROM users WHERE email = ${email}`;
await sql.end();

if (!user) {
  console.error(`No account with the address ${email}.`);
  process.exit(1);
}
if (!user.totp_secret) {
  console.error(
    [
      `${email} has no authenticator secret yet.`,
      '',
      'Log in with the password first. The account will be sent to the setup',
      'screen, which shows the key — leave that page open and run this again.',
    ].join('\n'),
  );
  process.exit(1);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = '';
for (const c of user.totp_secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
  bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
}
const bytes = [];
for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));

const step = 30;
const counter = Math.floor(Date.now() / 1000 / step);
const buf = Buffer.alloc(8);
buf.writeBigUInt64BE(BigInt(counter));

const digest = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
const offset = digest[digest.length - 1] & 0x0f;
const binary =
  ((digest[offset] & 0x7f) << 24) |
  (digest[offset + 1] << 16) |
  (digest[offset + 2] << 8) |
  digest[offset + 3];

const code = String(binary % 1_000_000).padStart(6, '0');
const secondsLeft = step - (Math.floor(Date.now() / 1000) % step);

console.log('');
console.log(`  ${code}`);
console.log('');
console.log(
  `  ${email} · ${user.totp_confirmed_at ? 'enrolled' : 'not yet confirmed'} · valid for ${secondsLeft}s`,
);
console.log('');
