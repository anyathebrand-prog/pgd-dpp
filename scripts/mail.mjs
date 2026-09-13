/**
 * Prints the most recent message the mailer wrote to `.mail/`.
 *
 *     npm run mail                        the latest message, whoever it is for
 *     npm run mail -- you@example.com     the latest one for that address
 *     npm run mail -- you@example.com 5   the last five for that address
 *
 * With no RESEND_API_KEY set, src/lib/mail.ts writes messages to `.mail/`
 * rather than sending them — deliberately, so the OTP, activation and reset
 * flows are fully testable locally without wiring a provider, and without the
 * classic accident of mailing real candidates from a developer's machine.
 * This is just a nicer way of reading that directory than sorting it by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '.mail');
const address = process.argv[2];
const count = Number(process.argv[3] ?? 1);

let files;
try {
  files = readdirSync(dir);
} catch {
  console.error('Nothing has been sent yet — .mail/ does not exist.');
  process.exit(1);
}

const slug = address ? address.replace(/[^a-z0-9]/gi, '_') : null;
const matching = files
  .filter((f) => f.endsWith('.txt') && (!slug || f.includes(slug)))
  .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.at - a.at)
  .slice(0, Math.max(1, count));

if (matching.length === 0) {
  console.error(
    address
      ? `No message has been written for ${address}. Check the address, or trigger the email again.`
      : 'No messages in .mail/ yet.',
  );
  process.exit(1);
}

for (const { f, at } of matching.reverse()) {
  const age = Math.round((Date.now() - at) / 60_000);
  console.log('─'.repeat(64));
  console.log(`${f}   ${age === 0 ? 'just now' : `${age} min ago`}`);
  console.log('─'.repeat(64));
  console.log(readFileSync(join(dir, f), 'utf8'));
}

// Codes expire in fifteen minutes, so say so rather than letting someone
// paste a stale one and read "that code has expired" as a broken login.
const newest = Math.round((Date.now() - matching[matching.length - 1].at) / 60_000);
if (newest >= 15) {
  console.log(`That message is ${newest} minutes old. Any code in it has expired — resend it.`);
}
