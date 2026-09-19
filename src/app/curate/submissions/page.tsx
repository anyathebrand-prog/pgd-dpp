import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { Banner, EmptyState, Panel, Record, StaffBand } from '@/components/ui';
import { SubmissionDecision } from '@/components/resource-panels';

/**
 * CU-03 submission approval queue (RES-04).
 *
 * The flow asks for one thing beyond approve/reject: "check the contributor
 * licence". A submission exists only because someone ticked that box, so what
 * this screen shows is the claim they made and who made it — the curator is
 * checking a representation, not just reading an abstract.
 */
export default async function Submissions({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string }>;
}) {
  await requireRole('curator', 'super_admin');
  const { decided } = await searchParams;

  const rows = await db
    .select({ item: libraryItems, submitter: users })
    .from(libraryItems)
    .leftJoin(users, eq(users.id, libraryItems.submittedBy))
    .where(eq(libraryItems.status, 'in_review'))
    .orderBy(desc(libraryItems.createdAt));

  return (
    <div>
      <StaffBand institution="Platform" role="Library curator" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <p className="t-body-sm m-0">
          <Link href="/curate" className="text-ink-700 underline underline-offset-2">
            Back to the queue
          </Link>
        </p>

        <h1 className="t-h1 mt-4 mb-2 text-ink-900">Contributed papers</h1>
        <p className="t-body measure mb-8 text-ink-700">
          Each of these was offered under the contributor licence, by the person named on it.
          Accepting moves a paper into curation as a draft — its licence and provenance still have
          to be recorded before anyone can read it.
        </p>

        {decided === 'accepted' || decided === 'rejected' ? (
          <div className="mb-8">
            <Banner tone="verified" title="Recorded">
              <p>
                {decided === 'accepted'
                  ? 'Accepted for curation. Record its licence before publishing it — a submission is a request to consider, not a way past LIB-06.'
                  : 'Rejected, with the reason recorded. The contributor has been told verbatim.'}
              </p>
            </Banner>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState heading="Nothing waiting">
            Papers submitted from the Resource Centre arrive here. Students and faculty can offer
            work; nobody can publish it themselves.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-6 p-0">
            {rows.map(({ item, submitter }) => (
              <Record
                as="li"
                key={item.id}
                title={item.title}
                meta={`${[item.authors, item.year].filter(Boolean).join(' · ')} · submitted by ${
                  submitter?.fullName ?? submitter?.email ?? 'someone since deleted'
                } on ${item.createdAt.toLocaleDateString('en-NG')}`}
              >
                {item.abstract ? (
                  <p className="t-body-sm mt-0 mb-4 whitespace-pre-line text-ink-900">
                    {item.abstract}
                  </p>
                ) : null}

                <div className="mb-5">
                  <Panel title="What they attached">
                    <p className="t-body-sm m-0 text-ink-700">
                      {item.objectKey ? 'A file is attached.' : 'No file.'}{' '}
                      {item.externalUrl ? (
                        <>
                          Published at{' '}
                          <a
                            href={item.externalUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                            className="break-all text-ink-900 underline underline-offset-2"
                          >
                            {item.externalUrl}
                          </a>
                          .
                        </>
                      ) : null}
                    </p>
                    <p className="t-caption mt-3 mb-0 text-ink-700">{item.sourceAttribution}</p>
                  </Panel>
                </div>

                <SubmissionDecision itemId={item.id} />
              </Record>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
