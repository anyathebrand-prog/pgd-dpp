import 'server-only';

/**
 * CMP-09 — the 72-hour clock (NDPA s.40).
 *
 * The Commission must be notified within 72 hours of the controller becoming
 * aware of a breach. "Becoming aware" is `discovered_at`, not the moment the
 * breach happened and not the moment somebody logged it here — a register
 * that started the clock at logging time would quietly grant itself however
 * long it took someone to open this screen.
 *
 * Pure, because a clock that is off by an hour is the kind of error nobody
 * sees until the day it matters.
 */

export const NDPC_WINDOW_HOURS = 72;

export type ClockState = 'notified' | 'overdue' | 'due_soon' | 'running';

export function ndpcDeadline(discoveredAt: Date) {
  return new Date(discoveredAt.getTime() + NDPC_WINDOW_HOURS * 3_600_000);
}

/**
 * Where the clock stands. Notification stops it: once the Commission has been
 * told, the obligation is met, however late it was — and a late notification
 * is recorded as late rather than disappearing into "done".
 */
export function breachClock(input: {
  discoveredAt: Date;
  ndpcNotifiedAt: Date | null;
  now?: Date;
}): { state: ClockState; hoursLeft: number; late: boolean } {
  const now = input.now ?? new Date();
  const deadline = ndpcDeadline(input.discoveredAt);

  if (input.ndpcNotifiedAt) {
    return {
      state: 'notified',
      hoursLeft: 0,
      late: input.ndpcNotifiedAt.getTime() > deadline.getTime(),
    };
  }

  const hoursLeft = (deadline.getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft <= 0) return { state: 'overdue', hoursLeft, late: true };
  // A day out is when it stops being something to schedule and becomes the
  // thing to do today.
  if (hoursLeft <= 24) return { state: 'due_soon', hoursLeft, late: false };
  return { state: 'running', hoursLeft, late: false };
}

/** "31h 20m left" / "6h 5m overdue" — hours, because 72 is counted in hours. */
export function formatClock(hoursLeft: number) {
  const abs = Math.abs(hoursLeft);
  const h = Math.floor(abs);
  const m = Math.floor((abs - h) * 60);
  return hoursLeft >= 0 ? `${h}h ${m}m left` : `${h}h ${m}m overdue`;
}
