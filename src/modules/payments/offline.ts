'use server';

import { and, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { documents, transactions, users } from '@/db/schema';
import { requireUser, requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { offlineRejectedMail, sendMail } from '@/lib/mail';
import { putObject, uploadProblem } from '@/lib/storage';
import { settleTransaction } from './settle';
import type { FormState } from '../auth/actions';
import { flagEnabled } from '@/lib/flags';

/**
 * PAY-11 — offline payment, which in Nigeria is not an edge case.
 *
 * A great many sponsors pay by bank transfer: an employer settling tuition for
 * a compliance officer, a parent, a state agency. Without this they cannot pay
 * at all, and the funnel quietly loses the applicants with the strongest
 * backing.
 *
 * The rule that makes it safe is IA-09's: approval "moves the application
 * forward exactly as a webhook would". So nothing here writes an enrolment, a
 * matriculation number or an application status. It hands the same reference
 * to `settleTransaction` and lets the one path that creates an enrolment do
 * it — with the approver's name on the audit entry instead of the webhook's.
 */

/** PY-06. The candidate or sponsor uploads evidence of the transfer. */
export async function submitOfflineProof(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();

  const reference = String(form.get('reference') ?? '').trim();

  /*
   * SA-03, enforced here and not only on the page — a hidden page with a live
   * action behind it is a flag that turns nothing off.
   *
   * Only new proof is refused. Approving and rejecting keep working with the
   * flag off, because the console's own advice is "approve the queue first",
   * and someone who has already sent money must still be able to be approved.
   */
  if (!(await flagEnabled('offline_payments', institution.id))) {
    return { error: 'Bank transfer is not being accepted here at the moment. You can still pay by card.' };
  }
  const paidOn = String(form.get('paidOn') ?? '').trim();
  const payerName = String(form.get('payerName') ?? '').trim();
  const file = form.get('file');

  const [txn] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.reference, reference), eq(transactions.userId, me.userId)))
      .limit(1),
  );

  if (!txn) return { error: 'That payment reference is not one of yours.' };
  if (txn.status === 'success') {
    return { error: 'This payment has already been settled. Nothing further is owed on it.' };
  }
  if (txn.status === 'awaiting_approval') {
    return { error: 'Proof for this payment is already with the institution for approval.' };
  }
  if (!txn.applicationId) {
    // documents hang off an application, and every offline payment at v1 is
    // either an application fee or tuition — both of which have one. Saying so
    // beats writing an orphan row to make an edge case disappear.
    return { error: 'This payment cannot be paid by transfer. Contact the institution.' };
  }
  if (payerName.length < 2) {
    return { error: 'Give the name on the account the money was sent from.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: 'Give the date of the transfer.' };
  if (!(file instanceof File)) return { error: 'Attach the receipt or transfer confirmation.' };

  const problem = uploadProblem(file);
  if (problem) return { error: problem };

  const key = `institutions/${institution.id}/payments/${txn.id}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()));

  await withTenant(institution.id, async (tx) => {
    const [proof] = await tx
      .insert(documents)
      .values({
        institutionId: institution.id,
        applicationId: txn.applicationId!,
        kind: 'payment_proof',
        objectKey: key,
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        scanStatus: 'pending',
        status: 'uploaded',
      })
      .returning({ id: documents.id });

    await tx
      .update(transactions)
      .set({
        channel: 'offline_transfer',
        status: 'awaiting_approval',
        metadata: {
          ...txn.metadata,
          offline: { payerName, paidOn, proofDocumentId: proof.id, submittedAt: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txn.id));
  });

  await audit({
    action: 'payment.offline_proof_submitted',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'transactions',
    entityId: txn.id,
    detail: { reference: txn.reference, payerName, paidOn },
  });

  return { redirectTo: `/pay/offline?ref=${encodeURIComponent(txn.reference)}&submitted=1` };
}

/**
 * IA-09. Approval, against a bank statement rather than against the document —
 * the screen says so, because a PDF of a transfer confirmation is the easiest
 * thing in this product to forge.
 */
export async function approveOfflinePayment(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('institution_admin', 'registry');
  const institution = await requireInstitution();

  const transactionId = String(form.get('transactionId') ?? '');
  const note = String(form.get('note') ?? '').trim();

  if (note.length < 4) {
    return {
      error:
        'Record what you matched it against — the statement line, the teller reference, or who confirmed it. This is the evidence that a check happened.',
    };
  }

  const [txn] = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  );
  if (!txn) return { error: 'That payment no longer exists.' };
  if (txn.status !== 'awaiting_approval') {
    return { error: `That payment is ${txn.status.replace(/_/g, ' ')}, not awaiting approval.` };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(transactions)
      .set({
        metadata: {
          ...txn.metadata,
          offline: {
            ...((txn.metadata.offline as Record<string, unknown>) ?? {}),
            approvedBy: me.userId,
            approvalNote: note,
            approvedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txn.id)),
  );

  // The same function the webhook calls. Enrolment, matriculation number and
  // application status are its business, not this one's.
  const result = await settleTransaction({
    reference: txn.reference,
    paidAt: new Date(),
    approvedBy: { userId: me.userId, role: 'institution_admin' },
  });

  if (result.outcome !== 'settled') {
    return { error: `Settlement did not complete: ${result.outcome.replace(/_/g, ' ')}.` };
  }

  await audit({
    action: 'payment.offline_approved',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    subjectId: txn.userId,
    entity: 'transactions',
    entityId: txn.id,
    detail: { reference: txn.reference, note, matricNumber: result.matricNumber },
  });

  return { notice: `${txn.reference} approved and settled.` };
}

/** IA-09. Rejected with a reason, which the payer is told verbatim. */
export async function rejectOfflinePayment(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('institution_admin', 'registry');
  const institution = await requireInstitution();

  const transactionId = String(form.get('transactionId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  if (reason.length < 10) {
    return {
      error:
        'Say why, in terms the payer can act on — no transfer found, wrong amount, unreadable receipt. They see this text.',
    };
  }

  const [txn] = await withTenant(institution.id, (tx) =>
    tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1),
  );
  if (!txn) return { error: 'That payment no longer exists.' };
  if (txn.status !== 'awaiting_approval') {
    return { error: `That payment is ${txn.status.replace(/_/g, ' ')}, not awaiting approval.` };
  }

  // Back to `pending`, not `failed`: the charge is still owed and the payer
  // can submit better evidence or pay by card. A rejected proof is not a
  // rejected payment.
  await withTenant(institution.id, (tx) =>
    tx
      .update(transactions)
      .set({
        status: 'pending',
        metadata: {
          ...txn.metadata,
          offline: {
            ...((txn.metadata.offline as Record<string, unknown>) ?? {}),
            rejectedBy: me.userId,
            rejectionReason: reason,
            rejectedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txn.id)),
  );

  // `users` is shared, so this needs no tenant context.
  const [payer] = await db.select().from(users).where(eq(users.id, txn.userId)).limit(1);
  if (payer) {
    await sendMail(offlineRejectedMail(payer.email, txn.reference, reason));
  }

  await audit({
    action: 'payment.offline_rejected',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    subjectId: txn.userId,
    entity: 'transactions',
    entityId: txn.id,
    detail: { reference: txn.reference, reason },
  });

  return { notice: `${txn.reference} rejected, and the payer has been told why.` };
}
