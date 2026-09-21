'use server';

import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, transactionLines, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import type { FormState } from '../auth/actions';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { initializeTransaction, newReference, splitFor } from '@/lib/paystack';
import { feeFor, tuitionCart } from './fees';
import { installmentDueDates, splitInstallments } from './installments';

/* --------------------------------------------------------------------- PY-01 */

/**
 * The application fee. A transaction row is written before the candidate
 * leaves for Paystack, so an abandoned checkout is still visible to
 * reconciliation (PAY-08) and to the recovery email (PAY-10) — an
 * unrecorded attempt is a payment we cannot explain later.
 */
export async function startApplicationFeeCheckout(_prev: FormState, _form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const h = await headers();

  const [app] = await withTenant(institution.id, (tx) =>
    tx.select().from(applications).where(eq(applications.userId, me.userId)).limit(1),
  );
  if (!app) return { redirectTo: '/apply' };
  if (app.status !== 'awaiting_application_fee') return { redirectTo: '/apply' };

  const fee = await feeFor(institution.id, 'application', app.cohortId);
  if (!fee) return { redirectTo: '/apply' };

  const reference = newReference('APP');
  const split = splitFor(fee.amountKobo, institution.paystackSharePercent);

  await withTenant(institution.id, async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        institutionId: institution.id,
        userId: me.userId,
        applicationId: app.id,
        reference,
        context: 'application',
        amountKobo: fee.amountKobo,
        subaccountCode: institution.paystackSubaccountCode,
        institutionShareKobo: split.institutionShareKobo,
        platformShareKobo: split.platformShareKobo,
      })
      .returning({ id: transactions.id });
    await tx.insert(transactionLines).values({
      institutionId: institution.id,
      transactionId: row.id,
      feeItemId: fee.id,
      label: fee.label,
      amountKobo: fee.amountKobo,
    });
  });

  await audit({
    action: 'payment.initialized',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'transactions',
    entityId: reference,
    detail: { context: 'application', amountKobo: fee.amountKobo },
  });

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const init = await initializeTransaction({
    email: me.email,
    amountKobo: fee.amountKobo,
    reference,
    // The callback only redirects. It confirms nothing (PAY-03).
    callbackUrl: `${proto}://${h.get('host')}/pay/pending/${reference}`,
    subaccountCode: institution.paystackSubaccountCode,
    metadata: { applicationId: app.id, institutionId: institution.id },
  });

  return { redirectTo: init.authorizationUrl };
}

/* --------------------------------------------------------------------- AP-10 */

/**
 * §5.1 LOCKED. Accepting an offer is a separate, recorded act from paying for
 * it, and it is what unlocks the tuition checkout. A candidate cannot reach
 * PY-05 without `admitted` + `offer_accepted`.
 */
export async function acceptOffer(_prev: FormState, _form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [app] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, me.userId), eq(applications.status, 'admitted')))
      .limit(1),
  );
  if (!app) return { redirectTo: '/apply' };

  if (app.offerExpiresAt && app.offerExpiresAt < new Date()) {
    await withTenant(institution.id, (tx) =>
      tx.update(applications).set({ status: 'offer_lapsed' }).where(eq(applications.id, app.id)),
    );
    return { redirectTo: '/apply/outcome' };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(applications)
      .set({ status: 'offer_accepted', updatedAt: new Date() })
      .where(eq(applications.id, app.id)),
  );

  await audit({
    action: 'offer.accepted',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'applications',
    entityId: app.id,
  });

  return { redirectTo: '/pay/tuition' };
}

export async function declineOffer(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const reason = String(form.get('reason') ?? '').trim();

  const [app] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, me.userId), eq(applications.status, 'admitted')))
      .limit(1),
  );
  if (!app) return { redirectTo: '/apply' };

  await withTenant(institution.id, (tx) =>
    tx
      .update(applications)
      .set({ status: 'withdrawn', decisionNote: reason || null, updatedAt: new Date() })
      .where(eq(applications.id, app.id)),
  );

  await audit({
    action: 'offer.declined',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'applications',
    entityId: app.id,
    detail: { reason },
  });

  return { redirectTo: '/apply' };
}

/* --------------------------------------------------------------------- PY-05 */

export async function startTuitionCheckout(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const h = await headers();

  const [app] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, me.userId), eq(applications.status, 'offer_accepted')))
      .limit(1),
  );
  // The gate. Without an accepted offer there is no tuition checkout to reach.
  if (!app) return { redirectTo: '/apply' };

  const cart = await tuitionCart(institution.id, app.cohortId);
  if (cart.lines.length === 0) return { redirectTo: '/apply' };

  /*
   * PAY-09. A plan is only on offer when the institution has turned it on,
   * and the choice arrives from the form — but the number of parts never
   * does. It is read from the institution, so a hand-made request cannot ask
   * for twelve instalments of a fee the institution splits in two.
   */
  const parts =
    form.get('plan') === 'installments' && institution.tuitionInstallments > 1
      ? institution.tuitionInstallments
      : 1;
  const amounts = splitInstallments(cart.totalKobo, parts);
  const dues = installmentDueDates(parts, new Date(), institution.installmentIntervalDays);
  const references = amounts.map(() => newReference('TUI'));
  const reference = references[0];

  await withTenant(institution.id, async (tx) => {
    for (const [i, amountKobo] of amounts.entries()) {
      const split = splitFor(amountKobo, institution.paystackSharePercent);
      const [row] = await tx
        .insert(transactions)
        .values({
          institutionId: institution.id,
          userId: me.userId,
          applicationId: app.id,
          reference: references[i],
          context: 'tuition',
          amountKobo,
          subaccountCode: institution.paystackSubaccountCode,
          institutionShareKobo: split.institutionShareKobo,
          platformShareKobo: split.platformShareKobo,
          // Only the first part goes to Paystack now. The rest are scheduled:
          // not asked for yet, and invisible to the reconcile job, which
          // checks pending rows against a Paystack that has never seen them.
          status: i === 0 ? 'pending' : 'scheduled',
          installmentNumber: parts > 1 ? i + 1 : null,
          installmentCount: parts > 1 ? parts : null,
          dueAt: parts > 1 ? dues[i] : null,
        })
        .returning({ id: transactions.id });

      // Paid in full, the receipt itemises the cart (PAY-01). Paid in parts,
      // each part's receipt says which part it is — itemising the whole cart
      // against one third of the money would misstate what was paid for.
      const lines =
        parts === 1
          ? cart.lines.map((line) => ({
              feeItemId: line.id,
              label: line.label,
              amountKobo: line.amountKobo,
            }))
          : [{ feeItemId: null, label: `Tuition and fees, part ${i + 1} of ${parts}`, amountKobo }];

      await tx.insert(transactionLines).values(
        lines.map((line) => ({ institutionId: institution.id, transactionId: row.id, ...line })),
      );
    }
  });

  await audit({
    action: 'payment.initialized',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'transactions',
    entityId: reference,
    detail: { context: 'tuition', amountKobo: cart.totalKobo, parts },
  });

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const init = await initializeTransaction({
    email: me.email,
    amountKobo: amounts[0],
    reference,
    callbackUrl: `${proto}://${h.get('host')}/pay/pending/${reference}`,
    subaccountCode: institution.paystackSubaccountCode,
    metadata: { applicationId: app.id, institutionId: institution.id },
  });

  return { redirectTo: init.authorizationUrl };
}

/**
 * PAY-09 — paying a later part of a tuition plan.
 *
 * In order: the earliest unpaid part is the one that can be paid, because
 * the gate reads the earliest overdue part, and paying the third while the
 * second is overdue would leave a student gated with money on account.
 * Settlement needs nothing new — only the first tuition payment ever enrols,
 * so a later part settles as a payment and nothing else.
 */
export async function payInstallment(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const h = await headers();

  const transactionId = String(form.get('transactionId') ?? '');

  const plan = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, me.userId), eq(transactions.context, 'tuition'))),
  );
  const unpaid = plan
    .filter((t) => t.installmentNumber && t.status !== 'success' && t.status !== 'awaiting_approval')
    .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));

  const txn = plan.find((t) => t.id === transactionId);
  // Scoped by user above: another student's instalment is not found, which
  // is the same answer as one that does not exist.
  if (!txn || !txn.installmentNumber) return { error: 'That payment is not part of your plan.' };
  if (txn.status === 'success') return { error: 'That part is already paid.' };
  if (unpaid[0]?.id !== txn.id) {
    return { error: `Pay part ${unpaid[0]?.installmentNumber} first — parts are paid in order.` };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(transactions)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(transactions.id, txn.id)),
  );

  await audit({
    action: 'payment.initialized',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'transactions',
    entityId: txn.reference,
    detail: { context: 'tuition', part: txn.installmentNumber, of: txn.installmentCount },
  });

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const init = await initializeTransaction({
    email: me.email,
    amountKobo: txn.amountKobo,
    reference: txn.reference,
    callbackUrl: `${proto}://${h.get('host')}/pay/pending/${txn.reference}`,
    subaccountCode: institution.paystackSubaccountCode,
    metadata: { applicationId: txn.applicationId, institutionId: institution.id },
  });

  return { redirectTo: init.authorizationUrl };
}
