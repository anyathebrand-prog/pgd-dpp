import 'server-only';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Transactional email. Deliverability is a funnel requirement, not a nicety
 * (§8) — an activation email in spam is a lost enrollment, so production runs
 * on a dedicated sending domain with SPF, DKIM and DMARC configured.
 *
 * With no API key set, messages are written to `.mail/` instead of sent. That
 * keeps the activation and reset flows fully testable locally without wiring a
 * provider, and without the classic accident of mailing real candidates from a
 * developer's machine.
 */
export type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? 'PGD-DPP Platform <no-reply@example.ng>';

  if (!key) {
    const dir = join(process.cwd(), '.mail');
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${mail.to.replace(/[^a-z0-9]/gi, '_')}.txt`;
    writeFileSync(
      join(dir, name),
      `To: ${mail.to}\nFrom: ${from}\nSubject: ${mail.subject}\n\n${mail.text}\n`,
      'utf8',
    );
    console.log(`[mail] wrote .mail/${name} (no RESEND_API_KEY set)`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: mail.to, subject: mail.subject, text: mail.text }),
  });
  if (!res.ok) {
    // Never throw into the request path over a mail failure — the account was
    // still created. The worker retries; the user sees a "resend" control.
    console.error('[mail] send failed', res.status, await res.text());
  }
}

/**
 * AUTH-01. The activation link, not a generated password. A password sitting
 * in an inbox in plaintext is a permanent, unrotatable credential leak.
 */
export function activationMail(to: string, url: string, institution: string): Mail {
  return {
    to,
    subject: `Set your password — ${institution}`,
    text: [
      `Your account at ${institution} is ready.`,
      '',
      'Set your password using the link below. It works once and expires in 24 hours.',
      url,
      '',
      'If you did not expect this, you can ignore it and nothing will change.',
    ].join('\n'),
  };
}

export function otpMail(to: string, code: string): Mail {
  return {
    to,
    subject: `${code} is your verification code`,
    text: [
      `Your verification code is ${code}.`,
      '',
      'It expires in 15 minutes and can be used once.',
      'Nobody from the platform will ever ask you for this code.',
    ].join('\n'),
  };
}

/** AUTH-04. The wording is identical whether or not the account exists. */
export function resetMail(to: string, url: string): Mail {
  return {
    to,
    subject: 'Reset your password',
    text: [
      'Use the link below to set a new password. It works once and expires in 30 minutes.',
      url,
      '',
      'If you did not request this, no action is needed.',
    ].join('\n'),
  };
}

/** PAY-07. */
export function receiptMail(to: string, reference: string, amountKobo: number, what: string): Mail {
  return {
    to,
    subject: `Payment received — ${reference}`,
    text: [
      `We have received your payment of NGN ${(amountKobo / 100).toLocaleString('en-NG')} for ${what}.`,
      '',
      `Payment reference: ${reference}`,
      '',
      'A receipt is available from your portal at any time.',
    ].join('\n'),
  };
}

/**
 * LIB-07. Two mails: one telling the claimant their claim is real and has a
 * reference, one putting it in front of the people who can act on it.
 */
export function takedownAcknowledgement(to: string, reference: string): Mail {
  return {
    to,
    subject: `Takedown claim received — ${reference}`,
    text: [
      'We have received your claim about an item in the library.',
      '',
      `Your reference: ${reference}`,
      '',
      'A curator reviews every claim, and the Data Protection Officer is copied on all of them.',
      'Where a claim is upheld the item is withdrawn and the page explains that it was, rather',
      'than disappearing.',
      '',
      'Quote the reference above in any correspondence about this claim.',
    ].join('\n'),
  };
}

export function takedownNotice(to: string, reference: string, basis: string, item: string): Mail {
  return {
    to,
    subject: `Takedown claim ${reference} (${basis})`,
    text: [
      `A takedown claim has been logged against: ${item}`,
      '',
      `Reference: ${reference}`,
      `Basis: ${basis}`,
      '',
      'It is in the claims queue in the DPO console.',
    ].join('\n'),
  };
}

/** PAY-11. A rejected proof is not a rejected payment — the charge is still owed. */
export function offlineRejectedMail(to: string, reference: string, reason: string): Mail {
  return {
    to,
    subject: `Transfer not confirmed — ${reference}`,
    text: [
      'The institution could not confirm your bank transfer against their statement.',
      '',
      `Payment reference: ${reference}`,
      `Reason given: ${reason}`,
      '',
      'The payment is still outstanding. You can submit clearer evidence of the transfer,',
      'or pay by card instead — both are on the payment page in your portal.',
    ].join('\n'),
  };
}
