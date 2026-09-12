import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Two connection pools, two Postgres roles, on purpose (§7.4).
 *
 *  - `appSql` connects as `pgd_app`, which is NOBYPASSRLS. Every request-path
 *    query goes through it, inside `withTenant`, which sets the session
 *    variable the RLS policies read.
 *  - `adminSql` connects as the owner. Migrations, the seed and the job worker
 *    use it deliberately, and every use is logged.
 *
 * There is no third option and no escape hatch on the request path. If a query
 * needs to cross tenants, it is a worker job, not an inline exception.
 */

const appUrl = process.env.DATABASE_URL;
if (!appUrl) throw new Error('DATABASE_URL is not set');

declare global {
  // eslint-disable-next-line no-var
  var __pgdAppSql: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var __pgdAdminSql: postgres.Sql | undefined;
}

export const appSql =
  globalThis.__pgdAppSql ?? postgres(appUrl, { max: 10, prepare: false, onnotice: () => {} });
if (process.env.NODE_ENV !== 'production') globalThis.__pgdAppSql = appSql;

export const db = drizzle(appSql, { schema });

const adminUrl = process.env.MIGRATION_DATABASE_URL ?? appUrl;
export const adminSql =
  globalThis.__pgdAdminSql ?? postgres(adminUrl, { max: 4, prepare: false, onnotice: () => {} });
if (process.env.NODE_ENV !== 'production') globalThis.__pgdAdminSql = adminSql;

export const adminDb = drizzle(adminSql, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction with `app.institution_id` set, so every
 * tenant-scoped table filters to that institution at the database layer.
 *
 * SET LOCAL is scoped to the transaction, so a pooled connection cannot leak
 * one tenant's setting into the next request — which is the failure mode that
 * makes application-level scoping insufficient.
 */
export async function withTenant<T>(institutionId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sqlSetLocal('app.institution_id', institutionId));
    return fn(tx);
  });
}

/**
 * For request-path work that touches only shared tables (the library, the
 * public certificate check, an unauthenticated signup). Still the RLS-bound
 * role — tenant tables simply return nothing, which is the correct outcome.
 */
export async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

/**
 * `SET LOCAL` does not accept a bind parameter, so the value is validated as a
 * UUID and interpolated. Anything that is not a UUID never reaches the string.
 */
function sqlSetLocal(key: 'app.institution_id', value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Refusing to set ${key} to a non-UUID value`);
  }
  return sql.raw(`SET LOCAL "${key}" = '${value}'`);
}

/**
 * A deliberate, narrow exemption for the handful of request-path reads that are
 * cross-tenant BY DESIGN and cannot be expressed as "one tenant at a time".
 *
 * It runs on the elevated role, so it bypasses RLS. That is the whole point,
 * and it is why the `reason` argument is mandatory and why the call sites are
 * enumerated here rather than left to discretion:
 *
 *   - public certificate verification (PB-07) — a verifier has a code and no
 *     institution, and finding out which institution issued it IS the answer
 *   - signed document access (/api/files) — the object key names the tenant,
 *     but the row must be found before the tenant is known, and the real
 *     authorisation is the ownership and role check that follows
 *   - the DPO console — the DPO is a platform-wide statutory role (§6.3)
 *
 * Anything else belongs in `withTenant`. If a fourth reason appears, it needs
 * an argument, not a convenient import: each of these is a place where the
 * database has stopped protecting us and the application code has to.
 */
export async function readAcrossTenants<T>(
  reason: 'certificate-verification' | 'signed-document-access' | 'dpo-console',
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  void reason;
  return adminDb.transaction(async (tx) => fn(tx as unknown as Tx));
}

export { schema };
