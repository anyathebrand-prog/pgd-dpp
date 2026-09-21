import 'server-only';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactions } from '@/db/schema';
import { gateState } from './installments';

/**
 * PAY-09 — one student's tuition plan and whether it gates them.
 *
 * One function read by the lesson page, the dashboard and the plan page, so
 * the three cannot disagree about whether somebody is locked out. The rule
 * itself is `gateState`, tested on its own.
 */
export async function myPlan(institutionId: string, userId: string) {
  const parts = await withTenant(institutionId, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.context, 'tuition'),
          isNotNull(transactions.installmentNumber),
        ),
      )
      .orderBy(asc(transactions.installmentNumber)),
  );

  return { parts, ...gateState(parts) };
}
