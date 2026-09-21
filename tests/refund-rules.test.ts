/**
 * PAY-12 — the two rules a refund workflow exists to hold.
 *
 * An over-refund is money gone, and a refund approved by the person who asked
 * for it is not an approval chain. Both are pure decisions, so they are
 * pinned here rather than clicked through.
 */
import { describe, expect, it } from 'vitest';
import { decisionProblem, refundProblem } from '@/modules/payments/refund-rules';

const TUITION = 51_500_000;
const FEE = 2_500_000;

const base = {
  status: 'success',
  context: 'tuition',
  paidKobo: TUITION,
  alreadyRefundedKobo: 0,
  amountKobo: TUITION,
  reason: 'withdrawal',
  note: 'Withdrew in week two, within the refund window.',
  method: 'paystack',
  channel: 'paystack',
  doublePaid: false,
};

describe('what may be refunded', () => {
  it('allows a full tuition refund for a withdrawal', () => {
    expect(refundProblem(base)).toBeNull();
  });

  it('refuses a payment that never settled', () => {
    expect(refundProblem({ ...base, status: 'pending' })).toMatch(/settled/);
    expect(refundProblem({ ...base, status: 'awaiting_approval' })).toMatch(/settled/);
  });

  it('keeps the application fee non-refundable, as candidates are told before paying', () => {
    // §5.1.
    const problem = refundProblem({
      ...base,
      context: 'application',
      paidKobo: FEE,
      amountKobo: FEE,
      reason: 'withdrawal',
    });
    expect(problem).toMatch(/non-refundable/);
  });

  it('but refunds the fee when it was paid twice, because that is not the fee', () => {
    // The case §5.1 does not name and the "probably paid twice" list surfaces.
    expect(
      refundProblem({
        ...base,
        context: 'application',
        paidKobo: FEE,
        amountKobo: FEE,
        reason: 'duplicate_payment',
        method: 'manual_transfer',
        doublePaid: true,
      }),
    ).toBeNull();
  });

  it('allows a partial refund', () => {
    expect(refundProblem({ ...base, amountKobo: 10_000_000 })).toBeNull();
  });

  it('refuses more than was paid', () => {
    expect(refundProblem({ ...base, amountKobo: TUITION + 1 })).toMatch(/more than can be refunded/);
  });

  it('counts pending refunds, so two safe-looking requests cannot over-refund together', () => {
    // Each of these is fine alone. Together they exceed the payment, and the
    // only moment to stop that is before either is approved.
    const second = refundProblem({
      ...base,
      alreadyRefundedKobo: 30_000_000,
      amountKobo: 30_000_000,
    });
    expect(second).toMatch(/more than can be refunded/);
  });

  it('refuses anything once the whole payment is refunded or pending', () => {
    expect(refundProblem({ ...base, alreadyRefundedKobo: TUITION, amountKobo: 1 })).toMatch(
      /already been refunded in full/,
    );
  });

  it('refuses a zero, negative or fractional amount', () => {
    expect(refundProblem({ ...base, amountKobo: 0 })).toMatch(/amount/);
    expect(refundProblem({ ...base, amountKobo: -100 })).toMatch(/amount/);
    expect(refundProblem({ ...base, amountKobo: 10.5 })).toMatch(/amount/);
  });

  it('refuses an unknown reason', () => {
    expect(refundProblem({ ...base, reason: 'goodwill' })).toMatch(/why/);
  });

  it('asks for a note somebody could actually read', () => {
    expect(refundProblem({ ...base, note: 'refund' })).toMatch(/Say what happened/);
  });
});

describe('who may decide', () => {
  it('lets a second person decide', () => {
    expect(
      decisionProblem({ status: 'requested', requestedBy: 'admin-a', deciderId: 'admin-b' }),
    ).toBeNull();
  });

  it('never lets the requester approve their own refund', () => {
    // The whole of the approval chain.
    expect(
      decisionProblem({ status: 'requested', requestedBy: 'admin-a', deciderId: 'admin-a' }),
    ).toMatch(/somebody else has to approve/);
  });

  it('refuses a refund that has already been decided', () => {
    for (const status of ['approved', 'rejected', 'processed', 'failed']) {
      expect(
        decisionProblem({ status, requestedBy: 'admin-a', deciderId: 'admin-b' }),
      ).toMatch(/already been decided/);
    }
  });
});

describe('how the money goes back', () => {
  it('cannot reverse through Paystack what never went through Paystack', () => {
    expect(
      refundProblem({ ...base, channel: 'offline_transfer', method: 'paystack' }),
    ).toMatch(/nothing to reverse/);
  });

  it('refunds a transfer by transfer', () => {
    expect(
      refundProblem({ ...base, channel: 'offline_transfer', method: 'manual_transfer' }),
    ).toBeNull();
  });

  it('will not reverse the card payment that counted to refund a duplicate transfer', () => {
    // The case the method column exists for. One transaction row, settled by
    // the card; the duplicate is the sponsor's transfer. Reversing the card
    // would leave the student unpaid and the transfer still held.
    const problem = refundProblem({
      ...base,
      reason: 'duplicate_payment',
      doublePaid: true,
      method: 'paystack',
    });
    expect(problem).toMatch(/the card payment is the one that counted/);
  });

  it('returns that duplicate by transfer instead', () => {
    expect(
      refundProblem({
        ...base,
        reason: 'duplicate_payment',
        doublePaid: true,
        method: 'manual_transfer',
      }),
    ).toBeNull();
  });

  it('refuses an unknown method', () => {
    expect(refundProblem({ ...base, method: 'cash' })).toMatch(/how the money goes back/);
  });
});
