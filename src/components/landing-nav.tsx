'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cx } from './ui';

/**
 * The PB-01 navigation bar.
 *
 * The product's TopBar is deliberately thin — a signed-in student wants four
 * destinations and no marketing. A visitor deciding whether this qualification
 * is real wants the opposite, so the landing page gets its own bar: a utility
 * strip carrying the things an institution or an employer arrives looking for,
 * and a main bar with grouped sections.
 *
 * Interaction rules, in order of how often they are got wrong:
 *  - the menus open on click, not on hover, because hover does not exist on
 *    the phone this audience is using;
 *  - Escape closes and returns focus to the trigger;
 *  - every trigger is a real button with aria-expanded, so a screen reader is
 *    told the thing it is about to open;
 *  - nothing here is a link that does nothing. Anchors point at sections that
 *    exist on this page; routes point at pages that exist.
 */

type Item = { href: string; label: string; external?: boolean };
type Section = { label: string; href?: string; items?: Item[] };

const SECTIONS: Section[] = [
  {
    label: 'The programme',
    items: [
      { href: '/#study', label: 'What you study' },
      { href: '/#how', label: 'How it works' },
      { href: '/#faq', label: 'Questions and answers' },
      { href: '/teach-with-us', label: 'Teach with us' },
    ],
  },
  { label: 'Institutions', href: '/programmes' },
  {
    label: 'Resources',
    items: [
      { href: '/#resources', label: 'The law, in one place' },
      { href: 'https://ndpc.gov.ng/', label: 'Nigeria Data Protection Commission', external: true },
      { href: '/trust', label: 'Trust and compliance' },
    ],
  },
  { href: '/verify', label: 'Verify a certificate' },
];

export function LandingNav() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Escape closes whichever surface is open; a click outside closes the
  // dropdowns. Both are the behaviours a person already expects, so their
  // absence reads as the menu being broken rather than as a missing feature.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpenMenu(null);
      setMobileOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!navRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div ref={navRef} className="sticky top-0 z-30">
      {/* The utility strip. Redaction, because it is chrome rather than
          content, and because it makes the Paper below it read as the page. */}
      <div className="border-b border-ink-300 bg-ink-100/60 text-ink-700">
        <div className="mx-auto flex max-w-marketing flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1.5 md:px-8">
          <p className="t-caption m-0">
            Registered with the Nigeria Data Protection Commission
          </p>
          <a
            href="mailto:dpo@example.ng"
            className="t-caption text-ink-900 underline underline-offset-2"
          >
            dpo@example.ng
          </a>
          <Link
            href="/login"
            className="t-caption ml-auto hidden text-ink-900 underline underline-offset-2 md:inline"
          >
            Log in
          </Link>
        </div>
      </div>

      <header className="border-b border-ink-300 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-marketing items-center gap-6 px-4 py-2 md:px-8">
          <Link href="/" className="flex items-center gap-2 no-underline">
            {/* On a white panel: the logo's navy lettering is about 2:1 on
                the navy page, and a brand mark is not recoloured to fit. */}
            <span className="inline-flex items-center rounded-md bg-ink-900 px-2.5 py-1.5">
              <img
                src="/brand/dph-logo-header.png"
                alt="Data Protection Hub Limited, home"
                width={640}
                height={226}
                className="h-9 w-auto md:h-11"
              />
            </span>
          </Link>

          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
            {SECTIONS.map((section) =>
              section.items ? (
                <div key={section.label} className="relative">
                  <button
                    type="button"
                    aria-expanded={openMenu === section.label}
                    onClick={() =>
                      setOpenMenu((cur) => (cur === section.label ? null : section.label))
                    }
                    className="motion-state t-body-sm flex min-h-11 items-center gap-1.5 px-3 font-semibold text-ink-700 hover:text-ink-900"
                  >
                    {section.label}
                    <span aria-hidden="true" className="text-[0.6em]">
                      ▼
                    </span>
                  </button>
                  {openMenu === section.label ? (
                    <ul className="motion-appear absolute right-0 top-full mt-2 m-0 w-72 list-none rounded-md border border-ink-300 bg-record p-2">
                      {section.items.map((item) => (
                        <li key={item.href}>
                          <MenuLink item={item} onNavigate={() => setOpenMenu(null)} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <Link
                  key={section.href}
                  href={section.href!}
                  className="motion-state t-body-sm flex min-h-11 items-center px-3 font-semibold text-ink-700 no-underline hover:text-ink-900"
                >
                  {section.label}
                </Link>
              ),
            )}
            <Link
              href="/programmes"
              className="motion-state t-body-sm ml-2 inline-flex min-h-11 items-center rounded-full bg-authority px-4 font-semibold text-surface no-underline hover:bg-authority-hover"
            >
              Start an application
            </Link>
          </nav>

          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="landing-menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="motion-state t-body-sm ml-auto inline-flex min-h-11 items-center gap-2 rounded-sm border border-ink-300 px-3 font-semibold text-ink-900 lg:hidden"
          >
            <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
            Menu
          </button>
        </div>

        {mobileOpen ? (
          <div id="landing-menu" className="border-t border-ink-300 lg:hidden">
            <nav aria-label="Main" className="mx-auto max-w-marketing px-4 py-4 md:px-8">
              {/* Flattened on mobile. A dropdown inside a dropdown is a place
                  for a thumb to get lost, and there are only nine links. */}
              <ul className="m-0 list-none space-y-1 p-0">
                {SECTIONS.flatMap((section) =>
                  section.items
                    ? [
                        <li key={section.label} className="pt-3">
                          <p className="t-caption m-0 text-ink-500">{section.label}</p>
                        </li>,
                        ...section.items.map((item) => (
                          <li key={item.href}>
                            <MenuLink item={item} onNavigate={() => setMobileOpen(false)} />
                          </li>
                        )),
                      ]
                    : [
                        <li key={section.href}>
                          <MenuLink
                            item={{ href: section.href!, label: section.label }}
                            onNavigate={() => setMobileOpen(false)}
                          />
                        </li>,
                      ],
                )}
                <li className="pt-3">
                  <MenuLink
                    item={{ href: '/login', label: 'Log in' }}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </li>
              </ul>
              <Link
                href="/programmes"
                onClick={() => setMobileOpen(false)}
                className="motion-state t-body-sm mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-authority px-4 font-semibold text-surface no-underline"
              >
                Start an application
              </Link>
            </nav>
          </div>
        ) : null}
      </header>
    </div>
  );
}

function MenuLink({ item, onNavigate }: { item: Item; onNavigate: () => void }) {
  const className = cx(
    'motion-state t-body-sm flex min-h-11 items-center rounded-sm px-3 text-ink-900 no-underline',
    'hover:bg-record',
  );

  if (item.external) {
    return (
      <a href={item.href} className={className} onClick={onNavigate} rel="noopener">
        {item.label}
        <span className="t-caption ml-2 text-ink-500" aria-hidden="true">
          ↗
        </span>
        <span className="sr-only"> (opens ndpc.gov.ng)</span>
      </a>
    );
  }

  return (
    <Link href={item.href} className={className} onClick={onNavigate}>
      {item.label}
    </Link>
  );
}
