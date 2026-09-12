import 'server-only';
import { and, eq, isNull, or } from 'drizzle-orm';
import { withTenant } from '@/db';
import { feeItems } from '@/db/schema';

export type FeeKind = (typeof feeItems.$inferSelect)['kind'];

/**
 * IA-03 fee schedule lookup. A cohort-specific fee overrides the
 * institution-wide one, which is what lets a university raise tuition for the
 * next intake without changing what current applicants were quoted.
 */
export async function feeFor(institutionId: string, kind: FeeKind, cohortId?: string | null) {
  // fee_items is tenant-scoped, so this must carry tenant context or RLS
  // correctly returns nothing and the page renders a blank fee.
  const rows = await withTenant(institutionId, (tx) =>
    tx
      .select()
      .from(feeItems)
      .where(
      and(
        eq(feeItems.institutionId, institutionId),
        eq(feeItems.kind, kind),
        cohortId ? or(eq(feeItems.cohortId, cohortId), isNull(feeItems.cohortId)) : isNull(feeItems.cohortId),
      ),
      ),
  );
  return rows.find((r) => r.cohortId === cohortId) ?? rows.find((r) => r.cohortId === null) ?? null;
}

/**
 * PY-05. The tuition checkout is a cart, not a single charge: acceptance fee,
 * tuition, and whatever mandatory levies the institution has configured.
 */
export async function tuitionCart(institutionId: string, cohortId: string) {
  const rows = await withTenant(institutionId, (tx) =>
    tx.select().from(feeItems).where(eq(feeItems.institutionId, institutionId)),
  );
  const relevant = rows.filter(
    (r) =>
      (r.cohortId === cohortId || r.cohortId === null) &&
      r.kind !== 'application' &&
      r.mandatory,
  );
  // A cohort-specific line beats the institution default for the same kind.
  const byKind = new Map<FeeKind, (typeof rows)[number]>();
  for (const r of relevant) {
    const existing = byKind.get(r.kind);
    if (!existing || (r.cohortId && !existing.cohortId)) byKind.set(r.kind, r);
  }
  const lines = [...byKind.values()];
  return { lines, totalKobo: lines.reduce((sum, l) => sum + l.amountKobo, 0) };
}
