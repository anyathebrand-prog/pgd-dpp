import { NextResponse, type NextRequest } from 'next/server';
import { requireInstitution, requestOrigin } from '@/lib/tenant';
import { randomToken } from '@/lib/crypto';
import { pkceChallenge } from '@/modules/auth/oidc-verify';
import { authorizeUrl, oidcConfig } from '@/modules/auth/oidc';
import { OIDC_COOKIE, sealFlow } from '@/modules/auth/oidc-flow';

/**
 * SSO-03, the first leg: off to the university's identity provider.
 *
 * State, nonce and the PKCE verifier are kept in a short-lived, signed,
 * httpOnly cookie on this host, so the callback can check the three came
 * from a sign-in this browser started.
 */
export async function GET(request: NextRequest) {
  const institution = await requireInstitution();
  const origin = requestOrigin(request);
  const cfg = oidcConfig(institution);
  if (!cfg) return NextResponse.redirect(new URL('/sso/handoff/failed?reason=oidc_not_configured', origin));

  const flow = { state: randomToken(24), nonce: randomToken(24), verifier: randomToken(48) };
  let target: string;
  try {
    target = await authorizeUrl(cfg, {
      redirectUri: `${origin}/sso/oidc/callback`,
      state: flow.state,
      nonce: flow.nonce,
      challenge: pkceChallenge(flow.verifier),
    });
  } catch {
    return NextResponse.redirect(new URL('/sso/handoff/failed?reason=idp_unreachable', origin));
  }

  const res = NextResponse.redirect(target);
  res.cookies.set(OIDC_COOKIE, sealFlow(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/sso/oidc',
    maxAge: 600,
  });
  return res;
}
