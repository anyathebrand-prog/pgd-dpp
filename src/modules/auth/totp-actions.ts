'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { generateSecret, totpValid } from './totp';
import type { FormState } from './actions';

/** AU-07. The secret is issued but not confirmed until a code proves it works. */
export async function beginTotpEnrolment() {
  const me = await requireUser();
  const [user] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);
  if (user?.totpConfirmedAt && user.totpSecret) return user.totpSecret;
  const secret = generateSecret();
  await db.update(users).set({ totpSecret: secret, totpConfirmedAt: null }).where(eq(users.id, me.userId));
  return secret;
}

export async function confirmTotpEnrolment(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const [user] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);
  if (!user?.totpSecret) return { error: 'Start the setup again — no secret is pending for this account.' };

  if (!totpValid(user.totpSecret, String(form.get('code') ?? ''))) {
    return { error: 'That code did not match. Check your phone clock is set automatically, then try the next code.' };
  }

  await db.update(users).set({ totpConfirmedAt: new Date() }).where(eq(users.id, me.userId));
  await db.update(sessions).set({ mfaSatisfied: true }).where(eq(sessions.id, me.sessionId));
  await audit({ action: 'auth.totp_enrolled', actorId: me.userId, subjectId: me.userId });
  redirect('/admin');
}

/** AU-08 challenge. */
export async function verifyTotp(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  // A brute-forceable second factor is not a second factor.
  if (!rateLimit(`totp:${me.userId}`, 5, 15 * 60_000).allowed) {
    return { error: 'Too many codes have been tried. Wait 15 minutes before trying again.' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);
  if (!user?.totpSecret || !user.totpConfirmedAt) redirect('/security/2fa/setup');

  if (!totpValid(user.totpSecret, String(form.get('code') ?? ''))) {
    await audit({ action: 'auth.totp_failed', actorId: me.userId, subjectId: me.userId });
    return { error: 'That code did not match. Wait for the next one and try again.' };
  }

  await db.update(sessions).set({ mfaSatisfied: true }).where(eq(sessions.id, me.sessionId));
  await audit({ action: 'auth.totp_ok', actorId: me.userId, subjectId: me.userId });
  redirect('/admin');
}
