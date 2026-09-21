/**
 * SSO-03 — Tier 1. Every way an ID token can be wrong, against real keys.
 */
import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  emailInDomains,
  pkceChallenge,
  provisionFor,
  verifyIdToken,
} from '@/modules/auth/oidc-verify';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwk = (k: KeyObject, kid: string) => ({ ...k.export({ format: 'jwk' }), kid, use: 'sig' });
const JWKS = { keys: [jwk(rsa.publicKey, 'r1'), jwk(ec.publicKey, 'e1')] };

const ISS = 'https://idp.unilag.edu.ng';
const CLIENT = 'pgd-dpp';
const NOW = 1_800_000_000;

const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(
  claims: Record<string, unknown>,
  opts: { alg?: string; kid?: string; key?: KeyObject; hmac?: string } = {},
) {
  const alg = opts.alg ?? 'RS256';
  const head = enc({ alg, kid: opts.kid ?? (alg === 'ES256' ? 'e1' : 'r1'), typ: 'JWT' });
  const body = enc(claims);
  const data = Buffer.from(`${head}.${body}`);
  let sig = '';
  if (opts.hmac) sig = createHmac('sha256', opts.hmac).update(data).digest('base64url');
  else if (alg === 'RS256') sig = sign('sha256', data, opts.key ?? rsa.privateKey).toString('base64url');
  else if (alg === 'ES256')
    sig = sign('sha256', data, { key: opts.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const good = {
  iss: ISS,
  sub: 'u-123',
  aud: CLIENT,
  exp: NOW + 300,
  iat: NOW,
  nonce: 'n-abc',
  email: 'ada@unilag.edu.ng',
  email_verified: true,
};
const check = (t: string) => verifyIdToken(t, { jwks: JWKS, issuer: ISS, clientId: CLIENT, nonce: 'n-abc', now: NOW });

describe('ID token verification', () => {
  it('accepts RS256 and ES256 signed by the published keys', () => {
    expect(check(token(good))).toMatchObject({ ok: true, claims: { sub: 'u-123' } });
    expect(check(token(good, { alg: 'ES256' }))).toMatchObject({ ok: true });
  });

  it('refuses alg none and HS256 before looking at the signature', () => {
    const none = `${enc({ alg: 'none' })}.${enc(good)}.`;
    expect(check(none)).toEqual({ ok: false, reason: 'algorithm none refused' });
    // Algorithm confusion: an HMAC keyed with the public key's own bytes.
    const pem = rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(check(token(good, { alg: 'HS256', hmac: pem }))).toMatchObject({ ok: false, reason: 'algorithm HS256 refused' });
  });

  it('refuses a key it did not publish, and a tampered payload', () => {
    expect(check(token(good, { key: other.privateKey }))).toMatchObject({ ok: false, reason: 'bad signature' });
    const [h, , s] = token(good).split('.');
    expect(check(`${h}.${enc({ ...good, sub: 'someone-else' })}.${s}`)).toMatchObject({ ok: false, reason: 'bad signature' });
    expect(check(token(good, { kid: 'unknown' }))).toMatchObject({ ok: false, reason: 'no matching signing key' });
  });

  it('refuses a key of the wrong type for the algorithm', () => {
    expect(check(token(good, { alg: 'ES256', kid: 'r1' }))).toMatchObject({ ok: false, reason: 'no matching signing key' });
  });

  it('checks issuer, audience, authorised party, time and nonce', () => {
    expect(check(token({ ...good, iss: 'https://evil.example' }))).toMatchObject({ reason: 'wrong issuer' });
    expect(check(token({ ...good, aud: 'another-app' }))).toMatchObject({ reason: 'not addressed to us' });
    expect(check(token({ ...good, aud: [CLIENT, 'another-app'] }))).toMatchObject({ reason: 'wrong authorised party' });
    expect(check(token({ ...good, aud: [CLIENT, 'another-app'], azp: CLIENT }))).toMatchObject({ ok: true });
    expect(check(token({ ...good, exp: NOW - 61 }))).toMatchObject({ reason: 'expired' });
    expect(check(token({ ...good, exp: NOW - 30 }))).toMatchObject({ ok: true });
    expect(check(token({ ...good, iat: NOW + 120 }))).toMatchObject({ reason: 'issued in the future' });
    expect(check(token({ ...good, nonce: 'replayed' }))).toMatchObject({ reason: 'nonce mismatch' });
    expect(check(token({ ...good, nonce: undefined }))).toMatchObject({ reason: 'nonce mismatch' });
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('whose addresses an IdP may vouch for', () => {
  const d = ['unilag.edu.ng'];
  it('its own domain and its subdomains', () => {
    expect(emailInDomains('ada@unilag.edu.ng', d)).toBe(true);
    expect(emailInDomains('ada@students.unilag.edu.ng', d)).toBe(true);
  });
  it('nobody else, including lookalikes', () => {
    expect(emailInDomains('ada@gmail.com', d)).toBe(false);
    expect(emailInDomains('ada@notunilag.edu.ng', d)).toBe(false);
    expect(emailInDomains('ada@unilag.edu.ng.evil.com', d)).toBe(false);
    expect(emailInDomains('ada@unilag.edu.ng', [])).toBe(false);
  });
});

describe('just-in-time provisioning', () => {
  const base = { emailVerified: true, emailAllowed: true, institutionId: 'A' };
  it('creates an applicant, never a student', () => {
    expect(provisionFor({ ...base, user: null, held: [] })).toEqual({ kind: 'create' });
  });
  it('signs in someone who already belongs here', () => {
    expect(provisionFor({ ...base, user: { status: 'student' }, held: [{ institutionId: 'A', role: 'student' }] })).toEqual({ kind: 'sign_in' });
  });
  it('adds an application place for someone from another school (SSO-04)', () => {
    expect(provisionFor({ ...base, user: { status: 'student' }, held: [{ institutionId: 'B', role: 'student' }] })).toEqual({ kind: 'add_candidate' });
  });
  it('refuses staff, anywhere, and suspended accounts', () => {
    expect(provisionFor({ ...base, user: { status: 'staff' }, held: [{ institutionId: 'B', role: 'registry' }] })).toMatchObject({ reason: 'staff_account' });
    expect(provisionFor({ ...base, user: { status: 'staff' }, held: [{ institutionId: 'A', role: 'curator' }] })).toMatchObject({ reason: 'staff_account' });
    expect(provisionFor({ ...base, user: { status: 'suspended' }, held: [] })).toMatchObject({ reason: 'suspended' });
  });
  it('refuses unverified and foreign addresses before looking anyone up', () => {
    expect(provisionFor({ ...base, emailVerified: false, user: null, held: [] })).toMatchObject({ reason: 'unverified_email' });
    expect(provisionFor({ ...base, emailAllowed: false, user: null, held: [] })).toMatchObject({ reason: 'foreign_domain' });
  });
});
