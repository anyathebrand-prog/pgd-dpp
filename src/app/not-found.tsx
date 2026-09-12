import Link from 'next/link';

/** SY-01. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-24">
      <h1 className="t-h1 m-0 text-ink-900">That page does not exist</h1>
      <p className="t-body mt-3 text-ink-700">
        The address may be mistyped, or the thing it pointed at may have been removed.
      </p>
      <p className="t-body-sm mt-8">
        <Link href="/" className="text-ink-900 underline underline-offset-2">
          Go to the start
        </Link>
      </p>
    </main>
  );
}
