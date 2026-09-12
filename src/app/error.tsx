'use client';

import { Button } from '@/components/ui';

/**
 * SY-03, and only SY-03.
 *
 * Session expiry, missing MFA, a failed role check and a missing tenant are all
 * handled by redirects in lib/auth.ts and lib/tenant.ts, not here. They are
 * routing outcomes with their own screens and their own status codes.
 *
 * This deliberately does not branch on `error.message`: Next replaces Server
 * Component error messages with an opaque digest in production, so any such
 * branch would work in development and quietly stop working once deployed.
 * The digest is surfaced instead, because it is the one string that lets
 * support correlate a user's report with the server log.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-24">
      <h1 className="t-h1 m-0 text-ink-900">Something went wrong at our end</h1>
      <p className="t-body mt-4 text-ink-700">
        The error has been recorded. Nothing you had saved is affected, and trying again often
        works.
      </p>

      {error.digest ? (
        <>
          <p className="t-caption mt-8 mb-1 text-ink-700">Reference for support</p>
          <p className="t-data m-0 select-all text-ink-900">{error.digest}</p>
        </>
      ) : null}

      <div className="mt-12">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
