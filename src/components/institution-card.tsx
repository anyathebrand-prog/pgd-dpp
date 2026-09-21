import 'server-only';
import type { ReactNode } from 'react';
import { campusPhoto } from '@/lib/marketing-images';
import { Record, cx } from './ui';

/**
 * A partner university as a card: its campus photograph above a Record on
 * the closing band's blue gradient. Used on PB-01 ("Where you would be
 * studying") and PB-02 (/programmes), so the two cannot drift apart.
 *
 * Every line of text on the gradient is off-white, because the grey
 * secondary ink falls to 3.3:1 at the gradient's bright end; any
 * `text-ink-700` passed in as a child is lifted to off-white here. Buttons
 * inside should be the solid (primary) variant: an outline's border is
 * 2.0:1 on the blue.
 *
 * Hover is light and colour only (§9 bans lift and scale): the photograph
 * brightens, the base brightens 5% (more would push the bright corner below
 * 4.5:1 for the text) and the outline turns white.
 */
export function InstitutionCard({
  inst,
  children,
}: {
  inst: { name: string; slug: string; city: string | null };
  children: ReactNode;
}) {
  const campus = campusPhoto(inst.slug);
  return (
    <li className="group flex flex-col">
      {campus ? (
        <img
          src={campus}
          alt={`The main gate of the ${inst.name}`}
          width={1200}
          height={630}
          loading="lazy"
          decoding="async"
          className="aspect-[1200/630] w-full rounded-t-lg object-cover brightness-95 transition-[filter] duration-[120ms] group-hover:brightness-110"
        />
      ) : null}
      <Record
        title={inst.name}
        meta={inst.city ?? undefined}
        className={cx(
          'glow-band motion-state flex-1 transition-[filter,border-color] group-hover:border-ink-900/50 group-hover:brightness-105',
          '[&>div:first-child]:bg-ink-900 [&_p]:text-ink-900 [&_.text-ink-700]:text-ink-900',
          campus && 'rounded-t-none border-t-0',
        )}
      >
        {children}
      </Record>
    </li>
  );
}
