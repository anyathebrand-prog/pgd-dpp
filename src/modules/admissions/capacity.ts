/**
 * RG-05 — reading a cohort's seats (§5.1 LOCKED).
 *
 * Capacity is enforced at offer issuance, not at payment, so a seat is taken
 * the moment an offer is made: admitted, accepted and enrolled all hold one.
 * That is the same definition `seatsRemaining` uses when it refuses an offer,
 * and it has to be — a capacity screen that counted differently from the
 * check that enforces capacity would show seats the registrar cannot give.
 *
 * A lapsed offer holds nothing. It is listed separately because §5.1 says
 * lapsed offers return their seat, and the registrar should be able to see
 * that it happened.
 */

export const HOLDS_A_SEAT = ['admitted', 'offer_accepted', 'enrolled'] as const;

export type CapacityState = 'healthy' | 'near_capacity' | 'full' | 'over_committed';

export function capacityState(capacity: number, committed: number): CapacityState {
  // Should be impossible: offer issuance refuses the seat past capacity. It
  // is still checked, because if it ever happens the registrar needs to know
  // before somebody who has accepted a place is told there isn't one.
  if (committed > capacity) return 'over_committed';
  if (committed === capacity) return 'full';
  // Nine in ten taken is when to stop offering on autopilot and start
  // choosing.
  if (capacity > 0 && committed / capacity >= 0.9) return 'near_capacity';
  return 'healthy';
}
