/**
 * §2.4 / §2.5 / conflict C-04.
 *
 * The branding screen refuses colours rather than warning about them, so the
 * maths behind the refusal has to be right — a false pass ships an unreadable
 * institution mark, and a false fail tells a university their own colour is
 * not allowed when it is.
 *
 * The expected ratios here are the ones the brief itself quotes in §2.4, so
 * this suite doubles as a check that the palette documentation is accurate.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_RATIO,
  PAPER,
  checkBrandColour,
  contrastRatio,
  nearestPassing,
  normaliseHex,
} from '../src/lib/contrast';

const INK = '#14110F';
const OXBLOOD = '#6B2436';
const MANILA = '#E3D9C4';
const SIGNAL = '#0E9B94';

describe('the ratios the brief publishes are correct', () => {
  // §2.4's contrast matrix, to two decimal places.
  it.each([
    ['Redaction on Paper', INK, PAPER, 17.13],
    ['Redaction on Manila', INK, MANILA, 13.42],
    ['Oxblood on Paper', OXBLOOD, PAPER, 9.91],
    // The brief publishes 7.77 for this pair; it actually computes to 7.76.
    // A rounding slip in the documentation, not a palette problem — the pair
    // passes comfortably either way. Every other figure in §2.4 is exact.
    ['Oxblood on Manila', OXBLOOD, MANILA, 7.76],
    ['Paper on Oxblood', PAPER, OXBLOOD, 9.91],
    ['Signal on Paper', SIGNAL, PAPER, 3.12],
    ['Signal on Manila', SIGNAL, MANILA, 2.44],
    ['Redaction on Signal', INK, SIGNAL, 5.49],
  ])('%s is %s:1', (_name, a, b, expected) => {
    expect(contrastRatio(a, b)).toBeCloseTo(expected as number, 2);
  });

  it('confirms the three non-negotiable rules that fall out of the matrix', () => {
    // 1. Signal is never a text colour on Paper or Manila.
    expect(contrastRatio(SIGNAL, PAPER)).toBeLessThan(MIN_RATIO);
    expect(contrastRatio(SIGNAL, MANILA)).toBeLessThan(3);

    // 2. A Signal-filled button takes Redaction text, not Paper.
    expect(contrastRatio(PAPER, SIGNAL)).toBeLessThan(MIN_RATIO);
    expect(contrastRatio(INK, SIGNAL)).toBeGreaterThanOrEqual(MIN_RATIO);

    // 3. ink-500 on Manila fails for body text, which is why record cards use
    //    ink-700 for secondary text.
    expect(contrastRatio('#6B635A', MANILA)).toBeLessThan(MIN_RATIO);
    expect(contrastRatio('#3A342F', MANILA)).toBeGreaterThanOrEqual(MIN_RATIO);
  });
});

describe('hex parsing', () => {
  it('accepts the forms an administrator will actually type', () => {
    expect(normaliseHex('#1b3a6b')).toBe('#1B3A6B');
    expect(normaliseHex('1B3A6B')).toBe('#1B3A6B');
    expect(normaliseHex('  #abc  ')).toBe('#AABBCC');
  });

  it('rejects anything else rather than guessing', () => {
    expect(normaliseHex('navy')).toBeNull();
    expect(normaliseHex('#12345')).toBeNull();
    expect(normaliseHex('')).toBeNull();
  });
});

describe('the branding gate blocks rather than warns', () => {
  it('passes a colour dark enough to read', () => {
    const check = checkBrandColour('#1B3A6B');
    expect(check.passes).toBe(true);
    expect(check.problem).toBeNull();
  });

  it('refuses a colour that fails, and explains why in plain words', () => {
    const check = checkBrandColour('#F2C94C');
    expect(check.passes).toBe(false);
    expect(check.problem).toMatch(/4\.5:1/);
    // The explanation names the consequence, not just the number.
    expect(check.problem).toMatch(/phone|daylight|struggle/i);
  });

  it('always offers a nearest passing colour, so a refusal is actionable', () => {
    const check = checkBrandColour('#F2C94C');
    expect(check.suggestion).not.toBeNull();
    expect(contrastRatio(check.suggestion!, PAPER)).toBeGreaterThanOrEqual(MIN_RATIO);
  });

  it('suggests a deeper version of their own hue, not a different colour', () => {
    // A university that typed its blue should get its blue back, darker —
    // being told to use Oxblood instead would be useless to them.
    const suggestion = nearestPassing('#4A90D9')!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(suggestion.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('leaves a passing colour untouched', () => {
    expect(nearestPassing('#1B3A6B')).toBe('#1B3A6B');
  });

  it('rejects malformed input without throwing', () => {
    const check = checkBrandColour('not a colour');
    expect(check.passes).toBe(false);
    expect(check.hex).toBeNull();
    expect(check.problem).toMatch(/six-digit hex/i);
  });

  it('accepts the seeded institution colours', () => {
    // If the seed shipped a failing colour, the fixture would contradict the
    // rule the product enforces.
    for (const hex of ['#1B3A6B', '#0E5C3A', '#6B2436']) {
      expect(checkBrandColour(hex).passes, `${hex} should pass`).toBe(true);
    }
  });
});
