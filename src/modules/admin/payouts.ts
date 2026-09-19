'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { createSubaccount, listBanks, resolveAccount } from '@/lib/paystack';
import type { FormState } from '../auth/actions';

/**
 * IA-07 payout setup (PAY-06).
 *
 * The sentence in the flow that this module exists to honour: "account name
 * resolved and displayed for explicit confirmation before saving — Paystack
 * is not liable for payouts to a wrong account."
 *
 * A transposed digit produces a valid account number belonging to a stranger.
 * Nothing in the system can tell the difference, and Paystack will pay it
 * without complaint. The only control that works is a person reading the name
 * the bank returned and saying yes, that is us — so the flow is deliberately
 * two steps, and the second step re-resolves rather than trusting the name the
 * browser sends back.
 */

/** Step one: ask the bank who owns that account. */
export async function resolvePayoutAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  const bankCode = String(form.get('bankCode') ?? '').trim();
  const accountNumber = String(form.get('accountNumber') ?? '').trim();

  const banks = await listBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return { error: 'Choose the bank the account is with.' };

  const resolution = await resolveAccount(accountNumber, bankCode);
  if (!resolution.ok) {
    await audit({
      action: 'payout.resolve_failed',
      institutionId: institution.id,
      entity: 'institutions',
      entityId: institution.id,
      detail: { bank: bank.name, reason: resolution.reason },
    });
    return { error: resolution.reason };
  }

  // Nothing is saved yet. This step exists only to put a name in front of a
  // person, and the redirect carries it back for them to confirm.
  return {
    redirectTo: `/admin/payouts?bank=${encodeURIComponent(bankCode)}&account=${encodeURIComponent(
      accountNumber,
    )}&name=${encodeURIComponent(resolution.accountName)}`,
  };
}

/** Step two: the person has read the name and says it is theirs. */
export async function confirmPayoutAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const bankCode = String(form.get('bankCode') ?? '').trim();
  const accountNumber = String(form.get('accountNumber') ?? '').trim();
  const sharePercent = Number(form.get('sharePercent') ?? 90);
  const confirmed = form.get('confirmed') === 'on';

  if (!confirmed) {
    return { error: 'Confirm that the name the bank returned is your institution’s account.' };
  }
  if (!Number.isInteger(sharePercent) || sharePercent < 50 || sharePercent > 100) {
    return { error: 'Your share is a whole percentage between 50 and 100.' };
  }

  const banks = await listBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return { error: 'Choose the bank the account is with.' };

  /*
   * Re-resolved here rather than trusting the hidden field.
   *
   * The name the browser sends back is whatever the browser feels like
   * sending. Asking the bank again costs one call and is the difference
   * between a confirmation and a formality — and if the answer has changed
   * since step one, the person needs to see that before money moves.
   */
  const resolution = await resolveAccount(accountNumber, bankCode);
  if (!resolution.ok) return { error: resolution.reason };

  const shownName = String(form.get('accountName') ?? '').trim();
  if (shownName && shownName !== resolution.accountName) {
    // The name-mismatch state the flow asks for, and a blocking one.
    await audit({
      action: 'payout.name_mismatch',
      institutionId: institution.id,
      actorId: me.userId,
      entity: 'institutions',
      entityId: institution.id,
      detail: { shown: shownName, resolved: resolution.accountName },
    });
    return {
      error: `The bank now returns “${resolution.accountName}”, which is not the name you were shown. Nothing has been saved. Start again and read it carefully.`,
    };
  }

  const created = await createSubaccount({
    businessName: institution.name,
    bankCode,
    accountNumber,
    sharePercent,
  });
  if (!created.ok) return { error: created.reason };

  await db
    .update(institutions)
    .set({
      bankName: bank.name,
      bankCode,
      bankAccountNumber: accountNumber,
      bankAccountName: resolution.accountName,
      paystackSubaccountCode: created.code,
      paystackSharePercent: sharePercent,
      payoutVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(institutions.id, institution.id));

  await audit({
    action: 'payout.configured',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'institutions',
    entityId: institution.id,
    // The account number is not in the audit detail. It is in the row, where
    // it has to be; repeating it into an append-only log that a wider set of
    // people can read is a copy nobody needs.
    detail: { bank: bank.name, accountName: resolution.accountName, sharePercent },
  });

  return { redirectTo: '/admin/payouts?configured=1' };
}
