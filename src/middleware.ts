import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tenant resolution — §7.4.
 *
 * The tenant is derived from the Host header and nothing else. It is never
 * read from a query parameter or from a client-supplied header, which is why
 * the first thing this does is delete any inbound `x-pgd-*` header: a client
 * that tries to assert its own tenant gets the header stripped before any
 * route can see it.
 *
 * Hosts:
 *   unilag.example.ng   → tenant `unilag`
 *   www.example.ng      → platform marketing and public surfaces
 *   app.example.ng      → cross-tenant surfaces (library, alumni, DPO, profile)
 *
 * A `/t/{slug}/...` path prefix is supported as a documented fallback for
 * environments without wildcard DNS (PRD §4 permits subdomain *or* path). It
 * rewrites to the same routes, so no route handler knows the difference.
 */

const TENANT_HEADER = 'x-pgd-tenant';
const SCOPE_HEADER = 'x-pgd-scope';
const PATH_HEADER = 'x-pgd-pathname';

const RESERVED = new Set(['www', 'app', 'api', 'admin', 'static', 'assets']);

function rootDomain() {
  return (process.env.APP_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
}

function tenantFromHost(host: string): string | null {
  const bare = host.toLowerCase().split(':')[0];
  const root = rootDomain().split(':')[0];
  if (bare === root) return null;
  if (!bare.endsWith(`.${root}`)) return null;
  const label = bare.slice(0, -(root.length + 1));
  if (!label || label.includes('.')) return null;
  if (RESERVED.has(label)) return null;
  return label;
}

function scopeFromHost(host: string): 'platform' | 'app' | 'tenant' {
  const bare = host.toLowerCase().split(':')[0];
  const root = rootDomain().split(':')[0];
  if (bare === `app.${root}`) return 'app';
  if (tenantFromHost(host)) return 'tenant';
  return 'platform';
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const url = req.nextUrl;

  // Strip anything a client tried to assert about tenancy.
  const headers = new Headers(req.headers);
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith('x-pgd-')) headers.delete(key);
  }

  let slug = tenantFromHost(host);
  let scope = scopeFromHost(host);
  let pathname = url.pathname;

  // Path fallback: /t/{slug}/rest → rest, with the tenant carried in a header.
  const pathMatch = /^\/t\/([a-z0-9-]+)(\/.*)?$/.exec(url.pathname);
  if (pathMatch) {
    slug = pathMatch[1];
    scope = 'tenant';
    pathname = pathMatch[2] || '/';
  }

  if (slug) headers.set(TENANT_HEADER, slug);
  headers.set(SCOPE_HEADER, scope);
  // Layouts need the real path for nav state; Next does not expose it otherwise.
  headers.set(PATH_HEADER, pathname);

  if (pathMatch) {
    const rewritten = new URL(url);
    rewritten.pathname = pathname;
    return NextResponse.rewrite(rewritten, { request: { headers } });
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|woff2)$).*)'],
};
