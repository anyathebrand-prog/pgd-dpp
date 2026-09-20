import 'server-only';

/**
 * LB-03 — turning an extracted text layer into pages (LIB-03).
 *
 * Pure, and separated from the page for one reason: every highlight a reader
 * saves is anchored to a character offset into the whole document, so if this
 * function ever disagrees with itself between two renders, existing highlights
 * land on the wrong sentence. That is not a failure anyone would notice
 * immediately, and it is exactly the kind of thing a unit test pins down.
 *
 * Pages break on a paragraph boundary where there is one within reach, and
 * mid-paragraph only when a single paragraph is longer than a page — a
 * judgment with a three-page recital of facts is a real document, not an edge
 * case.
 */

export type Page = {
  /** 1-based, because it is shown to a reader. */
  number: number;
  /** Character offset of this page's first character in the whole text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  text: string;
};

export const CHARS_PER_PAGE = 3000;
/** How far back a break may search for a paragraph end before giving up. */
const LOOKBACK = 800;

export function paginate(fullText: string, perPage = CHARS_PER_PAGE): Page[] {
  const text = fullText ?? '';
  if (text.length === 0) return [];

  const pages: Page[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + perPage, text.length);

    if (end < text.length) {
      // Prefer a paragraph break, then a sentence end, then wherever we are.
      const window = text.slice(Math.max(start, end - LOOKBACK), end);
      const paragraph = window.lastIndexOf('\n\n');
      const sentence = window.search(/\.\s[^.]*$/);

      if (paragraph > 0) {
        end = Math.max(start, end - LOOKBACK) + paragraph + 2;
      } else if (sentence > 0) {
        end = Math.max(start, end - LOOKBACK) + sentence + 2;
      }
    }

    // Defensive: a break that did not move forward would loop forever.
    if (end <= start) end = Math.min(start + perPage, text.length);

    pages.push({
      number: pages.length + 1,
      start,
      end,
      text: text.slice(start, end),
    });
    start = end;
  }

  return pages;
}

/** Which page an offset falls on — how a saved highlight is found again. */
export function pageForOffset(pages: Page[], offset: number): number {
  const page = pages.find((p) => offset >= p.start && offset < p.end);
  return page?.number ?? 1;
}

/**
 * The highlights that fall on one page, clipped to it.
 *
 * A highlight that spans a page break is real — somebody selected across one —
 * so it is rendered on both pages rather than dropped from whichever page it
 * did not start on.
 */
export function highlightsOnPage<T extends { startOffset: number; endOffset: number }>(
  notes: T[],
  page: Page,
): (T & { from: number; to: number })[] {
  return notes
    .filter((n) => n.endOffset > page.start && n.startOffset < page.end)
    .map((n) => ({
      ...n,
      from: Math.max(n.startOffset - page.start, 0),
      to: Math.min(n.endOffset - page.start, page.text.length),
    }))
    .filter((n) => n.to > n.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * The page text split into runs, each flagged as highlighted or not.
 *
 * Overlapping highlights are merged rather than nested: two readers' worth of
 * marks on the same sentence is one mark on that sentence, and nesting would
 * produce broken markup for no gain.
 */
export function runs(
  page: Page,
  marks: { from: number; to: number }[],
): { text: string; marked: boolean }[] {
  if (marks.length === 0) return [{ text: page.text, marked: false }];

  const merged: { from: number; to: number }[] = [];
  for (const mark of [...marks].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && mark.from <= last.to) last.to = Math.max(last.to, mark.to);
    else merged.push({ ...mark });
  }

  const out: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const mark of merged) {
    if (mark.from > cursor) out.push({ text: page.text.slice(cursor, mark.from), marked: false });
    out.push({ text: page.text.slice(mark.from, mark.to), marked: true });
    cursor = mark.to;
  }
  if (cursor < page.text.length) out.push({ text: page.text.slice(cursor), marked: false });
  return out;
}
