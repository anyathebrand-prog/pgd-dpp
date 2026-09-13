'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { clientIp, passwordProblem, requireUser, revokeAllSessions } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import type { FormState } from './actions';

/**
 * ST-14 and ST-17.
 *
 * CMP-07's point about rectification is that most of it should never become a
 * request at all: if a candidate can fix their own phone number, the DPO
 * queue stays for the cases that genuinely need a person. So this is the
 * self-service half of the rights console, and it is deliberately narrow —
 * the fields here are the ones nobody needs permission to change.
 */

/** ST-14. Name and phone. Email is identity and is not edited in place. */
export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const fullName = String(form.get('fullName') ?? '').trim();
  const phone = String(form.get('phone') ?? '').trim();

  if (fullName.length < 2) return { error: 'Enter the name you want us to use.' };
  if (phone && !/^[0-9+\-()\s]{7,20}$/.test(phone)) {
    return { error: 'Enter a phone number we could actually call, or leave it blank.' };
  }

  const [before] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);

  await db
    .update(users)
    .set({ fullName, phone: phone || null, updatedAt: new Date() })
    .where(eq(users.id, me.userId));

  // CMP-14: a change to a person's own record is still a change to a record,
  // and the before/after is what makes the log worth keeping.
  await audit({
    action: 'account.profile_updated',
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'users',
    entityId: me.userId,
    detail: {
      fullName: { from: before?.fullName ?? null, to: fullName },
      phone: { from: before?.phone ?? null, to: phone || null },
    },
  });

  return { notice: 'Your details are saved.' };
}

/**
 * ST-14. AUTH-02 and AUTH-03 apply here exactly as they do at activation —
 * the weakest password a system accepts is its real policy.
 */
export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const current = String(form.get('current') ?? '');
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  // AUTH-06's shape, applied to the one place an attacker with a live session
  // could otherwise brute-force the existing password at leisure.
  if (!rateLimit(`pw-change:${me.userId}`, 5, 15 * 60_000).allowed) {
    return { error: 'Too many attempts. Wait fifteen minutes and try again.' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
    return { error: 'That is not your current password.' };
  }
  if (password !== confirm) return { error: 'The two new passwords do not match.' };
  if (password === current) return { error: 'That is the password you already have.' };

  const problem = passwordProblem(password, user.email);
  if (problem) return { error: problem };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, me.userId));

  // Every other session dies, this one survives. A password change is how
  // someone responds to a suspicion, so leaving the other sessions alive
  // would answer the suspicion with nothing.
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, me.userId), isNull(sessions.revokedAt)));
  await db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, me.sessionId));

  await audit({
    action: 'auth.password_changed',
    actorId: me.userId,
    subjectId: me.userId,
    detail: { ip: clientIp(await (await import('next/headers')).headers()) },
  });

  return { notice: 'Your password is changed, and every other session has been signed out.' };
}

/** ST-17. One session, ended from the list. */
export async function revokeSession(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const id = String(form.get('sessionId') ?? '');

  if (id === me.sessionId) {
    // §5 marks the current session as not revocable in isolation — ending it
    // from here is signing out, and calling it something else would be a
    // small lie about what just happened.
    return { error: 'That is the session you are using. Sign out instead.' };
  }

  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.userId, me.userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  if (result.length === 0) return { error: 'That session has already ended.' };

  await audit({
    action: 'auth.session_revoked',
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'sessions',
    entityId: id,
  });

  return { notice: 'That session has been signed out.' };
}

/**
 * ST-17, AUTH-07. Everything, including this one — which is the point: the
 * person doing this suspects they are not the only one signed in.
 *
 * It returns a redirect rather than calling `redirect()`, because a server
 * action that redirects commits its writes and then lands the router on `/`.
 */
export async function signOutEverywhereAction(): Promise<FormState> {
  const me = await requireUser();
  await revokeAllSessions(me.userId);
  await audit({ action: 'auth.revoke_all_sessions', actorId: me.userId, subjectId: me.userId });
  return { redirectTo: '/login?signedout=1' };
}

/*
 * The session list itself is read in the page, not exported from here. Every
 * export in a 'use server' module is a live endpoint, so a helper taking a
 * userId would be an unauthenticated "read anyone's sessions" API reachable
 * from any browser.
 */
