/**
 * The grading scheme an institution sets at IA-02.
 *
 * This interprets a result; it never decides one. The pass mark is per
 * assessment and lives on the assessment, and graduation is a decision a
 * registrar makes by hand at /admin/graduation — a platform that inferred a
 * qualification from an average would be awarding a university's degree on
 * its behalf.
 *
 * Kept as plain functions with no database access so the rules can be tested
 * directly, which matters more here than usual: a band table that is subtly
 * wrong misreports every result on the programme, and does it quietly.
 */

export type Band = { minPercent: number; label: string };

export const DEFAULT_BANDS: Band[] = [
  { minPercent: 70, label: 'Distinction' },
  { minPercent: 60, label: 'Merit' },
  { minPercent: 50, label: 'Pass' },
];

/** Highest band first, which is the order every caller wants to render in. */
export function sortBands(bands: Band[]): Band[] {
  return [...bands].sort((a, b) => b.minPercent - a.minPercent);
}

/**
 * The band a percentage falls in, or null when it is below every band.
 *
 * Null is a real answer rather than a missing one: a scheme whose lowest band
 * starts at 50 is saying that 40% has no classification, and inventing a
 * "Fail" band to fill the gap would put a word on a transcript the
 * institution never wrote.
 */
export function bandFor(percent: number, bands: Band[]): Band | null {
  if (!Number.isFinite(percent)) return null;
  for (const band of sortBands(bands)) {
    if (percent >= band.minPercent) return band;
  }
  return null;
}

/**
 * Why a proposed scheme cannot be saved, or null if it can.
 *
 * Two bands sharing a threshold is the case worth naming: it is not a
 * duplicate that can be de-duplicated, it is two different words for the same
 * score, and only the author knows which one they meant.
 */
export function bandsProblem(bands: Band[]): string | null {
  if (bands.length === 0) {
    return 'A grading scheme needs at least one band. Without one, a result is a number and nothing else.';
  }
  if (bands.length > 8) {
    return 'Eight bands is already more than anyone can hold in their head. Use fewer.';
  }

  for (const band of bands) {
    if (!band.label.trim()) {
      return 'Every band needs a name — it is what appears against a student’s result.';
    }
    if (band.label.trim().length > 40) {
      return `“${band.label.trim().slice(0, 20)}…” is too long for a band name. Keep it under 40 characters.`;
    }
    if (!Number.isInteger(band.minPercent) || band.minPercent < 0 || band.minPercent > 100) {
      return `“${band.label.trim()}” needs a whole percentage between 0 and 100 to start at.`;
    }
  }

  const sorted = sortBands(bands);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minPercent === sorted[i - 1].minPercent) {
      return `“${sorted[i - 1].label.trim()}” and “${sorted[i].label.trim()}” both start at ${
        sorted[i].minPercent
      }%. A score cannot be in two bands at once.`;
    }
  }

  const labels = sorted.map((b) => b.label.trim().toLowerCase());
  if (new Set(labels).size !== labels.length) {
    return 'Two bands share a name, which makes a result ambiguous to read.';
  }

  return null;
}
