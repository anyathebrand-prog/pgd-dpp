/**
 * §9 motion, enforced rather than trusted.
 *
 * The not-permitted list is the easy thing to violate: hover lift and
 * staggered reveals are what most component libraries reach for by default,
 * and a skeleton shimmer arrives the moment someone installs a loading
 * component. This scans the source so a regression is caught at the commit
 * rather than in review.
 *
 * It reads files rather than rendering anything — the rules are about what is
 * in the stylesheet and the class names, not about runtime behaviour.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const CSS = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCES = walk(SRC).filter((f) => /\.(tsx|ts|css)$/.test(f));

/** The body of one CSS rule, not everything that follows it. */
function ruleBody(selector: string, css = CSS) {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  return css.slice(open, css.indexOf('}', open) + 1);
}

function code(file: string) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('the not-permitted list stays not permitted', () => {
  // §9, verbatim: entrance animations on scroll, staggered card reveals,
  // hover scale or lift, parallax, skeleton shimmer, animated counters,
  // decorative loops.
  it.each([
    ['hover scale', /hover:scale-|hover:\[transform/],
    ['hover lift', /hover:-translate-y|hover:translate-y-/],
    ['skeleton shimmer', /shimmer|animate-pulse/],
    ['spinners', /animate-spin/],
    ['bounce', /animate-bounce/],
    ['ping', /animate-ping/],
    ['parallax', /parallax|background-attachment:\s*fixed/],
    ['scroll-triggered entrance', /data-aos|animate-on-scroll|IntersectionObserver/],
  ])('no %s anywhere in src', (_label, pattern) => {
    const offenders = SOURCES.filter((f) => pattern.test(code(f)));
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([]);
  });
});

describe('durations stay inside the budget', () => {
  it('defines the three durations and the easing the brief specifies', () => {
    expect(CSS).toContain('--motion-state: 120ms');
    expect(CSS).toContain('--motion-sheet: 180ms');
    expect(CSS).toContain('--motion-page: 240ms');
    expect(CSS).toContain('cubic-bezier(0.2, 0, 0.2, 1)');
  });

  it('has nothing over 240ms except the indeterminate loop', () => {
    // The payment and upload bars loop at 1.4s by design — they indicate
    // ongoing work rather than transitioning between two states.
    const durations = [...CSS.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)]
      .map(([, n, unit]) => (unit === 's' ? Number(n) * 1000 : Number(n)))
      // 0.01ms is the reduced-motion kill switch.
      .filter((ms) => ms > 0.01 && ms !== 1400);

    for (const ms of durations) expect(ms).toBeLessThanOrEqual(240);
  });
});

describe('reduced motion is handled the way §9 requires', () => {
  const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('exists at all', () => {
    expect(CSS).toContain('prefers-reduced-motion: reduce');
  });

  it('renders the PB-01 hero in its resolved state rather than a frozen frame', () => {
    // The headline is redacted by a pseudo-element, so "resolved" means the
    // bar is never painted at all — not an animation frozen part-way across
    // the words it is covering.
    const resolved = ruleBody('.motion-redaction::after', block);
    expect(resolved).toMatch(/content:\s*none/);
  });

  it('keeps the progress bar visible, because removing feedback is not an accommodation', () => {
    // The blanket rule would freeze it as a 25%-wide sliver parked off to one
    // side, which reads as broken. It becomes a full static bar instead.
    const bar = ruleBody('.bar-indeterminate', block);
    expect(bar).toMatch(/animation:\s*none/);
    expect(bar).toMatch(/width:\s*100%/);
  });

  it('delivers the hero already in place rather than mid-entrance', () => {
    const rise = ruleBody('.motion-rise,', block);
    expect(rise).toMatch(/animation:\s*none/);
    expect(rise).toMatch(/opacity:\s*1/);
  });

  it('never starts the rotating claim, and lets anyone stop it', () => {
    // WCAG 2.2.2: moving content that runs past five seconds needs a control.
    // Reduced motion is handled in the component rather than in CSS, because
    // the rotation is a timer rather than an animation — a CSS rule cannot
    // switch off setInterval.
    const hero = readFileSync(join(SRC, 'components', 'landing-hero.tsx'), 'utf8');
    expect(hero).toContain('(prefers-reduced-motion: reduce)');
    expect(hero).toMatch(/Stop the rotating headline/);
  });

  it('lets the typing loop be stopped, and never starts it with motion reduced', () => {
    // Brief §0.4: the typing headings are the product's only recorded
    // exceptions to §9's ban on decorative loops. These are their conditions.
    const typing = readFileSync(join(SRC, 'components', 'typing-heading.tsx'), 'utf8');
    expect(typing).toContain('(prefers-reduced-motion: reduce)');
    expect(typing).toMatch(/Stop the typing headline/);
    expect(typing).toMatch(/aria-hidden="true"/);
    expect(typing).toMatch(/sr-only/);
  });

  it('keeps the typing loop to the headings it was granted for', () => {
    // Brief §0.4's table, and nowhere else.
    const users = SOURCES.filter(
      (f) => !f.endsWith('typing-heading.tsx') && /TypingHeading/.test(code(f)),
    );
    expect(users.map((f) => f.replace(SRC, 'src').split('\\').join('/')).sort()).toEqual([
      'src/app/page.tsx',
      'src/app/programmes/page.tsx',
    ]);
  });

  it('lets the looping mail illustration be paused, and holds it still with motion reduced', () => {
    // Brief §0.4's third recorded loop. An animated image cannot pause in
    // place, so the component swaps to the still frame.
    const mail = readFileSync(join(SRC, 'components', 'mail-illustration.tsx'), 'utf8');
    expect(mail).toContain('(prefers-reduced-motion: reduce)');
    expect(mail).toMatch(/Pause the animation/);
    expect(mail).toContain('mail-sent-still.webp');
    const users = SOURCES.filter(
      (f) => !f.endsWith('mail-illustration.tsx') && /MailIllustration/.test(code(f)),
    );
    expect(users.map((f) => f.replace(SRC, 'src').split('\\').join('/'))).toEqual([
      'src/app/(auth)/signup/verify/page.tsx',
    ]);
  });

  it('pairs the payment bar with a live status line', () => {
    // §9: "the PY-02 payment bar becomes a static bar plus a text status line
    // that updates via aria-live".
    const py02 = readFileSync(join(SRC, 'components', 'payment-pending.tsx'), 'utf8');
    expect(py02).toContain('aria-live="polite"');
    expect(py02).toContain('role="progressbar"');
  });
});

describe('the one non-user-triggered moment is the only one', () => {
  it('is PB-01 and nowhere else', () => {
    // §9: "The redacted hero on PB-01 is the single non-user-triggered motion
    // moment in the entire system, and it exists once."
    // globals.css defines the class; exactly one component may apply it.
    const users = SOURCES.filter(
      (f) => !f.endsWith('globals.css') && /motion-redaction/.test(code(f)),
    );
    expect(users.map((f) => f.replace(SRC, 'src'))).toEqual([
      join('src', 'app', 'page.tsx'),
    ]);
  });

  it('draws once and does not loop', () => {
    expect(ruleBody('.motion-redaction::after')).not.toMatch(/animation:[^;]*infinite/);
  });

  it('lets the hero rise into place, but only the hero', () => {
    // §9 bans staggered reveals in the product, and that ban is about a
    // person's tenth visit to a queue rather than their first visit to a
    // landing page. The line is drawn by surface: the entrance exists on
    // PB-01 and nowhere a student works.
    const users = SOURCES.filter(
      (f) => !f.endsWith('globals.css') && /motion-rise/.test(code(f)),
    );
    expect(users.map((f) => f.replace(SRC, 'src'))).toEqual([join('src', 'app', 'page.tsx')]);
  });

  it('keeps the hero entrance inside the 240ms budget', () => {
    // Four elements at 60ms apart: the whole sequence lands before the page
    // transition token would have finished a single fade.
    for (const cls of ['.motion-rise-1', '.motion-rise-2', '.motion-rise-3', '.motion-rise-4']) {
      const delay = /(\d+)ms/.exec(ruleBody(cls))?.[1];
      expect(Number(delay)).toBeLessThanOrEqual(240);
    }
  });

  it('has no animated redaction reveal anywhere else', () => {
    // Explicitly called out as not permitted inside the product.
    const offenders = SOURCES.filter(
      (f) => /redaction-wipe/.test(code(f)) && !f.endsWith('globals.css'),
    );
    expect(offenders).toEqual([]);
  });
});
