import Link from 'next/link';
import { TopBar, Footer } from '@/components/shell';
import { Banner, DataString } from '@/components/ui';

/**
 * LB-05, the acknowledged state.
 *
 * The reference is the whole point of this screen: "we'll look into it" with
 * nothing to quote is how a claim turns into a lawyer's letter. It is shown
 * as data — Plex Mono, selectable — because it is a string someone will
 * transcribe.
 */
export default async function TakedownReceived({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Your claim is logged</h1>

        {ref ? (
          <div className="mt-8 rounded-md bg-record p-5">
            <p className="t-caption m-0 mb-1 text-ink-700">Your reference</p>
            <p className="t-data-lg m-0 text-ink-900">
              <DataString value={ref} label="Takedown reference" />
            </p>
          </div>
        ) : null}

        <p className="t-body mt-8 text-ink-700">
          A copy is on its way to the address you gave. A curator reviews it and the Data Protection
          Officer has been copied; you will be told the outcome either way, at that same address.
        </p>

        <div className="mt-8">
          <Banner tone="info" title="If this is urgent">
            <p>
              Write to dpo@example.ng quoting the reference above. An item is not taken down faster
              by submitting the claim twice — a second claim joins the same queue behind the first.
            </p>
          </Banner>
        </div>

        <p className="t-body-sm mt-10">
          <Link href="/" className="text-ink-700 underline underline-offset-2">
            Back to the home page
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
