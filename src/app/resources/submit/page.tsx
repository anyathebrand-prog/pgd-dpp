import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, Panel } from '@/components/ui';
import { SubmitPaperForm } from '@/components/resource-panels';

/**
 * RC-03 submit a paper (RES-04).
 *
 * §5.7 permits faculty-authored works "with author licence", and that licence
 * is the substance of this screen rather than fine print at the bottom of it.
 * Without it there is no lawful basis for hosting the paper, which is exactly
 * the distinction this programme teaches.
 *
 * Nothing submitted here reaches a reader on its own. It lands in the
 * curator's queue as `in_review`, and even an accepted paper becomes a draft
 * rather than a publication — its licence and provenance still have to be
 * recorded at CU-02.
 */
export default async function SubmitPaper({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  await requireUser();
  const { sent } = await searchParams;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/resources" className="text-ink-700 underline underline-offset-2">
            Back to the Resource Centre
          </Link>
        </p>

        <h1 className="t-h1 mt-4 text-ink-900">Submit a paper</h1>

        {sent ? (
          <div className="mt-8">
            <Banner tone="verified" title="With the curator">
              <p>
                Your paper is in the review queue. A curator checks the contributor licence and the
                provenance before anything is published, and you will hear either way.
              </p>
            </Banner>
          </div>
        ) : (
          <>
            <p className="t-body measure mt-3 mb-8 text-ink-700">
              For students and faculty with work on data protection, privacy or the NDPA. A curator
              reads every submission; nothing goes straight to the collection.
            </p>

            <div className="mb-8">
              <Panel title="What gets accepted">
                <ul className="t-body-sm m-0 list-disc space-y-2 pl-5 text-ink-700">
                  <li>Work you wrote, or are authorised to offer on behalf of its authors.</li>
                  <li>
                    Anything already published elsewhere — give the link rather than the file if
                    your publisher holds exclusive rights.
                  </li>
                  <li>
                    Not a draft dissertation chapter you would like feedback on. That is what your
                    facilitator is for.
                  </li>
                </ul>
              </Panel>
            </div>

            <SubmitPaperForm />
          </>
        )}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
