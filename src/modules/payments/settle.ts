import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { adminDb } from '@/db';
import {
  applications,
  auditLog,
  cohorts,
  enrollments,
  institutions,
  memberships,
  transactions,
  users,
} from '@/db/schema';
import { humanCode } from '@/lib/crypto';
import { receiptMail, sendMail } from '@/lib/mail';

/**
 * PAY-03. The single place a payment becomes real.
 *
 * Called only from the webhook path, never from a page. The browser callback
 * redirects and nothing more; if this function has not run, the candidate is
 * not enrolled, whatever their browser says.
 *
 * It runs on the elevated role (§7.4) because settlement legitimately crosses
 * tenants: one webhook receiver serves every institution, and at the moment
 * the event arrives there is no request context to derive a tenant from. Every
 * write it makes is scoped by the transaction row it started from, and the
 * whole thing is one database transaction.
 */
export async function settleTransaction(params: {
  reference: string;
  paystackId?: string | null;
  amountKobo?: number | null;
  paidAt?: Date;
}) {
  return adminDb.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.reference, params.reference))
      .limit(1);

    if (!txn) return { outcome: 'unknown_reference' as const };
    // PAY-04 idempotency: a duplicate delivery of the same event is a no-op,
    // not a second enrollment.
    if (txn.status === 'success') return { outcome: 'already_settled' as const };

    // Never trust the amount in the callback over the amount we charged. A
    // mismatch is a reconciliation exception for a human, not something to
    // resolve silently in either direction.
    if (params.amountKobo != null && params.amountKobo !== txn.amountKobo) {
      await tx
        .update(transactions)
        .set({
          status: 'awaiting_approval',
          metadata: { ...txn.metadata, amountMismatch: { expected: txn.amountKobo, received: params.amountKobo } },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, txn.id));
      return { outcome: 'amount_mismatch' as const };
    }

    await tx
      .update(transactions)
      .set({
        status: 'success',
        paystackId: params.paystackId ?? null,
        paidAt: params.paidAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txn.id));

    const [user] = await tx.select().from(users).where(eq(users.id, txn.userId)).limit(1);
    const [institution] = await tx
      .select()
      .from(institutions)
      .where(eq(institutions.id, txn.institutionId))
      .limit(1);

    let matricNumber: string | null = null;

    if (txn.context === 'application' && txn.applicationId) {
      // §5.1: the fee is charged at submission, and settlement is what puts the
      // application in front of the registry.
      await tx
        .update(applications)
        .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(applications.id, txn.applicationId), eq(applications.status, 'awaiting_application_fee')));
    }

    if (txn.context === 'tuition' && txn.applicationId) {
      const [app] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, txn.applicationId))
        .limit(1);

      if (app && app.status === 'offer_accepted') {
        const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, app.cohortId)).limit(1);
        const year = (cohort?.startsAt ?? new Date()).getFullYear();
        matricNumber = `${institution?.shortName?.replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4) ?? 'PGD'}/DPP/${year}/${humanCode(5)}`;

        await tx.insert(enrollments).values({
          institutionId: txn.institutionId,
          userId: txn.userId,
          cohortId: app.cohortId,
          applicationId: app.id,
          matricNumber,
        });

        await tx
          .update(applications)
          .set({ status: 'enrolled', updatedAt: new Date() })
          .where(eq(applications.id, app.id));

        // AUTH-10 lifecycle: candidate → student, with the role to match.
        await tx.update(users).set({ status: 'student', updatedAt: new Date() }).where(eq(users.id, txn.userId));
        await tx
          .insert(memberships)
          .values({ userId: txn.userId, institutionId: txn.institutionId, role: 'student' })
          .onConflictDoNothing();
      }
    }

    await tx.insert(auditLog).values({
      institutionId: txn.institutionId,
      actorId: null,
      actorRole: 'system:webhook',
      action: 'payment.settled',
      entity: 'transactions',
      entityId: txn.id,
      subjectId: txn.userId,
      detail: { reference: txn.reference, context: txn.context, matricNumber },
    });

    if (user) {
      // PAY-07. Outside the transaction would be safer against a slow SMTP
      // call; the mailer never throws into this path, so it cannot roll back a
      // settled payment.
      await sendMail(
        receiptMail(
          user.email,
          txn.reference,
          txn.amountKobo,
          txn.context === 'application' ? 'your application fee' : 'tuition and acceptance fees',
        ),
      );
    }

    return { outcome: 'settled' as const, matricNumber, context: txn.context };
  });
}

/** PAY-10. A failed or abandoned charge is recorded, not deleted. */
export async function failTransaction(reference: string, status: 'failed' | 'abandoned') {
  await adminDb
    .update(transactions)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(transactions.reference, reference), eq(transactions.status, 'pending')));
}

/**
 * §5.1: cohort capacity is enforced at offer issuance, not at payment —
 * otherwise the cohort is oversold to whoever pays fastest.
 */
export async function seatsRemaining(cohortId: string) {
  const [cohort] = await adminDb.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
  if (!cohort) return 0;
  const [{ count }] = await adminDb
    .select({ count: sql<number>`count(*)::int` })
    .from(applications)
    .where(
      and(
        eq(applications.cohortId, cohortId),
        sql`${applications.status} in ('admitted','offer_accepted','enrolled')`,
      ),
    );
  return cohort.capacity - count;
}
