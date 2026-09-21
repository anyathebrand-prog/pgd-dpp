/**
 * PAY-09 — tuition in two or three parts, with access gated on the second.
 *
 * Pure, because it is money arithmetic and a schedule, and both fail
 * silently: a split that loses a kobo to rounding leaves the institution
 * short on every plan, and a gate that reads the wrong date locks a student
 * out of lessons they have paid for.
 */

export const MAX_INSTALLMENTS = 3;

/**
 * Integer kobo, summing exactly to the total. The remainder goes on the
 * first part: the student is paying it now anyway, and it keeps every later
 * part a round, predictable figure.
 */
export function splitInstallments(totalKobo: number, parts: number): number[] {
  if (!Number.isInteger(totalKobo) || totalKobo <= 0) throw new Error('total must be positive kobo');
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_INSTALLMENTS) {
    throw new Error(`parts must be 1 to ${MAX_INSTALLMENTS}`);
  }
  const base = Math.floor(totalKobo / parts);
  const remainder = totalKobo - base * parts;
  return Array.from({ length: parts }, (_, i) => (i === 0 ? base + remainder : base));
}

/**
 * When each part falls due. The first is due now — it is what enrols the
 * student — and each later one an interval after the one before.
 */
export function installmentDueDates(parts: number, start: Date, intervalDays: number): Date[] {
  return Array.from(
    { length: parts },
    (_, i) => new Date(start.getTime() + i * intervalDays * 86_400_000),
  );
}

/**
 * Whether a student's learning is gated: some later part is past due and
 * unpaid. Only a *past* due date gates. A part due tomorrow is not a reason
 * to lock anybody out today, and the page warns before it gates.
 */
export function gateState<
  T extends { status: string; dueAt: Date | null; installmentNumber: number | null },
>(parts: T[], now = new Date()): { gated: boolean; dueSoon: boolean; next: T | null } {
  const unpaid = parts
    .filter((p) => p.status !== 'success' && p.dueAt)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());

  const next = unpaid[0] ?? null;
  if (!next) return { gated: false, dueSoon: false, next: null };

  const msLeft = next.dueAt!.getTime() - now.getTime();
  return {
    gated: msLeft < 0,
    // A week's notice, because a sponsor paying by transfer needs that long.
    dueSoon: msLeft >= 0 && msLeft <= 7 * 86_400_000,
    next,
  };
}
