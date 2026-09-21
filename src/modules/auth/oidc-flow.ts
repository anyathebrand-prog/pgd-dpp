import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The SSO-03 sign-in in flight, carried between the two legs in a cookie.
 *
 * Signed, not just httpOnly. A sibling tenant subdomain can set a cookie for
 * the parent domain ("cookie tossing"), and an unsigned flow cookie would let
 * it fix the state and nonce of someone else's sign-in. The MAC binds the
 * value to this platform's secret.
 */
export const OIDC_COOKIE = 'pgd_oidc';

type Flow = { state: string; nonce: string; verifier: string };

const mac = (value: string) =>
  createHmac('sha256', process.env.SESSION_SECRET ?? 'dev-secret').update(`oidc:${value}`).digest('base64url');

export function sealFlow(flow: Flow) {
  const value = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${value}.${mac(value)}`;
}

export function openFlow(sealed: string | undefined): Flow | null {
  if (!sealed) return null;
  const [value, sig] = sealed.split('.');
  if (!value || !sig) return null;
  const expected = Buffer.from(mac(value));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const flow = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return flow.state && flow.nonce && flow.verifier ? flow : null;
  } catch {
    return null;
  }
}

/** Constant-time, because the state is the CSRF defence on the callback. */
export function sameState(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
