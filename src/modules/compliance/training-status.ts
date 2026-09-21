import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { staffTraining } from '@/db/schema';
import { trainingStatus, type TrainingStatus } from './training';

/**
 * CMP-17 — the latest *pass* for each person, and what it means today.
 *
 * Read by the staff roster (IA-05) and the DPO console, so both answer "is
 * this person trained" the same way. A failed attempt does not reset a valid
 * pass: somebody who retakes early and fails is still trained until the pass
 * they already hold expires.
 */
export async function trainingFor(userIds: string[]) {
  const result = new Map<string, { status: TrainingStatus; expiresAt: Date | null }>();
  for (const id of userIds) result.set(id, { status: 'never', expiresAt: null });
  if (userIds.length === 0) return result;

  const passes = await db
    .select()
    .from(staffTraining)
    .where(and(inArray(staffTraining.userId, userIds), eq(staffTraining.passed, true)))
    .orderBy(desc(staffTraining.createdAt));

  for (const id of userIds) {
    const latest = passes.find((p) => p.userId === id);
    if (latest?.expiresAt) {
      result.set(id, {
        status: trainingStatus({ version: latest.version, expiresAt: latest.expiresAt }),
        expiresAt: latest.expiresAt,
      });
    }
  }
  return result;
}
