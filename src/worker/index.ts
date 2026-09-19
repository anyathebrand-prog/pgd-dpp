/**
 * The job worker — §7.1 puts this outside the main app from day one.
 *
 * It runs as the elevated database role, deliberately and separately from the
 * request path (§7.4), because purging and reconciliation legitimately cross
 * tenants. Each job logs what it did to `audit_log` so DP-07 can render a
 * report rather than an assertion.
 *
 * Production schedules these with pg-boss. This entry point runs them once, so
 * they can be exercised by hand and by CI:
 *
 *     npm run worker -- purge
 *     npm run worker -- lapse-offers
 *     npm run worker -- reconcile
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import * as s from './../db/schema';
import { deleteObject } from '../lib/storage';
import { verifyTransaction } from '../lib/paystack';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required — the worker runs as the owner role');

const client = postgres(url, { max: 2, onnotice: () => {} });
const db = drizzle(client, { schema: s });

/**
 * CMP-10. The job that makes the retention schedule real.
 *
 * Deletion is verified, not assumed: the object store delete has to return
 * true before the row is marked purged. A schedule that marks things deleted
 * without checking is worse than no schedule, because it produces confident
 * evidence of something that did not happen.
 */
async function purge() {
  const due = await db
    .select()
    .from(s.documents)
    .where(and(lt(s.documents.purgeAfter, new Date()), isNull(s.documents.purgedAt)));

  console.log(`${due.length} documents are due for deletion.`);
  let deleted = 0;
  const failures: string[] = [];

  for (const doc of due) {
    let gone = false;
    let error: string | null = null;
    try {
      gone = await deleteObject(doc.objectKey);
      if (!gone) error = 'The object store reported the file was not removed.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (!gone) {
      // Recorded, not merely counted. DP-07 has to distinguish "tried and
      // failed" from "never ran", and it cannot do that from an absent
      // purgedAt alone.
      await db
        .update(s.documents)
        .set({ purgeAttemptedAt: new Date(), purgeError: error })
        .where(eq(s.documents.id, doc.id));
      failures.push(doc.id);
      continue;
    }
    await db
      .update(s.documents)
      .set({ purgedAt: new Date(), status: 'purged', purgeAttemptedAt: new Date(), purgeError: null })
      .where(eq(s.documents.id, doc.id));
    await db.insert(s.auditLog).values({
      institutionId: doc.institutionId,
      actorRole: 'system:purge',
      action: 'document.purged',
      entity: 'documents',
      entityId: doc.id,
      detail: { kind: doc.kind, purgeAfter: doc.purgeAfter },
    });
    deleted += 1;
  }

  await db
    .update(s.retentionRules)
    .set({ lastRunAt: new Date(), lastPurgedCount: deleted })
    .where(eq(s.retentionRules.entity, 'documents (rejected applicants)'));

  console.log(`Deleted ${deleted}. ${failures.length} failed and are left un-marked for retry.`);
  if (failures.length) {
    // Left visibly broken rather than silently retried forever: an overdue
    // purge is a live compliance failure and DP-01 surfaces it as one.
    console.error('Failed object keys remain due:', failures.join(', '));
  }
}

/**
 * §5.1: an offer lapses if the acceptance fee is unpaid within N days, and the
 * lapsed seat returns to the cohort. Without this job, capacity leaks away into
 * offers nobody took up.
 */
async function lapseOffers() {
  const lapsed = await db
    .update(s.applications)
    .set({ status: 'offer_lapsed', updatedAt: new Date() })
    .where(and(eq(s.applications.status, 'admitted'), lt(s.applications.offerExpiresAt, new Date())))
    .returning({ id: s.applications.id, institutionId: s.applications.institutionId, userId: s.applications.userId });

  for (const row of lapsed) {
    await db.insert(s.auditLog).values({
      institutionId: row.institutionId,
      actorRole: 'system:offer_expiry',
      action: 'offer.lapsed',
      entity: 'applications',
      entityId: row.id,
      subjectId: row.userId,
    });
  }
  console.log(`${lapsed.length} offers lapsed and their seats released.`);
}

/**
 * PAY-08. Compares our transaction table against Paystack and flags drift for
 * a human. It does not self-heal: a payments system that quietly reconciles
 * itself hides the bug that caused the drift.
 */
async function reconcile() {
  const pending = await db
    .select()
    .from(s.transactions)
    .where(eq(s.transactions.status, 'pending'));

  console.log(`Checking ${pending.length} pending transactions against Paystack.`);
  let drift = 0;

  for (const txn of pending) {
    const remote = await verifyTransaction(txn.reference);
    if (!remote) continue;
    if (remote.status === 'success') {
      drift += 1;
      // Successful at Paystack but pending here means a webhook was lost.
      // Flagged, not settled: settlement runs through the webhook path, and
      // a second route into enrollment is a second route to get it wrong.
      await db
        .update(s.transactions)
        .set({
          metadata: { ...txn.metadata, reconciliationDrift: 'paystack reports success, webhook not received' },
          updatedAt: new Date(),
        })
        .where(eq(s.transactions.id, txn.id));
      console.warn(`DRIFT: ${txn.reference} is successful at Paystack but pending here.`);
    }
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.inboundEvents)
    // Signed events only. Forged deliveries are recorded as evidence and
    // never processed by design, so counting them here would let anyone with
    // curl inflate a warning meant for lost payments.
    .where(and(isNull(s.inboundEvents.processedAt), eq(s.inboundEvents.signatureValid, true)));
  if (Number(n) > 0) console.warn(`${n} inbound webhook events have not been processed.`);

  console.log(`Reconciliation complete. ${drift} transactions flagged.`);
}

const jobs: Record<string, () => Promise<void>> = { purge, 'lapse-offers': lapseOffers, reconcile };

async function main() {
  const name = process.argv[2];
  if (!name || !jobs[name]) {
    console.error(`Usage: npm run worker -- <${Object.keys(jobs).join('|')}>`);
    process.exit(1);
  }
  await jobs[name]();
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
