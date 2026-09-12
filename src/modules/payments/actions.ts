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

export async function startTuitionCheckout(_prev: FormState, _form: FormData): Promise<FormState> {
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

  const reference = newReference('TUI');
  const split = splitFor(cart.totalKobo, institution.paystackSharePercent);

  await withTenant(institution.id, async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        institutionId: institution.id,
        userId: me.userId,
        applicationId: app.id,
        reference,
        context: 'tuition',
        amountKobo: cart.totalKobo,
        subaccountCode: institution.paystackSubaccountCode,
        institutionShareKobo: split.institutionShareKobo,
        platformShareKobo: split.platformShareKobo,
      })
      .returning({ id: transactions.id });

    await tx.insert(transactionLines).values(
      cart.lines.map((line) => ({
        institutionId: institution.id,
        transactionId: row.id,
        feeItemId: line.id,
        label: line.label,
        amountKobo: line.amountKobo,
      })),
    );
  });

  await audit({
    action: 'payment.initialized',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'transactions',
    entityId: reference,
    detail: { context: 'tuition', amountKobo: cart.totalKobo },
  });

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const init = await initializeTransaction({
    email: me.email,
    amountKobo: cart.totalKobo,
    reference,
    callbackUrl: `${proto}://${h.get('host')}/pay/pending/${reference}`,
    subaccountCode: institution.paystackSubaccountCode,
    metadata: { applicationId: app.id, institutionId: institution.id },
  });

  return { redirectTo: init.authorizationUrl };
}
