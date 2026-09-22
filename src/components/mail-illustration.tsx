'use client';

import { useEffect, useState } from 'react';

/**
 * AU-02's sent-mail illustration: an envelope opening, on a loop.
 *
 * One of the recorded exceptions to §9's ban on decorative loops (brief
 * §0.4), and it carries the same safeguards as the typing headings:
 *
 *  - it stops. WCAG 2.2.2: anything moving for more than five seconds needs
 *    a way to pause it. An animated image cannot be paused in place, so
 *    pausing swaps it for the still final frame (the envelope with its
 *    badge), and playing swaps it back.
 *  - under prefers-reduced-motion it starts paused, on the still.
 *  - it is decorative: no alt text, because the heading beside it already
 *    says "Check your email" in words.
 */
export function MailIllustration({ size, className }: { size: 'small' | 'large'; className?: string }) {
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  const px = size === 'large' ? 480 : 144;
  return (
    <div className={`relative ${className ?? ''}`} style={{ width: px, height: px }}>
      <img
        src={playing ? '/illustrations/mail-sent.webp' : '/illustrations/mail-sent-still.webp'}
        alt=""
        width={480}
        height={480}
        className="block h-full w-full"
      />
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className={
          'hairline motion-state absolute inline-flex items-center justify-center rounded-full bg-surface/70 text-ink-700 backdrop-blur hover:text-ink-900 ' +
          (size === 'large' ? 'right-6 bottom-6 h-11 w-11' : '-right-2 bottom-1 h-9 w-9')
        }
      >
        <span aria-hidden="true" className="text-xs">
          {playing ? '❙❙' : '▶'}
        </span>
        <span className="sr-only">{playing ? 'Pause the animation' : 'Play the animation'}</span>
      </button>
    </div>
  );
}
