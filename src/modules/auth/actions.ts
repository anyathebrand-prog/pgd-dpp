'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { authTokens, memberships, users } from '@/db/schema';
import {
  clientIp,
  createSession,
  destroyCurrentSession,
  passwordProblem,
  requireUser,
  revokeAllSessions,
} from '@/lib/auth';
import { hashPassword, randomOtp, randomToken, sha256, verifyPassword } from '@/lib/crypto';
import { activationMail, otpMail, resetMail, sendMail } from '@/lib/mail';
import { lockoutMs, rateLimit, verifyTurnstile } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';
import { requireInstitution } from '@/lib/tenant';

export type FormState = { error?: string; notice?: string } | undefined;

const OTP_TTL_MS = 15 * 60_000;
const RESET_TTL_MS = 30 * 60_000;
const ACTIVATION_TTL_MS = 24 * 3_600_000;

/* -------------------------------------------------------------------- AU-01 */

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const h = await headers();
  const ip = clientIp(h);

  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const fullName = String(form.get('fullName') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'Enter an email address in the form name@example.com.' };
  }
  if (!fullName) return { error: 'Enter your full name as it appears on your degree certificate.' };

  const pwProblem = passwordProblem(password, email);
  if (pwProblem) return { error: pwProblem };

  if (!(await verifyTurnstile(String(form.get('cf-turnstile-response') ?? ''), ip))) {
    return { error: 'The security check did not complete. Reload the page and try again.' };
  }
  if (!rateLimit(`signup:${ip}`, 10, 60 * 60_000).allowed) {
    return { error: 'Too many accounts have been created from this connection. Try again in an hour.' };
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  let userId: string;
  if (existing) {
    // No user enumeration: an existing verified account gets the same screen as
    // a new one, and an email telling the real owner someone tried.
    if (existing.emailVerifiedAt) {
      await sendMail({
        to: email,
        subject: 'Someone tried to create an account with your email',
        text: 'You already have an account. If this was you, log in instead — or reset your password.',
      });
      redirect('/signup/verify');
    }
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({ email, fullName, passwordHash: await hashPassword(password), status: 'pending' })
      .returning({ id: users.id });
    userId = created.id;
  }

  await db
    .insert(memberships)
    .values({ userId, institutionId: institution.id, role: 'candidate' })
    .onConflictDoNothing();

  await issueOtp(userId, email);
  await audit({
    action: 'auth.signup',
    institutionId: institution.id,
    actorId: userId,
    subjectId: userId,
    entity: 'users',
    entityId: userId,
  });

  // A session before verification, so the pending screen knows who is waiting.
  await createSession(userId, { institutionId: institution.id });
  redirect('/signup/verify');
}

async function issueOtp(userId: string, email: string) {
  const code = randomOtp();
  await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, 'verify_email'), isNull(authTokens.consumedAt)));
  await db.insert(authTokens).values({
    userId,
    purpose: 'verify_email',
    tokenHash: sha256(randomToken()),
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await sendMail(otpMail(email, code));
}

/* -------------------------------------------------------------------- AU-02 */

export async function verifyEmail(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const code = String(form.get('code') ?? '').replace(/\s/g, '');

  const [token] = await db
    .select()
    .from(authTokens)
    .where(
      and(eq(authTokens.userId, me.userId), eq(authTokens.purpose, 'verify_email'), isNull(authTokens.consumedAt)),
    )
    .limit(1);

  if (!token || token.expiresAt < new Date()) {
    return { error: 'That code has expired. Request a new one.' };
  }
  if (token.attempts >= 5) {
    return { error: 'Too many attempts on this code. Request a new one.' };
  }
  if (token.codeHash !== sha256(code)) {
    await db.update(authTokens).set({ attempts: token.attempts + 1 }).where(eq(authTokens.id, token.id));
    return { error: 'That code does not match. Check the most recent email and try again.' };
  }

  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, token.id));
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), status: 'candidate', updatedAt: new Date() })
    .where(eq(users.id, me.userId));
  await audit({ action: 'auth.email_verified', actorId: me.userId, subjectId: me.userId });

  redirect('/apply');
}

/**
 * Plain form action, so the "send a new code" control works without
 * JavaScript. The outcome comes back as a query flag rather than as state,
 * because this button lives outside the main form on AU-02.
 */
export async function resendOtp(): Promise<void> {
  const me = await requireUser();
  if (!rateLimit(`otp:${me.userId}`, 3, 15 * 60_000).allowed) {
    redirect('/signup/verify?resent=throttled');
  }
  await issueOtp(me.userId, me.email);
  redirect('/signup/verify?resent=1');
}

/* -------------------------------------------------------------------- AU-03 */

export async function logIn(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const h = await headers();
  const ip = clientIp(h);
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const remember = form.get('remember') === 'on';

  // AUTH-06: five attempts per account per 15 minutes, plus IP throttling.
  if (!rateLimit(`login-ip:${ip}`, 30, 15 * 60_000).allowed) {
    redirect('/login/locked');
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // The same message either way. An attacker learns nothing about which
  // addresses hold accounts, which is the point of AUTH-04 and applies equally
  // to the login screen.
  const GENERIC = { error: 'Those details do not match an account. Check them and try again.' };

  if (!user || !user.passwordHash) return GENERIC;
  if (user.lockedUntil && user.lockedUntil > new Date()) redirect('/login/locked');

  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1;
    const lockFor = lockoutMs(failed);
    await db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil: lockFor ? new Date(Date.now() + lockFor) : null,
      })
      .where(eq(users.id, user.id));
    await audit({
      action: 'auth.login_failed',
      institutionId: institution.id,
      subjectId: user.id,
      detail: { attempt: failed },
    });
    if (lockFor) redirect('/login/locked');
    return GENERIC;
  }

  if (user.status === 'suspended') {
    return { error: 'This account is suspended. Contact the registry at your institution.' };
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  // AUTH-08. Staff roles cannot reach a console without clearing TOTP; the
  // session is created unsatisfied and the 2FA screen is the only way forward.
  const staffRoles = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.institutionId, institution.id)));
  const needsMfa = staffRoles.some((r) =>
    ['registry', 'institution_admin', 'super_admin', 'dpo'].includes(r.role),
  );

  await createSession(user.id, {
    institutionId: institution.id,
    remember,
    mfaSatisfied: !needsMfa,
  });
  await audit({
    action: 'auth.login',
    institutionId: institution.id,
    actorId: user.id,
    subjectId: user.id,
  });

  if (needsMfa && !user.totpConfirmedAt) redirect('/security/2fa/setup');
  if (needsMfa) redirect('/login/2fa');
  if (!user.emailVerifiedAt) redirect('/signup/verify');
  redirect(user.status === 'student' || user.status === 'alumni' ? '/dashboard' : '/apply');
}

export async function logOut() {
  const me = await requireUser().catch(() => null);
  if (me) await audit({ action: 'auth.logout', actorId: me.userId, subjectId: me.userId });
  await destroyCurrentSession();
  redirect('/login');
}

export async function signOutEverywhere() {
  const me = await requireUser();
  await revokeAllSessions(me.userId);
  await audit({ action: 'auth.revoke_all_sessions', actorId: me.userId, subjectId: me.userId });
  redirect('/login');
}

/* --------------------------------------------------------------- AU-04/05 */

export async function requestReset(_prev: FormState, form: FormData): Promise<FormState> {
  const h = await headers();
  const ip = clientIp(h);
  const email = String(form.get('email') ?? '').trim().toLowerCase();

  // Identical response whether or not the account exists (AUTH-04), including
  // when rate-limited — a differing message is itself an enumeration oracle.
  const SAME = {
    notice:
      'If an account exists for that address, a reset link is on its way. The link works once and expires in 30 minutes.',
  };

  if (!rateLimit(`reset-ip:${ip}`, 5, 15 * 60_000).allowed) return SAME;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return SAME;

  // A new request invalidates any outstanding one.
  await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(authTokens.userId, user.id), eq(authTokens.purpose, 'reset_password'), isNull(authTokens.consumedAt)),
    );

  const raw = randomToken();
  await db.insert(authTokens).values({
    userId: user.id,
    purpose: 'reset_password',
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const host = h.get('host');
  await sendMail(resetMail(email, `${proto}://${host}/reset/${raw}`));
  await audit({ action: 'auth.reset_requested', subjectId: user.id });
  return SAME;
}

/** Shared by AU-05 (reset) and AU-06 (activation) — same mechanics, different copy. */
export async function setPasswordWithToken(
  purpose: 'reset_password' | 'activate',
  raw: string,
  password: string,
  confirm: string,
): Promise<{ error: string } | { ok: true }> {
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  const [token] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(raw)), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)))
    .limit(1);

  if (!token || token.expiresAt < new Date()) {
    return { error: 'This link has expired or has already been used. Request a new one.' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, token.userId)).limit(1);
  const problem = passwordProblem(password, user?.email);
  if (problem) return { error: problem };

  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, token.id));
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerifiedAt: user?.emailVerifiedAt ?? new Date(),
      status: user?.status === 'pending' ? 'candidate' : user!.status,
      updatedAt: new Date(),
    })
    .where(eq(users.id, token.userId));

  // Setting a password invalidates every existing session. If the reset was
  // prompted by a compromise, leaving the attacker's session alive defeats it.
  await revokeAllSessions(token.userId);
  await audit({ action: `auth.${purpose}`, subjectId: token.userId });
  return { ok: true };
}

/**
 * AUTH-01. Issued when registry enrols someone, and never a generated
 * password: a password sitting in an inbox is a permanent, unrotatable
 * credential leak, and it is an indefensible look for a data protection
 * programme.
 */
export async function issueActivationLink(userId: string, email: string, institutionName: string, host: string) {
  const raw = randomToken();
  await db.insert(authTokens).values({
    userId,
    purpose: 'activate',
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
  });
  const proto = process.env.APP_PROTOCOL ?? 'http';
  await sendMail(activationMail(email, `${proto}://${host}/activate/${raw}`, institutionName));
}

/**
 * The form-facing wrapper for AU-05 and AU-06. Purpose and token travel in the
 * form body rather than in a closure, so the same component serves both
 * screens; the token is already the URL secret, so this exposes nothing new.
 */
export async function submitNewPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const purpose = String(form.get('purpose')) as 'reset_password' | 'activate';
  if (purpose !== 'reset_password' && purpose !== 'activate') {
    return { error: 'This link is malformed. Request a new one.' };
  }
  const result = await setPasswordWithToken(
    purpose,
    String(form.get('token') ?? ''),
    String(form.get('password') ?? ''),
    String(form.get('confirm') ?? ''),
  );
  if ('error' in result) return result;
  redirect('/login?set=1');
}
