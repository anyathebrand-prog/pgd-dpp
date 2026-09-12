import Link from 'next/link';
import { Banner, DataString, LinkButton } from '@/components/ui';

/**
 * PY-04. The error states what happened and what to do, and does not
 * apologise (§1.4). No money moved, so the copy says that first — it is the
 * thing the reader is actually worried about.
 */
export default async function FailedPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <h1 className="t-h1 m-0 text-ink-900">That payment did not go through</h1>

      <div className="mt-8">
        <Banner tone="danger" title="No money has left your account">
          <p>
            The bank declined the charge or the checkout was closed before it completed. Nothing has
            been taken. Your application is untouched and still saved.
          </p>
        </Banner>
      </div>

      <p className="t-body mt-8 text-ink-700">
        Common causes are an expired card, a daily online limit on your bank account, or a network
        drop mid-payment. Trying a different card or a bank transfer usually resolves it.
      </p>

      <p className="t-caption mt-8 mb-1 text-ink-700">Attempt reference</p>
      <p className="t-data m-0 select-all text-ink-900">
        <DataString value={ref} label="Attempt reference" />
      </p>

      <div className="mt-16 flex flex-wrap gap-4">
        <LinkButton href="/pay/application">Try again</LinkButton>
        <Link href="/apply" className="t-body-sm self-center text-ink-700 underline underline-offset-2">
          Back to my application
        </Link>
      </div>
    </main>
  );
}
