/**
 * PAY-09 — the arithmetic and the gate.
 *
 * A split that loses a kobo short-changes the institution on every plan, and
 * a gate reading the wrong date locks a student out of lessons they paid for.
 */
import { describe, expect, it } from 'vitest';
import { gateState, installmentDueDates, splitInstallments } from '@/modules/payments/installments';

describe('splitting tuition', () => {
  it('sums to the exact total, to the kobo', () => {
    for (const total of [51_500_000, 51_500_001, 51_500_002, 99_999_999, 3]) {
      for (const parts of [1, 2, 3]) {
        const split = splitInstallments(total, parts);
        expect(split.reduce((a, b) => a + b, 0)).toBe(total);
        expect(split).toHaveLength(parts);
        expect(split.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
      }
    }
  });

  it('puts the remainder on the first part', () => {
    // ₦515,000.01 in three: the extra kobo is paid now, and the later parts
    // stay round.
    expect(splitInstallments(51_500_001, 3)).toEqual([17_166_667, 17_166_667, 17_166_667]);
    expect(splitInstallments(10, 3)).toEqual([4, 3, 3]);
  });

  it('refuses more parts than a plan allows, or none', () => {
    expect(() => splitInstallments(1000, 4)).toThrow();
    expect(() => splitInstallments(1000, 0)).toThrow();
  });

  it('refuses a non-integer or non-positive total', () => {
    expect(() => splitInstallments(10.5, 2)).toThrow();
    expect(() => splitInstallments(0, 2)).toThrow();
  });
});

describe('the schedule', () => {
  it('makes the first part due now and each later one an interval after', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const dates = installmentDueDates(3, start, 60).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-10-01', '2026-11-30', '2027-01-29']);
  });
});

describe('the gate on the second part', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const day = 86_400_000;

  it('does not gate while every unpaid part is still in the future', () => {
    const state = gateState(
      [
        { status: 'success', dueAt: new Date(now.getTime() - 60 * day), installmentNumber: 1 },
        { status: 'scheduled', dueAt: new Date(now.getTime() + 30 * day), installmentNumber: 2 },
      ],
      now,
    );
    expect(state).toMatchObject({ gated: false, dueSoon: false });
  });

  it('warns a week ahead rather than gating', () => {
    const state = gateState(
      [{ status: 'scheduled', dueAt: new Date(now.getTime() + 3 * day), installmentNumber: 2 }],
      now,
    );
    expect(state).toMatchObject({ gated: false, dueSoon: true });
  });

  it('gates once a part is past due and unpaid', () => {
    const state = gateState(
      [{ status: 'scheduled', dueAt: new Date(now.getTime() - day), installmentNumber: 2 }],
      now,
    );
    expect(state.gated).toBe(true);
    expect(state.next?.installmentNumber).toBe(2);
  });

  it('lifts the gate the moment that part is paid', () => {
    const state = gateState(
      [{ status: 'success', dueAt: new Date(now.getTime() - day), installmentNumber: 2 }],
      now,
    );
    expect(state.gated).toBe(false);
  });

  it('points at the earliest unpaid part, whatever order they arrive in', () => {
    const state = gateState(
      [
        { status: 'scheduled', dueAt: new Date(now.getTime() + 60 * day), installmentNumber: 3 },
        { status: 'pending', dueAt: new Date(now.getTime() - day), installmentNumber: 2 },
      ],
      now,
    );
    expect(state.next?.installmentNumber).toBe(2);
    expect(state.gated).toBe(true);
  });

  it('never gates a student with no plan at all', () => {
    expect(gateState([], now)).toMatchObject({ gated: false, next: null });
  });
});
