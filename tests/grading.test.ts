/**
 * IA-02 — the grading scheme.
 *
 * A unit test rather than an E2E one, for the same reason as citations: this
 * is pure, and it decides what word appears against every result on the
 * programme. A boundary that is off by one is invisible on screen and wrong
 * on a transcript.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, bandFor, bandsProblem, sortBands } from '@/lib/grading';

describe('reading a percentage through the bands', () => {
  it('puts a score in the highest band it reaches', () => {
    expect(bandFor(85, DEFAULT_BANDS)?.label).toBe('Distinction');
    expect(bandFor(64, DEFAULT_BANDS)?.label).toBe('Merit');
    expect(bandFor(51, DEFAULT_BANDS)?.label).toBe('Pass');
  });

  it('treats the threshold as inside the band it names', () => {
    // 70 is a Distinction, not the top of Merit. This is the assertion the
    // whole file exists for.
    expect(bandFor(70, DEFAULT_BANDS)?.label).toBe('Distinction');
    expect(bandFor(69.9, DEFAULT_BANDS)?.label).toBe('Merit');
    expect(bandFor(60, DEFAULT_BANDS)?.label).toBe('Merit');
    expect(bandFor(50, DEFAULT_BANDS)?.label).toBe('Pass');
  });

  it('returns nothing below the lowest band rather than inventing a word', () => {
    // A scheme that starts at 50 is saying 49 has no classification. Filling
    // that in with "Fail" would put a word on a transcript the institution
    // never wrote.
    expect(bandFor(49, DEFAULT_BANDS)).toBeNull();
    expect(bandFor(0, DEFAULT_BANDS)).toBeNull();
  });

  it('reads bands in whatever order they were stored', () => {
    const jumbled = [
      { minPercent: 50, label: 'Pass' },
      { minPercent: 70, label: 'Distinction' },
      { minPercent: 60, label: 'Merit' },
    ];
    expect(bandFor(72, jumbled)?.label).toBe('Distinction');
    expect(sortBands(jumbled).map((b) => b.label)).toEqual(['Distinction', 'Merit', 'Pass']);
  });

  it('survives a band starting at zero, which catches everything', () => {
    const withFloor = [...DEFAULT_BANDS, { minPercent: 0, label: 'Fail' }];
    expect(bandFor(12, withFloor)?.label).toBe('Fail');
    expect(bandFor(0, withFloor)?.label).toBe('Fail');
  });

  it('answers nothing for a score that is not a number', () => {
    expect(bandFor(Number.NaN, DEFAULT_BANDS)).toBeNull();
  });
});

describe('what cannot be saved as a scheme', () => {
  it('accepts the default', () => {
    expect(bandsProblem(DEFAULT_BANDS)).toBeNull();
  });

  it('refuses an empty scheme', () => {
    expect(bandsProblem([])).toMatch(/at least one band/);
  });

  it('refuses two bands starting at the same mark', () => {
    const problem = bandsProblem([
      { minPercent: 60, label: 'Merit' },
      { minPercent: 60, label: 'Credit' },
    ]);
    // Named rather than silently de-duplicated: only the author knows which
    // of the two words they meant.
    expect(problem).toMatch(/both start at 60%/);
  });

  it('refuses two bands with the same name', () => {
    expect(
      bandsProblem([
        { minPercent: 70, label: 'Pass' },
        { minPercent: 50, label: 'pass' },
      ]),
    ).toMatch(/share a name/);
  });

  it('refuses a nameless band', () => {
    expect(bandsProblem([{ minPercent: 50, label: '   ' }])).toMatch(/needs a name/);
  });

  it('refuses a mark outside 0 to 100, or a fractional one', () => {
    expect(bandsProblem([{ minPercent: 120, label: 'Distinction' }])).toMatch(/between 0 and 100/);
    expect(bandsProblem([{ minPercent: -1, label: 'Distinction' }])).toMatch(/between 0 and 100/);
    expect(bandsProblem([{ minPercent: 62.5, label: 'Merit' }])).toMatch(/whole percentage/);
  });

  it('refuses more bands than anyone can hold in their head', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      minPercent: i * 10,
      label: `Band ${i}`,
    }));
    expect(bandsProblem(many)).toMatch(/Eight bands/);
  });
});
