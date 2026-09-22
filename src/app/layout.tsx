import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter_Tight, Literata } from 'next/font/google';
import './globals.css';
import { currentInstitution } from '@/lib/tenant';
import { brandOnSurface } from '@/lib/contrast';

/**
 * §3.5 font loading is a real constraint, not a preference. The budget is
 * ≤110KB on the application funnel against a <3s-on-3G target (§8).
 *
 *  - Inter Tight 400/600 preloads (brief §0; it stands in for the reference's
 *    TWK Lausanne). It is needed for first paint on every screen.
 *  - Literata does NOT preload. It is only used on reading surfaces (ST-03,
 *    LB-03, PB-06), so paying for it on the application funnel would be pure
 *    waste for the audience we are optimising hardest for.
 *  - Plex Mono is subset to the characters our data strings actually use —
 *    digits, A–Z, hyphen, slash, colon — which takes it to a few kilobytes.
 */
const interTight = Inter_Tight({
  subsets: ['latin'],
  // 700 is for the display headings that type (brief §0.4).
  weight: ['400', '600', '700'],
  variable: '--font-inter-tight',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});

const literata = Literata({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-literata',
  display: 'swap',
  preload: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'Cascadia Mono', 'monospace'],
});

export const metadata: Metadata = {
  title: 'Post Graduate Diploma in Data Protection & Privacy',
  description:
    'Apply, study and qualify in Nigerian data protection law. Run by accredited universities on one platform.',
};

export const viewport: Viewport = {
  // 360px is the design baseline (§4.2). Zoom is never disabled (§10).
  width: 'device-width',
  initialScale: 1,
  themeColor: '#08163C',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const institution = await currentInstitution();

  return (
    <html
      lang="en-NG"
      className={`${interTight.variable} ${literata.variable} ${plexMono.variable}`}
      // §2.5: the one tenant-overridable token. Every semantic token is fixed,
      // so a registry officer moving between institutions never has to relearn
      // what a colour means, and contrast compliance does not depend on a
      // university administrator's colour taste.
      // Drawn lifted toward white just enough to show on the navy surface
      // (brief §0.3); the stored colour is untouched.
      style={
        institution
          ? ({ ['--tenant-brand' as string]: brandOnSurface(institution.brandColour) })
          : undefined
      }
    >
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-surface"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
