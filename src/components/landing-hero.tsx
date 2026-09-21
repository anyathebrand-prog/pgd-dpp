'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/**
 * The rotating claim under the PB-01 headline, set as a glass "claim bar".
 *
 * Three things are true about this programme and no one of them is the whole
 * pitch, so the line cycles. Each claim marks one phrase with *asterisks*;
 * that phrase is set in the accent blue, so the eye lands on it first.
 *
 * Four rules keep the rotation from being a nuisance:
 *
 *  - it stops. A visible pause control, because WCAG 2.2.2 applies to any
 *    moving content that runs for more than five seconds and a marketing
 *    carousel is exactly the case the criterion was written for.
 *  - it never starts under prefers-reduced-motion. The first claim stands.
 *  - it pauses while the pointer is over it or focus is inside it, so it
 *    cannot slide out from under someone mid-sentence.
 *  - a screen reader gets all three claims, once, as a plain list. The
 *    rotating copy is aria-hidden, so nothing is announced on a timer and
 *    nothing is lost.
 *
 * The bar has a fixed height, so a claim that wraps to two lines never moves
 * the buttons beneath it. The three markers say which claim is showing and
 * let anyone jump to another.
 */

/** "Taught as the Act is *enforced*" -> the parts, with the marked one flagged. */
function parts(claim: string) {
  return claim.split(/(\*[^*]+\*)/).filter(Boolean).map((part) =>
    part.startsWith('*') && part.endsWith('*')
      ? { text: part.slice(1, -1), accent: true }
      : { text: part, accent: false },
  );
}

const plain = (claim: string) => claim.replace(/\*/g, '');

export function RotatingClaim({ claims }: { claims: string[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) setPlaying(false);
  }, []);

  // `index` is a dependency so that choosing a claim restarts its full five
  // seconds rather than cutting it short.
  useEffect(() => {
    if (!playing || held || reduced.current) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % claims.length), 5000);
    return () => clearInterval(id);
  }, [playing, held, claims.length, index]);

  return (
    <div
      className="hairline mt-8 flex min-h-[5.5rem] max-w-[31rem] items-center gap-4 rounded-lg bg-surface/80 py-3 pr-3 pl-5 backdrop-blur-md"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-verified-fill" aria-hidden="true" />

      <p
        // `key` forces the crossfade to replay. Without it React updates the
        // text in place and the change is a flicker with no cause.
        key={index}
        className="motion-claim m-0 flex-1 text-[1.0625rem] leading-snug font-semibold text-ink-900 md:text-lg"
        aria-hidden="true"
      >
        {parts(claims[index]).map((part, i) =>
          part.accent ? (
            <span key={i} className="text-accent">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>

      <ul className="sr-only">
        {claims.map((claim) => (
          <li key={claim}>{plain(claim)}</li>
        ))}
      </ul>

      <div className="flex shrink-0 items-center gap-1">
        {/* Which claim is showing, and a way to any of them. Each marker has
            a 24px hit area around a short bar (WCAG 2.2 target size). */}
        <div className="hidden items-center sm:flex">
          {claims.map((claim, i) => (
            <button
              key={claim}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'true' : undefined}
              className="group flex h-6 items-center px-1"
            >
              <span
                aria-hidden="true"
                className={cx(
                  'motion-state block h-1 rounded-full',
                  i === index ? 'w-6 bg-ink-900' : 'w-2.5 bg-ink-500 group-hover:bg-ink-700',
                )}
              />
              <span className="sr-only">Show claim {i + 1} of {claims.length}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          className="motion-state inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-700 hover:bg-ink-900/10 hover:text-ink-900"
        >
          <span aria-hidden="true" className="text-xs">
            {playing ? '❙❙' : '▶'}
          </span>
          <span className="sr-only">
            {playing ? 'Stop the rotating headline' : 'Resume the rotating headline'}
          </span>
        </button>
      </div>
    </div>
  );
}
