/**
 * AUTH-06 — the throttle and the lockout.
 *
 * Neither had a test, which was found by running the end-to-end suite against
 * a production build: it is fast enough to spend the per-IP login budget from
 * 127.0.0.1 inside one window, and ten specs failed at "Too many attempts".
 * The control was working. Nothing was covering it.
 *
 * Pure and time-dependent, so the clock is driven rather than waited on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockoutMs, rateLimit } from '@/lib/ratelimit';

let key = '';

beforeEach(() => {
  vi.useFakeTimers();
  // A fresh key per test: the buckets live in module state by design.
  key = `test-${Math.random()}`;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the sliding budget', () => {
  it('allows up to the limit and refuses the next one', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    expect(rateLimit(key, 5, 60_000).allowed).toBe(false);
  });

  it('reports what is left, so a caller can say something useful', () => {
    expect(rateLimit(key, 3, 60_000).remaining).toBe(2);
    expect(rateLimit(key, 3, 60_000).remaining).toBe(1);
    expect(rateLimit(key, 3, 60_000).remaining).toBe(0);
  });

  it('tells a refused caller how long to wait', () => {
    rateLimit(key, 1, 60_000);
    const refused = rateLimit(key, 1, 60_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('opens again once the window has passed', () => {
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    // A budget that never refilled would lock somebody out permanently after
    // one bad afternoon.
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });

  it('keeps separate keys separate', () => {
    rateLimit(`${key}-a`, 1, 60_000);
    expect(rateLimit(`${key}-a`, 1, 60_000).allowed).toBe(false);
    // One person's exhausted budget is not another's — this is what keeps a
    // per-account limit from behaving like a per-IP one.
    expect(rateLimit(`${key}-b`, 1, 60_000).allowed).toBe(true);
  });
});

describe('the progressive account lockout', () => {
  it('does not lock before the fifth failure', () => {
    expect(lockoutMs(1)).toBe(0);
    expect(lockoutMs(4)).toBe(0);
  });

  it('lengthens with each further failure', () => {
    const steps = [5, 6, 7, 8].map(lockoutMs);
    expect(steps).toEqual([60_000, 300_000, 900_000, 3_600_000]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('caps rather than growing without bound', () => {
    // An hour is the ceiling: beyond it the lockout stops being a defence and
    // becomes a way to deny somebody their own account.
    expect(lockoutMs(20)).toBe(3_600_000);
    expect(lockoutMs(500)).toBe(3_600_000);
  });
});
