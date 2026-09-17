import Link from 'next/link';
import { BottomTabs, Footer, TopBar } from './shell';
import { Banner } from './ui';

/**
 * What a flagged-off feature looks like to the person who went looking for it
 * (SA-03).
 *
 * Deliberately not a 404. "Not found" is a lie when the thing exists and has
 * been switched off, and it sends a student to support to report a broken
 * link that nobody can reproduce. It is also not an error page: nothing has
 * gone wrong, a decision was made.
 *
 * It names the institution, because on a multi-tenant platform the honest
 * answer to "why can't I see this" is usually "your university has not turned
 * it on" rather than anything about the platform.
 */
export function FeatureOff({
  title,
  institution,
  children,
}: {
  title: string;
  institution: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">{title}</h1>
        <div className="mt-6">
          <Banner tone="info" title={`${institution} has this turned off`}>
            {children ?? (
              <p>
                It is not available here at the moment. Nothing you have done is affected, and
                anything already recorded is kept.
              </p>
            )}
          </Banner>
        </div>
        <p className="t-body-sm mt-8">
          <Link href="/dashboard" className="text-ink-700 underline underline-offset-2">
            Back to your dashboard
          </Link>
        </p>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
