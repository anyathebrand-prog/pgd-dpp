'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A heading typed, held, erased and typed again: "Apply. Study. Qualify."
 * on PB-01 and "Where you can study" on PB-02, and nowhere else.
 *
 * §9 bans decorative loops; the headings this is used for are the recorded
 * exceptions (brief §0.4), and each carries the safeguards that make the
 * exception acceptable:
 *
 *  - it stops. WCAG 2.2.2: anything moving for more than five seconds needs
 *    a pause control, so there is one, and it is a real button.
 *  - it never starts under prefers-reduced-motion. The full heading stands.
 *  - a screen reader hears the heading once, as text. The typed copy is
 *    aria-hidden, so nothing is announced letter by letter.
 *  - nothing moves around it. The full text is laid out invisibly in the
 *    same grid cell, so the heading's size never changes mid-word.
 *
 * The caret is solid rather than blinking: the typing already says
 * "something is happening", and a blink would be a second loop.
 */

const TYPE_MS = 75;
const ERASE_MS = 35;
const HOLD_FULL_MS = 2600;
const HOLD_EMPTY_MS = 450;

export function TypingHeading({
  text,
  className,
  as: Tag = 'h2',
}: {
  text: string;
  className?: string;
  /** The heading level it replaces: a page's h1, or a section's h2. */
  as?: 'h1' | 'h2';
}) {
  const [shown, setShown] = useState(text.length);
  const [playing, setPlaying] = useState(false);
  const phase = useRef<'typing' | 'holding' | 'erasing' | 'waiting'>('holding');

  // Start only once we know motion is welcome; until then the full heading
  // is what renders, on the server and for anyone who never runs this.
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let delay: number;
    if (phase.current === 'typing') delay = TYPE_MS;
    else if (phase.current === 'erasing') delay = ERASE_MS;
    else if (phase.current === 'holding') delay = HOLD_FULL_MS;
    else delay = HOLD_EMPTY_MS;

    const id = window.setTimeout(() => {
      if (phase.current === 'holding') {
        phase.current = 'erasing';
        setShown((n) => n - 1);
      } else if (phase.current === 'erasing') {
        if (shown <= 1) {
          phase.current = 'waiting';
          setShown(0);
        } else setShown((n) => n - 1);
      } else if (phase.current === 'waiting') {
        phase.current = 'typing';
        setShown(1);
      } else {
        if (shown >= text.length - 1) {
          phase.current = 'holding';
          setShown(text.length);
        } else setShown((n) => n + 1);
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [playing, shown, text.length]);

  function toggle() {
    setPlaying((p) => {
      // Pausing shows the whole heading, not a half-typed word.
      if (p) {
        phase.current = 'holding';
        setShown(text.length);
      }
      return !p;
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <Tag className={className}>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true" className="grid">
          {/* Reserves the full heading's space. Not positioned, so Safari
              still paints the gradient into it. */}
          <span className="invisible [grid-area:1/1]">{text}</span>
          <span className="[grid-area:1/1]">
            {text.slice(0, shown)}
            {playing ? (
              <span className="ml-[0.04em] inline-block h-[0.85em] w-[0.06em] translate-y-[0.08em] bg-accent align-baseline" />
            ) : null}
          </span>
        </span>
      </Tag>
      <button
        type="button"
        onClick={toggle}
        className="hairline motion-state mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-ink-900/10 hover:text-ink-900"
      >
        <span aria-hidden="true" className="text-xs">
          {playing ? '❙❙' : '▶'}
        </span>
        <span className="sr-only">
          {playing ? 'Stop the typing headline' : 'Resume the typing headline'}
        </span>
      </button>
    </div>
  );
}
