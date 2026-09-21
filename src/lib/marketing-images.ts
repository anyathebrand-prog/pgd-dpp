import 'server-only';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cache } from 'react';

/**
 * Which of PB-01's photographs have actually been supplied.
 *
 * The page asks before it renders a figure, so a slot with no file leaves a
 * clean layout instead of a broken image. That matters more here than the
 * usual "handle the missing case" instinct: the alternative was a seeded
 * placeholder service, and a stock photograph of a campus that is not a
 * partner university tells a candidate deciding whether to pay a
 * non refundable fee that facilities exist which do not.
 *
 * See public/marketing/README.md for the filenames and the two rules.
 */
const SLOTS = ['hero', 'registry', 'faculty', 'study', 'convocation'] as const;

export type Slot = (typeof SLOTS)[number];

const EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'];

export const marketingImages = cache((): Record<Slot, string | null> => {
  const dir = join(process.cwd(), 'public', 'marketing');
  const found = {} as Record<Slot, string | null>;

  for (const slot of SLOTS) {
    const hit = EXTENSIONS.map((ext) => `${slot}.${ext}`).find((name) =>
      existsSync(join(dir, name)),
    );
    found[slot] = hit ? `/marketing/${hit}` : null;
  }

  return found;
});

/**
 * A partner university's own campus photograph, for its card under "Where
 * you would be studying". Keyed by the institution's subdomain slug, so a
 * new tenant gets one by adding `public/marketing/institutions/{slug}.webp`.
 * The slug is validated before it reaches the filesystem.
 */
export const campusPhoto = cache((slug: string): string | null => {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) return null;
  const dir = join(process.cwd(), 'public', 'marketing', 'institutions');
  const hit = EXTENSIONS.map((ext) => `${slug}.${ext}`).find((name) => existsSync(join(dir, name)));
  return hit ? `/marketing/institutions/${hit}` : null;
});
