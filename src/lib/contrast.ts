/**
 * WCAG 2.1 contrast, used to enforce §2.5 / conflict C-04.
 *
 * IA-06 lets an institution admin set a brand colour. Unconstrained that
 * breaks every contrast guarantee in §2.4, so the branding screen validates
 * and **blocks** rather than warning — and a block is only fair if it comes
 * with a nearest-passing suggestion, which is what `nearestPassing` is for.
 *
 * No dependency: this is the WCAG relative-luminance formula, which is a
 * dozen lines and does not change.
 */

/** Paper, the substrate the tenant brand is always seen against. */
export const PAPER = '#F7F4EE';
export const MIN_RATIO = 4.5;

export function normaliseHex(input: string): string | null {
  const v = input.trim().replace(/^#/, '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return `#${full.toUpperCase()}`;
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string) {
  const h = normaliseHex(hex);
  if (!h) return 0;
  const r = channel(parseInt(h.slice(1, 3), 16));
  const g = channel(parseInt(h.slice(3, 5), 16));
  const b = channel(parseInt(h.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded the way the brief quotes ratios, so the UI matches §2.4. */
export function ratioText(a: string, b: string) {
  return `${contrastRatio(a, b).toFixed(2)}:1`;
}

function toRgb(hex: string) {
  const h = normaliseHex(hex)!;
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ] as const;
}

function toHex([r, g, b]: readonly number[]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * The closest colour to the one they chose that passes against Paper.
 *
 * It darkens along the original hue rather than snapping to a palette colour:
 * an administrator who typed their university's blue should get their blue,
 * slightly deeper — not Oxblood, and not a colour they will not recognise.
 * Returns null only if even black fails, which cannot happen against Paper.
 */
export function nearestPassing(hex: string, against = PAPER): string | null {
  const start = normaliseHex(hex);
  if (!start) return null;
  if (contrastRatio(start, against) >= MIN_RATIO) return start;

  const [r, g, b] = toRgb(start);
  // 100 steps toward black is finer than the eye resolves, and cheap.
  for (let step = 1; step <= 100; step++) {
    const factor = 1 - step / 100;
    const candidate = toHex([r * factor, g * factor, b * factor]);
    if (contrastRatio(candidate, against) >= MIN_RATIO) return candidate;
  }
  return '#000000';
}

export type BrandCheck = {
  hex: string | null;
  ratio: number;
  passes: boolean;
  suggestion: string | null;
  problem: string | null;
};

export function checkBrandColour(input: string): BrandCheck {
  const hex = normaliseHex(input);
  if (!hex) {
    return {
      hex: null,
      ratio: 0,
      passes: false,
      suggestion: null,
      problem: 'Enter a six-digit hex colour, for example #1B3A6B.',
    };
  }

  const ratio = contrastRatio(hex, PAPER);
  if (ratio >= MIN_RATIO) {
    return { hex, ratio, passes: true, suggestion: null, problem: null };
  }

  const suggestion = nearestPassing(hex);
  return {
    hex,
    ratio,
    passes: false,
    suggestion,
    problem:
      `${hex} reaches ${ratio.toFixed(2)}:1 against the page background, and text needs 4.5:1. ` +
      `Anyone reading your institution name at a glance, on a phone, in daylight, would struggle with it.`,
  };
}

/** The navy page surface of the 2026 redesign (brief §0). */
export const SURFACE = '#08163C';
/** WCAG 1.4.11: a graphic that is not text needs 3:1 against what is behind it. */
export const MIN_GRAPHIC_RATIO = 3;

/**
 * A university's brand colour as it is drawn on the navy surface.
 *
 * Brand colours are validated against Paper (§2.5), so they are dark by
 * construction, and a dark oxblood or green all but disappears on navy
 * (brief §0.3). This lifts the colour toward white, along its own hue,
 * just far enough to reach 3:1: UNILAG stays recognisably oxblood, a lighter
 * oxblood. The stored brand colour is never changed; this is how it is
 * shown, not what it is.
 */
export function brandOnSurface(hex: string, against = SURFACE): string {
  const start = normaliseHex(hex);
  if (!start) return '#F8F8F8';
  if (contrastRatio(start, against) >= MIN_GRAPHIC_RATIO) return start;
  const [r, g, b] = toRgb(start);
  for (let step = 1; step <= 100; step++) {
    const t = step / 100;
    const candidate = toHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
    if (contrastRatio(candidate, against) >= MIN_GRAPHIC_RATIO) return candidate;
  }
  return '#FFFFFF';
}
