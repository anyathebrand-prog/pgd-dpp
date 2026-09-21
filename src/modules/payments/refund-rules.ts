import 'server-only';

/**
 * PAY-12 — what may be refunded, and who may say so.
 *
 * Pure, because these are the two rules a refund workflow exists to hold, and
 * both fail quietly: an over-refund is money gone, and a refund approved by the
 * person who asked for it is not an approval chain at all.
 *
 * §5.1 makes the application fee non-refundable and says the refund policy
 * "only needs to cover tuition edge cases (withdrawal, cohort cancelled)". It
 * does not name the case the "probably paid twice" list on IA-09 now surfaces:
 * a duplicate payment is not the fee, it is money the institution received
 * twice, and it has to be returnable whatever it was paid for. So the fee is
 * refundable for exactly that reason and no other.
 */

export const REFUND_REASONS = {
  duplicate_payment: {
    label: 'Paid twice',
    detail: 'The same charge was paid more than once — typically card and transfer both landed.',
  },
  overpayment: {
    label: 'Paid more than was owed',
    detail: 'The amount received exceeds what was charged.',
  },
  withdrawal: {
    label: 'Student withdrew',
    detail: 'The student has left the programme, per the institution’s withdrawal policy.',
  },
  cohort_cancelled: {
    label: 'Intake cancelled',
    detail: 'The institution cancelled the intake the tuition was for.',
  },
} as const;

export type RefundReason = keyof typeof REFUND_REASONS;

export function isRefundReason(value: string): value is RefundReason {
  return Object.prototype.hasOwnProperty.call(REFUND_REASONS, value);
}

/** Reasons that do not depend on the payment being tuition. */
const ANY_PAYMENT: RefundReason[] = ['duplicate_payment', 'overpayment'];

/**
 * Why this refund cannot be requested, or null if it can.
 *
 * `alreadyRefundedKobo` counts every refund that is requested, approved or
 * processed — not just processed ones. Two requests of ₦300,000 against a
 * ₦515,000 payment are each individually fine and together an over-refund,
 * and the only moment to stop that is before either is approved.
 */
export function refundProblem(input: {
  status: string;
  context: string;
  paidKobo: number;
  alreadyRefundedKobo: number;
  amountKobo: number;
  reason: string;
  note: string;
  method: string;
  /** How the payment itself arrived: `paystack` or `offline_transfer`. */
  channel: string;
  /** Whether the payment is carrying a transfer proof it was settled over. */
  doublePaid: boolean;
}): string | null {
  if (input.status !== 'success') {
    return 'Only a payment that settled can be refunded. There is no money here to give back yet.';
  }
  if (!isRefundReason(input.reason)) {
    return 'Choose why this is being refunded.';
  }
  if (input.context === 'application' && !ANY_PAYMENT.includes(input.reason)) {
    // §5.1: non-refundable, and disclosed as such before payment.
    return 'The application fee is non-refundable, and candidates are told so before they pay. It can only be refunded if it was paid twice or overpaid.';
  }
  if (!Number.isInteger(input.amountKobo) || input.amountKobo <= 0) {
    return 'Enter an amount to refund.';
  }

  const remaining = input.paidKobo - input.alreadyRefundedKobo;
  if (remaining <= 0) {
    return 'This payment has already been refunded in full, or has refunds pending that would cover all of it.';
  }
  if (input.amountKobo > remaining) {
    return `That is more than can be refunded. ₦${(remaining / 100).toLocaleString('en-NG')} of this payment is not already refunded or pending.`;
  }

  if (input.method !== 'paystack' && input.method !== 'manual_transfer') {
    return 'Choose how the money goes back.';
  }
  /*
   * Paystack can only reverse what Paystack collected. A payment that arrived
   * by bank transfer has no card charge behind it to reverse.
   */
  if (input.method === 'paystack' && input.channel !== 'paystack') {
    return 'This payment came in by bank transfer, so Paystack has nothing to reverse. Return it by transfer instead.';
  }
  /*
   * The double-payment case, and the reason `method` exists. The card charge is
   * the payment that counted; the duplicate is the sponsor's transfer, which
   * never went through Paystack. Reversing the card would leave the student
   * marked unpaid and the transfer still held.
   */
  if (input.reason === 'duplicate_payment' && input.doublePaid && input.method === 'paystack') {
    return 'The duplicate here is the bank transfer, not the card payment — the card payment is the one that counted. Return the transfer to the sponsor instead of reversing the card.';
  }

  // The approver decides on what is written here, and the student may ask.
  if (input.note.trim().length < 15) {
    return 'Say what happened, in a sentence the approver and the student could both read.';
  }
  return null;
}

/**
 * Why this person cannot decide this refund, or null if they can.
 *
 * The two-person rule is the whole of "approval chain": the person who asked
 * for money to leave the institution is not the person who lets it. It holds
 * for rejection too — refusing your own request is harmless, but the rule is
 * simpler to reason about, and to audit, when it has no exceptions.
 */
export function decisionProblem(input: {
  status: string;
  requestedBy: string;
  deciderId: string;
}): string | null {
  if (input.status !== 'requested') {
    return 'This refund has already been decided.';
  }
  if (input.requestedBy === input.deciderId) {
    return 'You asked for this refund, so somebody else has to approve it. That second person is the control.';
  }
  return null;
}
