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
  /**
   * PAY-11. An offline transfer approved by an institution admin settles
   * through this same function — IA-09 requires that approval "moves the
   * application forward exactly as a webhook would", and the only way to be
   * sure of that is for there to be one path rather than two that agree.
   *
   * What differs is the audit entry: a webhook is `system:webhook` and
   * nobody's decision, while an approval is a named person vouching that money
   * arrived in a bank account. Recording both as the former would lose the
   * only part an auditor would ask about.
   */
  approvedBy?: { userId: string; role: string } | null;
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

    /*
     * `awaiting_approval` and a signed webhook.
     *
     * A signed `charge.success` is Paystack saying card money arrived, and
     * PAY-03 makes the webhook the source of truth — so it settles, rather
     * than waiting for a person to approve what the bank has already
     * confirmed. The route here is ordinary: card checkout appears to fail,
     * the candidate switches to transfer and uploads proof, which rewrites
     * this same row, and then the bank authorisation lands late.
     *
     * Two things this does not do.
     *
     * It does not settle a *transfer*. Nothing in this branch is reachable
     * without a signed webhook; an offline proof still needs IA-09 and a
     * person, because a screenshot is not evidence that money moved.
     *
     * And it does not settle a row parked here by an amount mismatch. That
     * state is a human's to resolve, and a later event agreeing with the
     * wrong amount is not a resolution.
     */
    let supersededTransfer: Record<string, unknown> | null = null;
    if (txn.status === 'awaiting_approval' && !params.approvedBy) {
      const priorMismatch = Boolean((txn.metadata as Record<string, unknown>)?.amountMismatch);
      if (priorMismatch) {
        await tx
          .update(transactions)
          .set({
            metadata: {
              ...txn.metadata,
              paystackConfirmation: {
                paystackId: params.paystackId ?? null,
                amountKobo: params.amountKobo ?? null,
                receivedAt: new Date().toISOString(),
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, txn.id));
        return { outcome: 'awaiting_approval' as const };
      }

      // Kept so IA-09 and the candidate's own record show that a transfer was
      // also in flight. If it arrived too, somebody has paid twice and the
      // institution has to refund one of them — silence here is how that goes
      // unnoticed.
      supersededTransfer = (txn.metadata as Record<string, unknown>)?.offline
        ? { ...((txn.metadata as Record<string, unknown>).offline as Record<string, unknown>) }
        : null;
    }

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
        ...(supersededTransfer
          ? {
              // It settled by card, whatever the row said while the proof was
              // waiting.
              channel: 'paystack' as const,
              metadata: {
                ...txn.metadata,
                probableDoublePayment: {
                  settledBy: 'paystack',
                  pendingTransferProof: supersededTransfer,
                },
              },
            }
          : {}),
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
        // The institution's own abbreviation, in full. An arbitrary truncation
        // turns UNILAG into UNIL, which is not what any registrar writes and
        // would not match the format on the rest of the student's records.
        const code = institution?.shortName?.replace(/[^A-Z]/gi, '').toUpperCase() || 'PGD';
        matricNumber = `${code}/DPP/${year}/${humanCode(5)}`;

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
      actorId: params.approvedBy?.userId ?? null,
      actorRole: params.approvedBy?.role ?? 'system:webhook',
      action: 'payment.settled',
      entity: 'transactions',
      entityId: txn.id,
      subjectId: txn.userId,
      detail: {
        reference: txn.reference,
        context: txn.context,
        matricNumber,
        channel: txn.channel,
      },
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
