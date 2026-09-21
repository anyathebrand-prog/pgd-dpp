'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { refunds, transactions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { createRefund } from '@/lib/paystack';
import { decisionProblem, isRefundReason, refundProblem } from './refund-rules';
import type { FormState } from '../auth/actions';

/**
 * PAY-12 — the refund workflow, with its approval chain and audit trail.
 *
 * Two steps and two people. A registry officer or administrator requests; a
 * *different* administrator approves or rejects. The rules themselves live in
 * refund-rules.ts, where they are tested directly; this file is the plumbing
 * that makes sure every path goes through them.
 *
 * What a refund does not do is change anybody's academic standing. Refunding
 * tuition for a withdrawal returns money; the withdrawal itself is a registry
 * decision (gap G-04 declares it a manual process for v1), and quietly
 * un-enrolling someone as a side effect of a payment would be the platform
 * deciding what only the institution may.
 */

const OPEN = ['requested', 'approved', 'processed'] as const;

/** Money already refunded or on its way, which is what the cap counts. */
async function committed(institutionId: string, transactionId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select({ n: sql<number>`coalesce(sum(${refunds.amountKobo}), 0)::int` })
      .from(refunds)
      .where(
        and(eq(refunds.transactionId, transactionId), inArray(refunds.status, [...OPEN])),
      ),
  );
  return Number(row?.n ?? 0);
}

export async function requestRefund(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');

  const transactionId = String(form.get('transactionId') ?? '');
  const reason = String(form.get('reason') ?? '');
  const method = String(form.get('method') ?? '');
  const note = String(form.get('note') ?? '');
  // Entered in naira, because that is what a person reads off a receipt.
  const naira = Number(String(form.get('amount') ?? '').replace(/[,\s₦]/g, ''));
  const amountKobo = Math.round(naira * 100);

  const [txn] = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  );
  if (!txn) return { error: 'That payment could not be found at this institution.' };

  const problem = refundProblem({
    status: txn.status,
    context: txn.context,
    paidKobo: txn.amountKobo,
    alreadyRefundedKobo: await committed(institution.id, txn.id),
    amountKobo,
    reason,
    note,
    method,
    channel: txn.channel,
    doublePaid: Boolean((txn.metadata as Record<string, unknown>)?.probableDoublePayment),
  });
  if (problem) return { error: problem };
  if (!isRefundReason(reason)) return { error: 'Choose why this is being refunded.' };

  const [created] = await withTenant(institution.id, (tx) =>
    tx
      .insert(refunds)
      .values({
        institutionId: institution.id,
        transactionId: txn.id,
        amountKobo,
        reason,
        note: note.trim(),
        method: method as 'paystack' | 'manual_transfer',
        requestedBy: me.userId,
      })
      .returning({ id: refunds.id }),
  );

  await audit({
    action: 'refund.requested',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: me.roles.includes('institution_admin') ? 'institution_admin' : 'registry',
    entity: 'refunds',
    entityId: created.id,
    subjectId: txn.userId,
    detail: { reference: txn.reference, amountKobo, reason, method },
  });

  return { redirectTo: `/admin/refunds?requested=${encodeURIComponent(txn.reference)}` };
}

export async function decideRefund(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const refundId = String(form.get('refundId') ?? '');
  const decision = String(form.get('decision') ?? '');
  const decisionNote = String(form.get('decisionNote') ?? '').trim();
  const bankReference = String(form.get('bankReference') ?? '').trim();

  if (decision !== 'approve' && decision !== 'reject') return { error: 'Approve or reject.' };

  const [refund] = await withTenant(institution.id, (tx) =>
    tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1),
  );
  if (!refund) return { error: 'That refund could not be found at this institution.' };

  const problem = decisionProblem({
    status: refund.status,
    requestedBy: refund.requestedBy,
    deciderId: me.userId,
  });
  if (problem) return { error: problem };

  if (decision === 'reject') {
    if (decisionNote.length < 10) {
      return { error: 'Say why it is being refused. The person who asked will read it.' };
    }
    // Conditional on the status just checked: two approvers deciding at once
    // cannot both win.
    const [rejected] = await withTenant(institution.id, (tx) =>
      tx
        .update(refunds)
        .set({
          status: 'rejected',
          decidedBy: me.userId,
          decidedAt: new Date(),
          decisionNote,
          updatedAt: new Date(),
        })
        .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'requested')))
        .returning({ id: refunds.id }),
    );
    if (!rejected) return { error: 'Somebody else decided this refund while you had it open.' };

    await audit({
      action: 'refund.rejected',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'institution_admin',
      entity: 'refunds',
      entityId: refund.id,
      detail: { amountKobo: refund.amountKobo, decisionNote },
    });
    return { redirectTo: '/admin/refunds?decided=rejected' };
  }

  // A manual transfer is the institution sending money itself; the reference
  // is the only evidence it happened, so it is required rather than optional.
  if (refund.method === 'manual_transfer' && bankReference.length < 4) {
    return {
      error:
        'Enter the reference from your bank for the transfer you made. Without it there is no record the money went back.',
    };
  }

  const [txn] = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).where(eq(transactions.id, refund.transactionId)).limit(1),
  );
  if (!txn) return { error: 'The payment behind this refund is missing.' };

  // Claim it before money moves, so a second approval in flight finds it gone.
  const [claimed] = await withTenant(institution.id, (tx) =>
    tx
      .update(refunds)
      .set({
        status: 'approved',
        decidedBy: me.userId,
        decidedAt: new Date(),
        decisionNote: decisionNote || null,
        updatedAt: new Date(),
      })
      .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'requested')))
      .returning({ id: refunds.id }),
  );
  if (!claimed) return { error: 'Somebody else decided this refund while you had it open.' };

  let outcome: { ok: true; id: string } | { ok: false; reason: string };
  if (refund.method === 'paystack') {
    outcome = await createRefund({
      reference: txn.reference,
      amountKobo: refund.amountKobo,
      note: refund.note,
    });
  } else {
    outcome = { ok: true, id: bankReference };
  }

  if (!outcome.ok) {
    await withTenant(institution.id, (tx) =>
      tx
        .update(refunds)
        .set({ status: 'failed', failureReason: outcome.ok ? null : outcome.reason, updatedAt: new Date() })
        .where(eq(refunds.id, refund.id)),
    );
    await audit({
      action: 'refund.failed',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'institution_admin',
      entity: 'refunds',
      entityId: refund.id,
      detail: { reason: outcome.reason },
    });
    return { redirectTo: '/admin/refunds?decided=failed' };
  }

  await withTenant(institution.id, async (tx) => {
    await tx
      .update(refunds)
      .set({
        status: 'processed',
        paystackRefundId: refund.method === 'paystack' ? outcome.id : null,
        bankReference: refund.method === 'manual_transfer' ? bankReference : null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refund.id));

    /*
     * A payment reversed in full through Paystack stops being a payment. A
     * manual transfer never touches the transaction: in the double-payment
     * case the card charge is still the one that counted.
     */
    if (refund.method === 'paystack') {
      const [row] = await tx
        .select({ n: sql<number>`coalesce(sum(${refunds.amountKobo}), 0)::int` })
        .from(refunds)
        .where(
          and(
            eq(refunds.transactionId, txn.id),
            eq(refunds.status, 'processed'),
            eq(refunds.method, 'paystack'),
          ),
        );
      if (Number(row?.n ?? 0) >= txn.amountKobo) {
        await tx
          .update(transactions)
          .set({ status: 'reversed', updatedAt: new Date() })
          .where(eq(transactions.id, txn.id));
      }
    }
  });

  await audit({
    action: 'refund.processed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'refunds',
    entityId: refund.id,
    subjectId: txn.userId,
    detail: {
      reference: txn.reference,
      amountKobo: refund.amountKobo,
      method: refund.method,
      requestedBy: refund.requestedBy,
    },
  });

  return { redirectTo: '/admin/refunds?decided=processed' };
}
