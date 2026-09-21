/**
 * CMP-09 — the 72-hour clock.
 *
 * NDPA s.40 counts from awareness. An hour's error here is invisible on
 * screen and decisive on the day it matters.
 */
import { describe, expect, it } from 'vitest';
import { breachClock, formatClock, ndpcDeadline } from '@/modules/compliance/breach-clock';

const discovered = new Date('2026-09-01T09:00:00Z');
const hours = (n: number) => new Date(discovered.getTime() + n * 3_600_000);

describe('the deadline', () => {
  it('is 72 hours after the breach was discovered', () => {
    expect(ndpcDeadline(discovered).toISOString()).toBe('2026-09-04T09:00:00.000Z');
  });
});

describe('where the clock stands', () => {
  it('runs quietly with more than a day left', () => {
    expect(breachClock({ discoveredAt: discovered, ndpcNotifiedAt: null, now: hours(10) })).toMatchObject({
      state: 'running',
      late: false,
    });
  });

  it('turns urgent with a day or less left', () => {
    const clock = breachClock({ discoveredAt: discovered, ndpcNotifiedAt: null, now: hours(50) });
    expect(clock.state).toBe('due_soon');
    expect(clock.hoursLeft).toBe(22);
  });

  it('is overdue at 72 hours exactly, not after', () => {
    expect(breachClock({ discoveredAt: discovered, ndpcNotifiedAt: null, now: hours(72) }).state).toBe(
      'overdue',
    );
    expect(breachClock({ discoveredAt: discovered, ndpcNotifiedAt: null, now: hours(71.99) }).state).toBe(
      'due_soon',
    );
  });

  it('stops when the Commission is notified', () => {
    const clock = breachClock({
      discoveredAt: discovered,
      ndpcNotifiedAt: hours(40),
      now: hours(200),
    });
    expect(clock.state).toBe('notified');
    expect(clock.late).toBe(false);
  });

  it('records a late notification as late rather than just done', () => {
    // Met, but not in time — and the register says so.
    const clock = breachClock({ discoveredAt: discovered, ndpcNotifiedAt: hours(80) });
    expect(clock).toMatchObject({ state: 'notified', late: true });
  });
});

describe('what it says', () => {
  it('reads in hours and minutes', () => {
    expect(formatClock(31.5)).toBe('31h 30m left');
    expect(formatClock(-6.25)).toBe('6h 15m overdue');
  });
});
