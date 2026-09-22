import 'server-only';

/**
 * AUTH-06. Five attempts per account per 15 minutes, then progressive lockout;
 * IP throttling on reset requests.
 *
 * This in-process implementation is correct for a single instance and is what
 * runs locally. In production the edge does the first layer of this (Cloudflare
 * rate limiting on the login and application routes, §7.2), and the durable
 * per-account counter lives on `users.failed_login_count` /
 * `users.locked_until` so a lockout survives a deploy or a second instance.
 * That column pair is the source of truth; this map is a cheap first filter.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/** Progressive: 1 min, 5, 15, 60, then capped. */
export function lockoutMs(failedCount: number) {
  const steps = [60_000, 300_000, 900_000, 3_600_000];
  if (failedCount < 5) return 0;
  return steps[Math.min(failedCount - 5, steps.length - 1)];
}
