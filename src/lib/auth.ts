import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { memberships, sessions, users } from '@/db/schema';
import { hashIp, randomToken, sha256 } from './crypto';
import { currentInstitution } from './tenant';

const COOKIE = 'pgd_session';
/** AUTH-07: 30-day "remember me" maximum. */
const MAX_AGE_DAYS = 30;
const SHORT_AGE_HOURS = 12;

export type Role = (typeof memberships.$inferSelect)['role'];

export type Principal = {
  userId: string;
  email: string;
  fullName: string | null;
  status: (typeof users.$inferSelect)['status'];
  sessionId: string;
  mfaSatisfied: boolean;
  /** Whether a confirmed TOTP secret exists, so MFA routes to setup or challenge. */
  totpEnrolled: boolean;
  /** Roles held at the institution currently in scope. Empty off-tenant. */
  roles: Role[];
  /**
   * Roles that are platform-wide by definition (§6.3 makes the DPO a platform
   * role). These resolve wherever the holder is, including on `app.` and the
   * platform host where no institution is in scope — otherwise the DPO
   * console, which lives at `app./dpo`, would be unreachable by the DPO.
   */
  platformRoles: Role[];
  /** Every role at every institution — for the AU-10 institution chooser. */
  allMemberships: { institutionId: string; role: Role }[];
};

export async function createSession(
  userId: string,
  opts: { institutionId?: string | null; remember?: boolean; mfaSatisfied?: boolean } = {},
) {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(
    Date.now() +
      (opts.remember ? MAX_AGE_DAYS * 86_400_000 : SHORT_AGE_HOURS * 3_600_000),
  );

  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      institutionId: opts.institutionId ?? null,
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
      ipHash: hashIp(clientIp(h)),
      mfaSatisfied: opts.mfaSatisfied ?? false,
      expiresAt,
    })
    .returning({ id: sessions.id });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return row.id;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(COOKIE);
}

/** AUTH-07 "sign out everywhere". */
export async function revokeAllSessions(userId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
}

export const currentPrincipal = cache(async (): Promise<Principal | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      mfaSatisfied: sessions.mfaSatisfied,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      totpConfirmedAt: users.totpConfirmedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.status === 'suspended') return null;

  const all = await db
    .select({ institutionId: memberships.institutionId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, row.userId));

  const inst = await currentInstitution();
  const roles = inst ? all.filter((m) => m.institutionId === inst.id).map((m) => m.role) : [];
  const platformRoles = [
    ...new Set(all.map((m) => m.role).filter((r) => PLATFORM_ROLES.includes(r))),
  ];

  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    sessionId: row.sessionId,
    mfaSatisfied: row.mfaSatisfied,
    totpEnrolled: Boolean(row.totpConfirmedAt),
    roles,
    platformRoles,
    allMemberships: all,
  };
});

/**
 * SY-04.
 *
 * This redirects rather than throwing a sentinel the error boundary decodes.
 * Next deliberately strips Server Component error messages in production and
 * replaces them with an opaque digest, so `error.message === 'NO_SESSION'`
 * works in development and silently degrades to the generic 500 screen in
 * production — the worst possible split. A redirect also gives the correct
 * status code, so a logged-out visit stops looking like a server fault in
 * monitoring.
 */
export async function requireUser(): Promise<Principal> {
  const p = await currentPrincipal();
  if (!p) redirect('/login');
  return p;
}

/**
 * Roles whose authority is not scoped to one institution. The DPO is a
 * statutory platform role under §6.3, and the curator manages a shared
 * catalogue; both need to work on hosts where no tenant is in scope.
 */
export const PLATFORM_ROLES: Role[] = ['dpo', 'super_admin', 'curator'];

/** AUTH-08: mandatory TOTP for these roles. Not optional, not configurable. */
export const MFA_REQUIRED_ROLES: Role[] = ['registry', 'institution_admin', 'super_admin', 'dpo'];

export async function requireRole(...allowed: Role[]): Promise<Principal> {
  const p = await requireUser();
  // Tenant-scoped roles come from the institution in scope; platform roles
  // hold everywhere. Without the union, the DPO console at `app./dpo` would
  // reject the DPO, because no institution resolves on that host.
  const held = [...new Set([...p.roles, ...p.platformRoles])].filter((r) => allowed.includes(r));
  if (held.length === 0) redirect('/no-access');

  // AUTH-08. An unsatisfied second factor is not an error — it is an
  // unfinished step, so it routes to the step rather than to an error screen.
  if (held.some((r) => MFA_REQUIRED_ROLES.includes(r)) && !p.mfaSatisfied) {
    redirect(p.totpEnrolled ? '/login/2fa' : '/security/2fa/setup');
  }
  return p;
}

export function clientIp(h: Headers) {
  return (
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

/**
 * AUTH-02. Ten characters, letters and numbers, and a blocklist. There is no
 * forced rotation: NIST dropped it years ago and it produces password1,
 * password2, which is worse than the password it replaced.
 */
const COMMON = new Set([
  'password1', 'password12', 'password123', 'qwerty12345', 'nigeria123', 'admin12345',
  'letmein123', '1234567890', 'iloveyou12', 'welcome123', 'abcdef1234', 'passw0rd12',
]);

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(password)) return 'Include at least one letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  if (COMMON.has(password.toLowerCase())) return 'This password is too common to be safe. Choose another.';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
    return 'Do not use your email address in your password.';
  }
  return null;
}
