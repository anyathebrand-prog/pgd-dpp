'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A row of cards that slides: one per view on a phone, two from `md` up.
 *
 * It is a native horizontal scroll with snap points, so a swipe, a trackpad
 * and the arrow keys all work without JavaScript, and the buttons only add a
 * way to step by one card. It never moves by itself (§9: no auto-advancing
 * carousel), and under prefers-reduced-motion a step jumps instead of
 * gliding.
 *
 * The children are the `li` cards; this sizes and snaps them. The counter
 * says which cards are in view, so nobody has to discover by accident that
 * there are more to the right.
 */
export function CardSlider({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ first: 1, last: 1, total: 0, atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const cards = [...el.children] as HTMLElement[];
    if (cards.length === 0) return;
    const step = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : el.clientWidth;
    const perView = Math.max(1, Math.round(el.clientWidth / step));
    const first = Math.min(cards.length, Math.round(el.scrollLeft / step) + 1);
    setView({
      first,
      last: Math.min(cards.length, first + perView - 1),
      total: cards.length,
      atStart: el.scrollLeft <= 2,
      atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    el?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  function stepBy(direction: 1 | -1) {
    const el = track.current;
    if (!el) return;
    const cards = [...el.children] as HTMLElement[];
    const step = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : el.clientWidth;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  const fits = view.total > 0 && view.atStart && view.atEnd;

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label}>
      {fits ? null : (
        <div className="mb-5 flex items-center justify-end gap-3">
          <p className="t-body-sm m-0 mr-auto text-ink-700" aria-live="polite">
            {view.total > 0
              ? `Showing ${view.first}${view.last > view.first ? `–${view.last}` : ''} of ${view.total}`
              : null}
          </p>
          <button
            type="button"
            onClick={() => stepBy(-1)}
            disabled={view.atStart}
            className="hairline motion-state inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-900 hover:bg-ink-900/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only">Previous</span>
          </button>
          <button
            type="button"
            onClick={() => stepBy(1)}
            disabled={view.atEnd}
            className="hairline motion-state inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-900 hover:bg-ink-900/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden="true">→</span>
            <span className="sr-only">Next</span>
          </button>
        </div>
      )}
      <ul
        ref={track}
        tabIndex={0}
        aria-label={`${label}: scroll sideways, or use the arrow keys`}
        className={[
          'm-0 flex list-none snap-x snap-mandatory gap-5 overflow-x-auto p-0 pb-1',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          '[&>li]:w-[88%] [&>li]:shrink-0 [&>li]:snap-start md:[&>li]:w-[calc(50%-0.625rem)]',
          'rounded-lg focus-visible:outline-offset-4',
        ].join(' ')}
      >
        {children}
      </ul>
    </div>
  );
}
