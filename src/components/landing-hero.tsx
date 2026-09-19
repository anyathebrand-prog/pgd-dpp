'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The rotating claim under the PB-01 headline.
 *
 * Three things are true about this programme and no one of them is the whole
 * pitch, so the line cycles. Four rules keep that from being a nuisance:
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
 */
export function RotatingClaim({ claims }: { claims: string[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || held || reduced.current) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % claims.length), 5000);
    return () => clearInterval(id);
  }, [playing, held, claims.length]);

  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <p
        // `key` forces the crossfade to replay. Without it React updates the
        // text in place and the change is a flicker with no cause.
        key={index}
        className="motion-claim t-body-lg m-0 font-semibold text-ink-900"
        aria-hidden="true"
      >
        {claims[index]}
      </p>

      <ul className="sr-only">
        {claims.map((claim) => (
          <li key={claim}>{claim}</li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setPlaying((v) => !v)}
        className="motion-state t-caption inline-flex h-11 min-w-11 items-center justify-center rounded-sm border border-ink-300 px-3 text-ink-700 hover:text-ink-900"
      >
        <span aria-hidden="true">{playing ? '❙❙' : '▶'}</span>
        <span className="sr-only">
          {playing ? 'Stop the rotating headline' : 'Resume the rotating headline'}
        </span>
      </button>
    </div>
  );
}
