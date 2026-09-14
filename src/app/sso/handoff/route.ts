import { NextResponse, type NextRequest } from 'next/server';
import { createSession, consoleFor, currentPrincipal, type Principal } from '@/lib/auth';
import { requireInstitution, requestOrigin } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { verifyHandoff } from '@/modules/auth/sso';

/**
 * PB-08 university portal handoff (SSO-02, Tier 2).
 *
 * A route handler rather than a page, and not by preference: minting a session
 * means setting a cookie, and a Server Component cannot. §5 describes this as
 * a "signing you in…" state nobody dwells on, which is exactly what a redirect
 * is — the only thing rendered is a failure, and that lives at ./failed.
 *
 * Every rejection carries a reason in the URL rather than a generic error,
 * because the five ways this goes wrong need five different answers from the
 * person standing in front of it, and "something went wrong" sends them to a
 * university IT desk that cannot help.
 */
export async function GET(request: NextRequest) {
  const institution = await requireInstitution();
  // The Host header, not nextUrl.origin: the latter drops the tenant, and a
  // redirect built from it lands the student on the platform landing page
  // instead of their dashboard.
  const origin = requestOrigin(request);
  const token = request.nextUrl.searchParams.get('token');
  const next = safeNext(request.nextUrl.searchParams.get('next'));

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/sso/handoff/failed?reason=${reason}`, origin));

  // Already signed in: the handoff is redundant rather than wrong, and
  // spending the nonce would lock someone out of a second visit.
  const existing = await currentPrincipal();
  if (existing) {
    return NextResponse.redirect(new URL(next ?? landingFor(existing), origin));
  }

  if (!token) return fail('missing');

  const result = await verifyHandoff(token, institution.slug);

  if (!result.ok) {
    await audit({
      action: 'sso.handoff_rejected',
      institutionId: institution.id,
      actorRole: 'system:sso',
      detail: { reason: result.reason },
    });
    return fail(result.reason);
  }

  // AUTH-08 is not waived by arriving through a portal. A registry officer
  // handed in by their university still clears the second factor: mfaSatisfied
  // stays false, and requireRole sends them to the challenge.
  await createSession(result.userId, {
    institutionId: result.institutionId,
    remember: false,
    mfaSatisfied: false,
  });

  await audit({
    action: 'sso.handoff_accepted',
    institutionId: result.institutionId,
    actorId: result.userId,
    subjectId: result.userId,
    actorRole: 'system:sso',
    detail: { skewSeconds: result.skewSeconds },
  });

  const principal = await currentPrincipal();
  return NextResponse.redirect(
    new URL(next ?? (principal ? landingFor(principal) : '/dashboard'), origin),
  );
}

/**
 * Where a handoff lands, which is not the question the TOTP challenge answers.
 * `consoleFor` assumes it is looking at staff and falls back to /admin; most
 * people arriving from a university portal are students, and /admin would
 * bounce them to /no-access.
 */
function landingFor(me: Principal) {
  const staff = [...me.roles, ...me.platformRoles].some((role) =>
    ['registry', 'institution_admin', 'facilitator', 'dpo', 'super_admin', 'curator'].includes(role),
  );
  if (staff) return consoleFor(me);
  if (me.status === 'alumni') return '/alumni';
  return me.status === 'student' ? '/dashboard' : '/apply';
}

/**
 * A `next` from the query string is attacker-controlled, so only a path within
 * this site is ever followed — an open redirect on an authentication endpoint
 * is how a phishing page borrows a real domain.
 */
function safeNext(next: string | null) {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}
