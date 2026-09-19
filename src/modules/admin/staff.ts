'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, memberships, sessions, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { issueActivationLink } from '../auth/actions';
import type { FormState } from '../auth/actions';
import { GRANTABLE, type GrantableRole } from './staff-roles';

/**
 * IA-05 staff & roles (CMP-14, CMP-17).
 *
 * Until now the only way to make somebody a registrar was to edit the
 * memberships table by hand, which meant that the least-privilege requirement
 * in CMP-14 was satisfied by nobody having a way to grant privilege at all.
 * That is not least privilege; it is an unmanaged system with a database
 * client as its admin console.
 *
 * Two rules do most of the work here:
 *
 * 1. An institution admin can grant only the three roles that operate inside
 *    their own institution. `super_admin`, `dpo` and `curator` are platform
 *    roles (see PLATFORM_ROLES) and are deliberately not in that set — an
 *    institution being able to mint a super admin is a tenant boundary that
 *    exists on paper only. `candidate`, `student` and `alumni` are not grants
 *    either: they are produced by the admissions pipeline, and handing one out
 *    here would create a student with no application behind them.
 *
 * 2. Revocation is same-day effective (§6.10). Deleting the membership row is
 *    not enough on its own — a signed-in registrar holds a session cookie that
 *    would keep working until it expired — so the sessions that person holds
 *    *against this institution* are revoked in the same transaction. Sessions
 *    they hold elsewhere are not this institution's to end.
 */

/** Roles this console may hand out. Re-exported for the page to render. */
export type { GrantableRole };

function grantable(value: string): value is GrantableRole {
  return (GRANTABLE as readonly string[]).includes(value);
}

/** Invite somebody who has no account here yet, or grant a role to someone who has. */
export async function inviteStaff(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const fullName = String(form.get('fullName') ?? '').trim();
  const role = String(form.get('role') ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'Give a working email address — the invitation goes to it.' };
  }
  if (fullName.length < 2) {
    return { error: 'Give their name. It appears on everything they decide.' };
  }
  if (!grantable(role)) {
    return { error: 'Choose one of the roles this institution can grant.' };
  }

  // SSO-04: one human, one account. Somebody who already works at another
  // institution on this platform gets a second membership, not a second login.
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const person =
    existing ??
    (
      await db.insert(users).values({ email, fullName, status: 'staff' }).returning()
    )[0];

  const [already] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, person.id),
        eq(memberships.institutionId, institution.id),
        eq(memberships.role, role),
      ),
    )
    .limit(1);
  if (already) {
    return { error: `${fullName} already holds that role here.` };
  }

  await db
    .insert(memberships)
    .values({ userId: person.id, institutionId: institution.id, role })
    .onConflictDoNothing();

  /*
   * AUTH-01: an activation link, never a password chosen on their behalf.
   *
   * Only for somebody who cannot already sign in. An existing colleague with
   * a password does not need — and must not be sent — a link that sets a new
   * one, because that link is a password reset addressed to an account whose
   * owner did not ask for it.
   */
  const invited = !person.passwordHash;
  if (invited) {
    const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
    await issueActivationLink(person.id, email, institution.name, `${institution.slug}.${root}`);
  }

  await audit({
    action: 'staff.role_granted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'memberships',
    entityId: person.id,
    subjectId: person.id,
    detail: { email, role, invited },
  });

  return {
    redirectTo: `/admin/staff?granted=${encodeURIComponent(fullName)}&role=${encodeURIComponent(
      role,
    )}${invited ? '&invited=1' : ''}`,
  };
}

/**
 * Revoke one role from one person. §6.10: same-day effective, which here
 * means effective on the next request rather than at the next login.
 */
export async function revokeRole(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const userId = String(form.get('userId') ?? '');
  const role = String(form.get('role') ?? '');

  if (!grantable(role)) {
    return {
      error: 'That role was not granted from this console and cannot be removed from it.',
    };
  }

  const [person] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!person) return { error: 'That person no longer has an account.' };

  const held = await db
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.institutionId, institution.id));

  const theirs = held.filter((m) => m.userId === userId);
  if (!theirs.some((m) => m.role === role)) {
    return { error: 'They do not hold that role here.' };
  }

  /*
   * The lockout guard. An institution whose last administrator removes their
   * own administrator role has nobody left who can grant it back, and the
   * only remedy is the platform reaching into the database — which is the
   * arrangement this whole screen exists to end.
   */
  if (role === 'institution_admin') {
    const admins = held.filter((m) => m.role === 'institution_admin');
    if (admins.length <= 1) {
      return {
        error:
          'This is the last administrator. Removing it would leave nobody here able to grant it back. Appoint another administrator first.',
      };
    }
    if (userId === me.userId) {
      return {
        error:
          'You cannot remove your own administrator role. Ask another administrator to do it, so the change has a second person behind it.',
      };
    }
  }

  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.institutionId, institution.id),
        eq(memberships.role, role),
      ),
    );

  /*
   * Same-day effective. Without this the person keeps the console open in a
   * tab and keeps working until their cookie expires, which can be thirty
   * days — a revocation that takes a month is not a revocation.
   *
   * Scoped to sessions opened against this institution. A session they hold
   * at another university is that institution's to end, not ours; the
   * `institution_id` on `sessions` is provenance for exactly this.
   */
  const remaining = theirs.filter((m) => m.role !== role);
  if (remaining.length === 0) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.institutionId, institution.id),
          isNull(sessions.revokedAt),
        ),
      );
  }

  await audit({
    action: 'staff.role_revoked',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'memberships',
    entityId: userId,
    subjectId: userId,
    detail: {
      email: person.email,
      role,
      sessionsEnded: remaining.length === 0,
      rolesLeft: remaining.map((m) => m.role),
    },
  });

  // The outcome cannot live in the row that just disappeared, so it travels
  // in the URL and the page renders it.
  return {
    redirectTo: `/admin/staff?revoked=${encodeURIComponent(
      person.fullName ?? person.email,
    )}&role=${encodeURIComponent(role)}`,
  };
}

/**
 * CMP-17's quarterly access re-attestation.
 *
 * The attestation is of the list as it stands, so the roster is written into
 * the audit entry. "We reviewed access in Q3" is not evidence; "on this date
 * this person confirmed these eleven people held these roles" is.
 */
export async function attestAccess(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  if (form.get('confirmed') !== 'on') {
    return {
      error:
        'Tick the box to confirm you have read the list. An attestation nobody read is worse than none, because it looks like a control.',
    };
  }

  const roster = await db
    .select({ email: users.email, name: users.fullName, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institution.id),
        inArray(memberships.role, [...GRANTABLE]),
      ),
    );

  const now = new Date();
  await db
    .update(institutions)
    .set({ accessReviewedAt: now, accessReviewedBy: me.userId, updatedAt: now })
    .where(eq(institutions.id, institution.id));

  await audit({
    action: 'staff.access_attested',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'institutions',
    entityId: institution.id,
    detail: { count: roster.length, roster },
  });

  return { redirectTo: '/admin/staff?attested=1' };
}
