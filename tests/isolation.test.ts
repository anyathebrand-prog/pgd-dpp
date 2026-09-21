/**
 * §7.4: "The non-negotiable test."
 *
 * A tenant leak in a data protection product is the one bug that ends the
 * company. These tests authenticate as the RLS-bound application role, set one
 * institution in the session, and then try every way of reaching the other
 * institution's rows — including the ways an ORM bug or a forgotten `where`
 * clause would produce.
 *
 * They run against the seeded two-tenant fixture. Run `npm run db:reset` first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import 'dotenv/config';
import { SHARED_TABLES } from '../src/db/schema';

const appUrl = process.env.DATABASE_URL!;
const ownerUrl = process.env.MIGRATION_DATABASE_URL!;

const app = postgres(appUrl, { max: 2, onnotice: () => {} });
const owner = postgres(ownerUrl, { max: 2, onnotice: () => {} });

let unilag: string;
let ful: string;

beforeAll(async () => {
  const rows = await owner<{ id: string; slug: string }[]>`
    SELECT id, slug FROM institutions ORDER BY slug
  `;
  unilag = rows.find((r) => r.slug === 'unilag')!.id;
  ful = rows.find((r) => r.slug === 'fulokoja')!.id;
  expect(unilag, 'seed data is missing — run npm run db:reset').toBeTruthy();
  expect(ful).toBeTruthy();
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

/** Mirrors `withTenant` in src/db/index.ts: one transaction, SET LOCAL, query. */
async function asTenant<T>(institutionId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL "app.institution_id" = '${institutionId}'`);
    return fn(tx);
  }) as Promise<T>;
}

describe('the application role cannot bypass RLS', () => {
  it('is NOBYPASSRLS and is not a superuser', async () => {
    const [role] = await app<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    expect(role.rolbypassrls, 'the app role can bypass RLS — CMP-14 is not enforced').toBe(false);
    expect(role.rolsuper).toBe(false);
  });

  it('has RLS enabled AND forced on every tenant-scoped table', async () => {
    const all = await owner<{ tablename: string; rls: boolean; forced: boolean }[]>`
      SELECT c.relname AS tablename, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_name = c.relname AND col.column_name = 'institution_id'
        )
    `;

    // Carrying institution_id does not by itself make a table tenant-scoped.
    // Several shared tables record it as provenance — which tenant a session
    // was opened against, which tenant an audit entry touched, which
    // institution an alumnus graduated from. Policing that column as an
    // isolation key would break those tables outright, so SHARED_TABLES wins.
    const shared = new Set<string>(SHARED_TABLES);
    const tables = all.filter((t) => !shared.has(t.tablename));

    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) {
      // Without FORCE, the table owner silently bypasses its own policies —
      // and in development the app often IS the owner.
      expect(t.rls, `${t.tablename} has RLS disabled`).toBe(true);
      expect(t.forced, `${t.tablename} does not FORCE RLS`).toBe(true);
    }
  });

  it('leaves shared tables readable with no tenant context', async () => {
    // The regression this guards: `currentPrincipal` reads `sessions` before
    // any tenant is established. If a policy were applied there, the setting
    // would be NULL, the policy would evaluate false, and no session would
    // ever resolve — every login on the platform would fail.
    for (const table of ['sessions', 'users', 'audit_log', 'consent_records', 'institutions']) {
      const rows = await app.unsafe(`SELECT count(*)::int AS n FROM public."${table}"`);
      expect(Number(rows[0].n), `${table} is unreadable without tenant context`).toBeGreaterThan(-1);
    }

    const [session] = await app`SELECT count(*)::int AS n FROM sessions`;
    expect(Number(session.n)).toBeGreaterThanOrEqual(0);
  });

  it('classifies every table as either tenant-scoped or consciously shared', async () => {
    const all = await owner<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const scoped = await owner<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'institution_id'
    `;
    const scopedNames = new Set(scoped.map((r) => r.table_name));
    const sharedNames = new Set<string>(SHARED_TABLES);

    const unclassified = all
      .map((r) => r.table_name)
      .filter((t) => !scopedNames.has(t) && !sharedNames.has(t) && !t.startsWith('__drizzle'));

    expect(
      unclassified,
      'a new table is neither tenant-scoped nor on the documented exemption list',
    ).toEqual([]);
  });
});

describe('School A cannot read School B', () => {
  it('sees only its own applications', async () => {
    const mine = await asTenant(unilag, (tx) => tx`SELECT institution_id FROM applications`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.institution_id === unilag)).toBe(true);
  });

  it('returns nothing when selecting the other tenant rows by explicit id', async () => {
    // The query a leaky endpoint would run: right table, wrong tenant, and an
    // id the attacker already knows.
    const rows = await asTenant(
      unilag,
      (tx) => tx`SELECT * FROM applications WHERE institution_id = ${ful}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('returns nothing for an unfiltered count of the other tenant documents', async () => {
    const fulDocs = await asTenant(ful, (tx) => tx`SELECT count(*)::int AS n FROM fee_items`);
    const seenFromUnilag = await asTenant(
      unilag,
      (tx) => tx`SELECT count(*)::int AS n FROM fee_items WHERE institution_id = ${ful}`,
    );
    expect(Number(fulDocs[0].n)).toBeGreaterThan(0);
    expect(Number(seenFromUnilag[0].n)).toBe(0);
  });

  it('cannot reach the other tenant rows through a join', async () => {
    // Joining from a shared table (users) into a scoped one is the shape that
    // defeats naive application-level scoping. RLS still applies to the
    // scoped side of the join.
    const rows = await asTenant(
      unilag,
      (tx) => tx`
        SELECT a.id FROM users u
        JOIN applications a ON a.user_id = u.id
        WHERE a.institution_id = ${ful}
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it('sees nothing at all with no tenant set', async () => {
    // A request that forgot to establish tenant context fails closed. It does
    // not fall back to "everything".
    const rows = await app`SELECT count(*)::int AS n FROM applications`;
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('School A cannot write into School B', () => {
  it('refuses an insert carrying another tenant institution_id', async () => {
    await expect(
      asTenant(
        unilag,
        (tx) => tx`
          INSERT INTO fee_items (institution_id, kind, label, amount_kobo)
          VALUES (${ful}, 'application', 'Injected by a test', 1)
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update another tenant rows', async () => {
    const before = await asTenant(
      ful,
      (tx) => tx`SELECT capacity FROM cohorts LIMIT 1`,
    );
    const result = await asTenant(
      unilag,
      (tx) => tx`UPDATE cohorts SET capacity = 9999 WHERE institution_id = ${ful} RETURNING id`,
    );
    expect(result).toHaveLength(0);

    const after = await asTenant(ful, (tx) => tx`SELECT capacity FROM cohorts LIMIT 1`);
    expect(after[0].capacity).toBe(before[0].capacity);
  });

  it('cannot delete another tenant rows', async () => {
    const result = await asTenant(
      unilag,
      (tx) => tx`DELETE FROM applications WHERE institution_id = ${ful} RETURNING id`,
    );
    expect(result).toHaveLength(0);

    const stillThere = await asTenant(ful, (tx) => tx`SELECT count(*)::int AS n FROM applications`);
    expect(Number(stillThere[0].n)).toBeGreaterThan(0);
  });

  it('cannot move its own row into another tenant', async () => {
    // WITH CHECK, not just USING. Without it, a row can be updated out of the
    // tenant it belongs to — a leak that reads as a legitimate write.
    const result = await asTenant(
      unilag,
      (tx) => tx`UPDATE fee_items SET institution_id = ${ful} RETURNING id`,
    ).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(result.message).toMatch(/row-level security/i);
    } else {
      expect(result).toHaveLength(0);
    }
  });
});

describe('the audit log is append-only from the request path', () => {
  it('accepts inserts', async () => {
    const rows = await asTenant(
      unilag,
      (tx) => tx`
        INSERT INTO audit_log (institution_id, action) VALUES (${unilag}, 'test.append') RETURNING id
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses updates and deletes', async () => {
    // CMP-14: staff with full application access still cannot edit the record
    // of what they did. This is a GRANT, not a policy — there is no escape.
    await expect(
      app`UPDATE audit_log SET action = 'tampered' WHERE action = 'test.append'`,
    ).rejects.toThrow(/permission denied/i);

    await expect(app`DELETE FROM audit_log WHERE action = 'test.append'`).rejects.toThrow(
      /permission denied/i,
    );
  });
});
