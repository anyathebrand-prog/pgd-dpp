import Link from 'next/link';
import { currentInstitution } from '@/lib/tenant';

/**
 * §4.3: auth screens use the 640px form container. A 1400px-wide input is
 * unusable, and this is the audience least likely to forgive one.
 *
 * There is no global navigation here. Someone mid-signup has one job.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const institution = await currentInstitution();
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-300">
        <div className="mx-auto flex h-16 max-w-[640px] items-center gap-2 px-4">
          <Link href="/" className="flex items-center gap-2 no-underline">
            <span
              className="inline-block h-6 w-1.5"
              style={{ background: 'var(--tenant-brand)' }}
              aria-hidden="true"
            />
            <span className="t-label text-ink-900">{institution?.shortName ?? 'PGD-DPP'}</span>
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        {children}
      </main>
      <footer className="mx-auto max-w-[640px] px-4 pb-12">
        <p className="t-caption m-0 text-ink-700">
          <Link href="/privacy" className="text-ink-700 underline underline-offset-2">
            What we do with your data
          </Link>{' '}
          · Data Protection Officer: dpo@example.ng
        </p>
      </footer>
    </div>
  );
}
