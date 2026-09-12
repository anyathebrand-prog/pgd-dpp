import 'server-only';
import Link from 'next/link';
import { currentInstitution, currentPath } from '@/lib/tenant';
import { currentPrincipal } from '@/lib/auth';
import { cx } from './ui';

/**
 * §5.3 navigation.
 *
 * Student and alumni: a 64px top bar on Paper with a 1px bottom rule, and a
 * 5-item bottom tab bar on mobile. The application funnel gets no global nav
 * at all — a step rail replaces it, because a candidate mid-application should
 * be looking at one sequence, not at the rest of the product.
 */

const STUDENT_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/programme', label: 'Programme' },
  { href: '/grades', label: 'Grades' },
  { href: '/billing', label: 'Payments' },
];

export async function TopBar() {
  const inst = await currentInstitution();
  const me = await currentPrincipal();
  const path = await currentPath();

  return (
    <header className="border-b border-ink-300 bg-surface">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 no-underline">
          {/* The institution mark is one of exactly four places --tenant-brand
              is permitted to appear (§2.5). */}
          <span
            className="inline-block h-6 w-1.5"
            style={{ background: 'var(--tenant-brand)' }}
            aria-hidden="true"
          />
          <span className="t-label text-ink-900">{inst?.shortName ?? 'PGD-DPP'}</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 gap-5 md:flex">
          {me
            ? STUDENT_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={path.startsWith(item.href) ? 'page' : undefined}
                  className={cx(
                    't-body-sm no-underline',
                    path.startsWith(item.href)
                      ? 'font-semibold text-ink-900 underline underline-offset-8 decoration-authority decoration-2'
                      : 'text-ink-700 hover:text-ink-900',
                  )}
                >
                  {item.label}
                </Link>
              ))
            : null}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {me ? (
            <>
              <Link href="/account" className="t-body-sm text-ink-700 no-underline hover:text-ink-900">
                {me.fullName ?? me.email}
              </Link>
              <form action="/api/logout" method="post">
                <button className="t-body-sm text-ink-700 underline underline-offset-2">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="t-body-sm text-ink-900 no-underline underline underline-offset-2">
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Mobile bottom tabs. Five items, 44px targets, labels always visible. */
export async function BottomTabs() {
  const me = await currentPrincipal();
  if (!me) return null;
  const path = await currentPath();
  const tabs = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/programme', label: 'Programme' },
    { href: '/library', label: 'Library' },
    { href: '/alumni', label: 'Alumni' },
    { href: '/account', label: 'Account' },
  ];
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-ink-300 bg-surface md:hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path.startsWith(t.href) ? 'page' : undefined}
          className={cx(
            'flex min-h-[52px] items-center justify-center px-1 text-center text-xs no-underline',
            path.startsWith(t.href) ? 'font-semibold text-ink-900' : 'text-ink-700',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink-300">
      <div className="mx-auto max-w-[1120px] px-4 py-8 md:px-8">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            ['/privacy', 'Privacy notice'],
            ['/trust', 'Trust and compliance'],
            ['/verify', 'Verify a certificate'],
            ['/library/takedown', 'Report content'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="t-body-sm text-ink-700 no-underline underline underline-offset-2">
              {label}
            </Link>
          ))}
        </nav>
        <p className="t-caption mt-4 mb-0 text-ink-700">
          Data Protection Officer: dpo@example.ng · Registered with the Nigeria Data Protection
          Commission.
        </p>
      </div>
    </footer>
  );
}

/**
 * The application funnel rail (§5.3). Numbered legitimately — it is a
 * sequence. Vertical beside the form on desktop, a pinned horizontal strip on
 * mobile showing "Step 3 of 7" plus the step name.
 */
export function StepRail({
  steps,
  currentIndex,
}: {
  steps: { href: string; label: string; done: boolean; queried?: boolean }[];
  currentIndex: number;
}) {
  const current = steps[currentIndex];
  return (
    <>
      <p className="t-body-sm mb-4 text-ink-700 md:hidden">
        Step {currentIndex + 1} of {steps.length} — <strong className="text-ink-900">{current?.label}</strong>
      </p>
      <nav aria-label="Application steps" className="hidden md:block">
        <ol className="m-0 list-none space-y-3 p-0">
          {steps.map((s, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cx(
                    't-body-sm flex items-center gap-3 no-underline',
                    isCurrent ? 'font-semibold text-authority' : s.done ? 'text-ink-900' : 'text-ink-500',
                  )}
                >
                  <span
                    className={cx(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs',
                      s.queried
                        ? 'bg-warning text-surface'
                        : s.done || isCurrent
                          ? 'bg-authority text-surface'
                          : 'border border-ink-500 text-ink-500',
                    )}
                    aria-hidden="true"
                  >
                    {s.queried ? '▲' : s.done ? '✓' : i + 1}
                  </span>
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
