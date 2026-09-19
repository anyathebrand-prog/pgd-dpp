/**
 * Applies row-level security. Run after every `db:push`.
 *
 * This script is the enforcement mechanism for CMP-14. It:
 *   1. creates the RLS-bound application role if absent,
 *   2. enables and FORCEs RLS on every tenant-scoped table,
 *   3. writes a USING + WITH CHECK policy keyed to `app.institution_id`,
 *   4. grants the app role exactly the privileges it needs — note that
 *      `audit_log` gets INSERT and SELECT only, which is what makes it
 *      immutable from the request path,
 *   5. asserts that every table either carries institution_id or is on the
 *      documented SHARED_TABLES exemption list.
 *
 * FORCE matters: without it, the table owner silently bypasses its own
 * policies, and in local development the app often *is* the owner. FORCE means
 * the policy holds even then, so a dev machine behaves like production.
 *
 * The `nullif(..., '')` in the policy is not defensive noise. `SET LOCAL`
 * reverts at the end of a transaction to the SESSION value of the setting, and
 * for a placeholder GUC that Postgres created on first use that value is the
 * empty string rather than unset. On a pooled connection that has already
 * served one tenant, a later query with no tenant context would therefore
 * evaluate `''::uuid` and raise `invalid input syntax for type uuid` instead of
 * matching nothing. Both outcomes fail closed, but only one of them fails
 * closed *quietly* and consistently — a fresh connection returning zero rows
 * while a reused one throws a 500 is the kind of inconsistency that gets
 * diagnosed as a flaky database rather than as missing tenant context.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { SHARED_TABLES } from './schema';

const APP_ROLE = process.env.APP_DB_ROLE ?? 'pgd_app';
const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? 'pgd_local_dev';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required — RLS is applied as the owner role');

const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Append-only from the request path. Staff cannot edit what logged them. */
const APPEND_ONLY = new Set(['audit_log', 'consent_records', 'inbound_events']);

async function main() {
  const tables = (
    await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
  ).map((r) => r.table_name);

  const scoped = (
    await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'institution_id'
    `
  ).map((r) => r.table_name);

  const shared = new Set<string>(SHARED_TABLES);

  // (5) The guard. A new table that is neither scoped nor consciously exempt is
  // a tenant leak waiting to happen, so this fails loudly rather than warning.
  const unclassified = tables.filter(
    (t) => !scoped.includes(t) && !shared.has(t) && !t.startsWith('__drizzle'),
  );
  if (unclassified.length) {
    throw new Error(
      `Tables carry no institution_id and are not on the SHARED_TABLES exemption list: ` +
        `${unclassified.join(', ')}. Add the column, or add the table to SHARED_TABLES ` +
        `in src/db/schema.ts with a comment explaining why sharing is correct.`,
    );
  }

  // (1) The application role. NOBYPASSRLS is the whole point of it.
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}';
      END IF;
    END $$;
    ALTER ROLE ${APP_ROLE} NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
  `);

  for (const table of tables) {
    // SHARED_TABLES wins over the column heuristic, always.
    //
    // Several shared tables legitimately carry a nullable institution_id — a
    // session records which tenant it was opened against, an audit entry
    // records which tenant an action touched, a DSAR records which controller
    // it was routed to, an alumni profile records affiliation. That column is
    // provenance, not an isolation key, and policing it as one breaks the
    // table: `currentPrincipal` reads `sessions` before any tenant context
    // exists, so a policy there would evaluate false and no session would ever
    // resolve. The same applies to platform-wide DPO reads and to the national
    // alumni directory (§4 LOCKED).
    const isScoped = scoped.includes(table) && !shared.has(table);
    const appendOnly = APPEND_ONLY.has(table);

    const privileges = appendOnly
      ? 'SELECT, INSERT'
      : 'SELECT, INSERT, UPDATE, DELETE';
    await sql.unsafe(`GRANT ${privileges} ON TABLE public."${table}" TO ${APP_ROLE};`);

    if (!isScoped) {
      // Re-running must be able to CORRECT a database where RLS was previously
      // applied to a table that is now classified as shared. Skipping silently
      // would leave the old policy in force and the table unreadable.
      await sql.unsafe(`
        DROP POLICY IF EXISTS tenant_isolation ON public."${table}";
        ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY;
      `);
      continue;
    }

    // (2) + (3)
    await sql.unsafe(`
      ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation ON public."${table}";
      CREATE POLICY tenant_isolation ON public."${table}"
        USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
        WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid);
    `);
  }

  // Sequences, for the few serial columns a future migration may add.
  await sql.unsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );

  const policied = scoped.filter((t) => tables.includes(t) && !shared.has(t));
  console.log(`RLS applied to ${policied.length} tenant-scoped tables:`);
  console.log(`  ${policied.sort().join(', ')}`);
  console.log(`Shared (no RLS, documented exemption): ${[...shared].sort().join(', ')}`);
  console.log(`Append-only grants (no UPDATE/DELETE for ${APP_ROLE}): ${[...APPEND_ONLY].join(', ')}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
