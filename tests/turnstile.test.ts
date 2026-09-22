/**
 * AUTH-05 — Turnstile's server-side check.
 *
 * The decision is tested on its own; verifyTurnstile is then run against
 * Cloudflare's real siteverify with the public always-pass test secret.
 * That secret answers success with hostname "example.com" and no action,
 * so a correct canonical check must still refuse it: this is what proves
 * the hostname and action rules are live, without mocking Cloudflare.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hostnameAllowed, judgeSiteverify, verifyTurnstile } from '@/lib/turnstile';

const TEST_SECRET_PASS = '1x0000000000000000000000000000000AA';
const TEST_SECRET_FAIL = '2x0000000000000000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const saved = { ...process.env };
afterEach(() => {
  for (const k of ['TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES', 'TURNSTILE_OPTIONAL', 'NODE_ENV']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
};

describe('the decision', () => {
  const opts = { action: 'signup', hostnames: ['example.ng'] };

  it('passes a success for our action on our hostname or a subdomain', () => {
    expect(judgeSiteverify({ success: true, action: 'signup', hostname: 'example.ng' }, opts)).toEqual({ ok: true });
    expect(judgeSiteverify({ success: true, action: 'signup', hostname: 'unilag.example.ng' }, opts)).toEqual({ ok: true });
  });

  it('refuses a token earned on another form', () => {
    expect(judgeSiteverify({ success: true, action: 'login', hostname: 'example.ng' }, opts)).toMatchObject({ ok: false });
    expect(judgeSiteverify({ success: true, hostname: 'example.ng' }, opts)).toMatchObject({ ok: false });
  });

  it('refuses a token from a site that is not ours, lookalikes included', () => {
    for (const hostname of ['evil.com', 'notexample.ng', 'example.ng.evil.com', undefined]) {
      expect(judgeSiteverify({ success: true, action: 'signup', hostname }, opts)).toMatchObject({ ok: false });
    }
  });

  it('refuses whatever Cloudflare did not call a success', () => {
    expect(
      judgeSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }, opts),
    ).toEqual({ ok: false, reason: 'timeout-or-duplicate' });
  });

  it('matches hostnames the same way everywhere', () => {
    expect(hostnameAllowed('futo.localhost', ['localhost'])).toBe(true);
    expect(hostnameAllowed('localhost.evil.com', ['localhost'])).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  it('skips the check in development when no secret is set', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: 'development' });
    expect(await verifyTurnstile(null, null, 'signup')).toBe(true);
  });

  it('refuses in production when no secret is set, unless told it is optional', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: 'production', TURNSTILE_OPTIONAL: undefined });
    expect(await verifyTurnstile('anything', null, 'signup')).toBe(false);
    setEnv({ TURNSTILE_OPTIONAL: '1' });
    expect(await verifyTurnstile('anything', null, 'signup')).toBe(true);
  });

  it('refuses a missing or oversized token before calling Cloudflare', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS, TURNSTILE_HOSTNAMES: 'localhost' });
    expect(await verifyTurnstile(null, null, 'signup')).toBe(false);
    expect(await verifyTurnstile('', null, 'signup')).toBe(false);
    expect(await verifyTurnstile('x'.repeat(2049), null, 'signup')).toBe(false);
  });

  it('refuses when no hostnames are configured, rather than accepting any', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS, TURNSTILE_HOSTNAMES: '' });
    expect(await verifyTurnstile(DUMMY_TOKEN, null, 'signup')).toBe(false);
  });

  it('against real siteverify: refuses the always-pass test key, because its hostname and action are not ours', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS, TURNSTILE_HOSTNAMES: 'localhost' });
    expect(await verifyTurnstile(DUMMY_TOKEN, '127.0.0.1', 'signup')).toBe(false);
  });

  it('against real siteverify: refuses the always-fail test key', async () => {
    setEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_FAIL, TURNSTILE_HOSTNAMES: 'localhost' });
    expect(await verifyTurnstile(DUMMY_TOKEN, null, 'signup')).toBe(false);
  });
});
