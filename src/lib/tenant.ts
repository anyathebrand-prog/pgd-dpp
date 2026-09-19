import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';

export type Institution = typeof institutions.$inferSelect;
export type Scope = 'platform' | 'app' | 'tenant';

/**
 * The slug comes from middleware, which derived it from the Host header and
 * stripped any client attempt to assert one. Nothing else may set it.
 */
export const currentScope = cache(async (): Promise<Scope> => {
  const h = await headers();
  return (h.get('x-pgd-scope') as Scope) ?? 'platform';
});

export const currentPath = cache(async (): Promise<string> => {
  const h = await headers();
  return h.get('x-pgd-pathname') ?? '/';
});

export const currentTenantSlug = cache(async (): Promise<string | null> => {
  const h = await headers();
  return h.get('x-pgd-tenant');
});

/**
 * `institutions` is a shared table, so this read needs no tenant context — it
 * is the lookup that establishes tenant context for everything after it.
 */
export const currentInstitution = cache(async (): Promise<Institution | null> => {
  const slug = await currentTenantSlug();
  if (!slug) return null;
  const [row] = await db.select().from(institutions).where(eq(institutions.slug, slug)).limit(1);
  return row ?? null;
});
/** Use where a tenant is structurally required — every `{school}.` route. */
/**
 * Use where a tenant is structurally required — every `{school}.` route.
 *
 * Redirects to the platform landing, which lists the institutions, rather than
 * throwing. Applications, payments and coursework only exist under a tenant, so
 * reaching one of those routes without a tenant means the person is on the
 * wrong address and needs to pick a university — not that the server broke.
 */
export async function requireInstitution(): Promise<Institution> {
  const inst = await currentInstitution();
  if (!inst) redirect('/');
  return inst;
}

export function tenantUrl(slug: string, path = '/') {
  const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = process.env.APP_PROTOCOL ?? 'http';
  return `${proto}://${slug}.${root}${path}`;
}

export function appUrl(path = '/') {
  const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = process.env.APP_PROTOCOL ?? 'http';
  return `${proto}://app.${root}${path}`;
}

export function platformUrl(path = '/') {
  const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
  const proto = process.env.APP_PROTOCOL ?? 'http';
  return `${proto}://${root}${path}`;
}

/**
 * The origin the request actually arrived on, built from the Host header.
 *
 * `NextRequest.nextUrl.origin` reports the internal origin, which on this
 * platform is the host WITHOUT a tenant — so a redirect or an internal fetch
 * built from it silently leaves the institution behind, the middleware
 * resolves no tenant, and the caller lands on the platform landing page. It
 * has now caused that exact bug twice (the PDF renderer, and the SSO
 * handoff), so it lives here once.
 */
export function requestOrigin(request: {
  headers: { get(name: string): string | null };
  nextUrl: { protocol: string; host: string };
}) {
  const host = request.headers.get('host') ?? request.nextUrl.host;
  return `${request.nextUrl.protocol.replace(':', '')}://${host}`;
}
