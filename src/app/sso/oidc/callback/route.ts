import { NextResponse, type NextRequest } from 'next/server';
import { createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { requireInstitution, requestOrigin } from '@/lib/tenant';
import { homeFor } from '@/modules/auth/affiliations';
import { accountFor, exchange, oidcConfig } from '@/modules/auth/oidc';
import { OIDC_COOKIE, openFlow, sameState } from '@/modules/auth/oidc-flow';

/**
 * SSO-03, the second leg: back from the identity provider with a code.
 *
 * Every refusal lands on PB-08's failure page with its own reason, and every
 * one of those pages offers the password sign-in, so a misconfigured IdP
 * never strands a student.
 */
export async function GET(request: NextRequest) {
  const institution = await requireInstitution();
  const origin = requestOrigin(request);
  const params = request.nextUrl.searchParams;
  const flow = openFlow(request.cookies.get(OIDC_COOKIE)?.value);

  const fail = async (reason: string, detail?: string) => {
    await audit({
      action: 'sso.oidc_failed',
      institutionId: institution.id,
      actorRole: 'system:sso',
      detail: { reason, detail: detail ?? null },
    });
    const res = NextResponse.redirect(new URL(`/sso/handoff/failed?reason=${reason}`, origin));
    res.cookies.delete({ name: OIDC_COOKIE, path: '/sso/oidc' });
    return res;
  };

  const cfg = oidcConfig(institution);
  if (!cfg) return fail('oidc_not_configured');

  // The provider said no (the student cancelled, or policy refused them).
  if (params.get('error')) return fail('idp_refused', params.get('error') ?? undefined);

  // No flow, or a state this browser did not start: a forged or stale
  // callback. Refused before the code is spent.
  const state = params.get('state') ?? '';
  const code = params.get('code') ?? '';
  if (!flow || !code || !sameState(flow.state, state)) return fail('oidc_state');

  let result;
  try {
    result = await exchange(cfg, {
      code,
      redirectUri: `${origin}/sso/oidc/callback`,
      verifier: flow.verifier,
      nonce: flow.nonce,
    });
  } catch (err) {
    return fail('idp_unreachable', (err as Error).message);
  }
  if (!result.ok) return fail(result.reason, result.detail);

  const account = await accountFor(institution, cfg, result.claims);
  if (!account.ok) return fail(account.reason);

  // AUTH-08: staff never arrive by this route (accountFor refuses them), and
  // the session is stamped unsatisfied anyway. It costs a student nothing,
  // and if this account is granted a staff role mid-session, that role
  // still asks for its code.
  await createSession(account.userId, {
    institutionId: institution.id,
    remember: false,
    mfaSatisfied: false,
  });

  const res = NextResponse.redirect(new URL(homeFor(account.roles), origin));
  res.cookies.delete({ name: OIDC_COOKIE, path: '/sso/oidc' });
  return res;
}
