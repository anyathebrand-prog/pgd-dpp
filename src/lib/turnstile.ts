/**
 * AUTH-05 — Cloudflare Turnstile, verified on the server.
 *
 * Turnstile rather than reCAPTCHA: lighter on bandwidth, and it does not
 * export data to Google, which would otherwise need justifying in the
 * cross-border transfer register (CMP-11) on a product whose credibility
 * rests on not doing that.
 *
 * The browser only ever holds a token. It is checked here, against
 * Cloudflare's siteverify, never from the browser, and a pass requires all
 * of the following (Cloudflare's canonical procedure):
 *
 *   - a token of plausible size (Cloudflare's own ceiling is 2048);
 *   - siteverify answered 2xx within ten seconds, and said success;
 *   - the action matches the form's, so a token earned on one form cannot
 *     be spent on another;
 *   - the hostname is one of ours (TURNSTILE_HOSTNAMES, subdomains
 *     included, since every university is a subdomain).
 *
 * Replay is refused by Cloudflare: a token verifies once.
 *
 * With no secret configured: skipped in development, so local flows run;
 * refused in production, unless TURNSTILE_OPTIONAL=1 says so (for a local
 * `npm start` only). A live site that silently stopped checking because a
 * variable went missing is the failure this exists to prevent.
 */

export type SiteverifyResult = {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
};

/** Is `host` one of the configured hostnames, or a subdomain of one? */
export function hostnameAllowed(host: string | undefined, allowed: string[]) {
  if (!host) return false;
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const base = a.trim().toLowerCase();
    return base.length > 0 && (h === base || h.endsWith(`.${base}`));
  });
}

/** The decision, on a siteverify answer already in hand. Pure, so it is tested alone. */
export function judgeSiteverify(
  result: SiteverifyResult,
  opts: { action: string; hostnames: string[] },
): { ok: true } | { ok: false; reason: string } {
  if (!result.success) return { ok: false, reason: (result['error-codes'] ?? []).join(',') || 'not successful' };
  if (result.action !== opts.action) return { ok: false, reason: `action ${result.action ?? 'none'}` };
  if (!hostnameAllowed(result.hostname, opts.hostnames)) return { ok: false, reason: `hostname ${result.hostname ?? 'none'}` };
  return { ok: true };
}

export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
  action: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return process.env.NODE_ENV !== 'production' || process.env.TURNSTILE_OPTIONAL === '1';
  }

  const hostnames = (process.env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (!token || token.length === 0 || token.length > 2048 || hostnames.length === 0) return false;

  let result: SiteverifyResult;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = (await res.json()) as SiteverifyResult;
  } catch {
    // Cloudflare unreachable is a refusal, not a pass: failing open would
    // turn an outage into an open door.
    return false;
  }

  return judgeSiteverify(result, { action, hostnames }).ok;
}
