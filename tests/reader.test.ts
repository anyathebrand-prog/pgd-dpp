/**
 * LB-03 — pagination and highlight placement (LIB-03).
 *
 * Worth pinning down precisely: every highlight is anchored to an offset into
 * the whole document, so pagination that disagreed with itself between two
 * renders would move existing highlights onto the wrong sentence. Nobody
 * would notice that immediately, which is what makes it worth a test rather
 * than a click-through.
 */
import { describe, expect, it } from 'vitest';
import { highlightsOnPage, pageForOffset, paginate, runs } from '@/modules/library/reader';

const paragraphs = (count: number, size = 400) =>
  Array.from({ length: count }, (_, i) => `${`P${i} `.repeat(size / 3)}`.trim()).join('\n\n');

describe('paginating an extracted text layer', () => {
  it('returns nothing for an empty text layer', () => {
    // The scanned-judgment case: the reader shows the degraded state instead.
    expect(paginate('')).toEqual([]);
  });

  it('keeps short text on one page', () => {
    const pages = paginate('A short note.', 3000);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ number: 1, start: 0, end: 13 });
  });

  it('covers the whole text exactly once, with no gaps or overlaps', () => {
    const text = paragraphs(40);
    const pages = paginate(text, 1000);

    // The property that matters: offsets reassemble the original exactly.
    expect(pages.map((p) => p.text).join('')).toBe(text);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].start).toBe(pages[i - 1].end);
    }
    expect(pages[0].start).toBe(0);
    expect(pages[pages.length - 1].end).toBe(text.length);
  });

  it('is stable — the same text paginates identically every time', () => {
    const text = paragraphs(25);
    expect(paginate(text, 900)).toEqual(paginate(text, 900));
  });

  it('breaks on a paragraph boundary when one is within reach', () => {
    const text = `${'a'.repeat(700)}\n\n${'b'.repeat(2000)}`;
    const [first] = paginate(text, 1000);
    // Not at 1000, in the middle of the second paragraph.
    expect(first.text.endsWith('\n\n')).toBe(true);
    expect(first.end).toBe(702);
  });

  it('splits a single paragraph longer than a page rather than looping', () => {
    // A judgment with a three-page recital of facts is a real document.
    const text = 'x'.repeat(5000);
    const pages = paginate(text, 1000);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => p.text).join('')).toBe(text);
  });

  it('finds the page an offset falls on', () => {
    const pages = paginate(paragraphs(30), 1000);
    const target = pages[3];
    expect(pageForOffset(pages, target.start)).toBe(target.number);
    expect(pageForOffset(pages, target.end - 1)).toBe(target.number);
  });
});

describe('placing highlights on a page', () => {
  const page = { number: 2, start: 100, end: 200, text: 'y'.repeat(100) };

  it('clips a highlight to the page it is shown on', () => {
    const [mark] = highlightsOnPage([{ startOffset: 120, endOffset: 140 }], page);
    expect(mark).toMatchObject({ from: 20, to: 40 });
  });

  it('shows a highlight that spans a page break on both pages', () => {
    // Somebody really did select across the break; dropping it from one side
    // would make half of their own highlight disappear.
    const spanning = [{ startOffset: 90, endOffset: 150 }];
    const [onThis] = highlightsOnPage(spanning, page);
    expect(onThis).toMatchObject({ from: 0, to: 50 });

    const previous = { number: 1, start: 0, end: 100, text: 'x'.repeat(100) };
    const [onPrevious] = highlightsOnPage(spanning, previous);
    expect(onPrevious).toMatchObject({ from: 90, to: 100 });
  });

  it('ignores highlights from other pages entirely', () => {
    expect(highlightsOnPage([{ startOffset: 10, endOffset: 20 }], page)).toHaveLength(0);
  });
});

describe('splitting a page into marked and unmarked runs', () => {
  const page = { number: 1, start: 0, end: 26, text: 'abcdefghijklmnopqrstuvwxyz' };

  it('returns one unmarked run when nothing is highlighted', () => {
    expect(runs(page, [])).toEqual([{ text: page.text, marked: false }]);
  });

  it('marks the highlighted stretch and nothing else', () => {
    expect(runs(page, [{ from: 2, to: 5 }])).toEqual([
      { text: 'ab', marked: false },
      { text: 'cde', marked: true },
      { text: 'fghijklmnopqrstuvwxyz', marked: false },
    ]);
  });

  it('merges overlapping highlights instead of nesting them', () => {
    // Two marks on the same sentence is one mark on that sentence.
    expect(runs(page, [{ from: 2, to: 8 }, { from: 5, to: 12 }])).toEqual([
      { text: 'ab', marked: false },
      { text: 'cdefghijkl', marked: true },
      { text: 'mnopqrstuvwxyz', marked: false },
    ]);
  });

  it('reassembles the page text exactly, however the marks fall', () => {
    const out = runs(page, [{ from: 0, to: 3 }, { from: 10, to: 26 }]);
    expect(out.map((r) => r.text).join('')).toBe(page.text);
  });
});
