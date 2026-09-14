import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences, takedownRequests } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { Banner, EmptyState, Panel, Record, StaffBand, cx } from '@/components/ui';
import { ItemEditor } from '@/components/curator-panels';

/**
 * CU-01 curator console (LIB-05, LIB-09).
 *
 * §5.7's recommendation is 300–500 high-quality items curated by a qualified
 * practitioner, not 50,000 scraped files — so this screen is built for
 * someone working through a queue deliberately, not for bulk throughput.
 *
 * It leads with drafts rather than with the published count, because an item
 * sitting unpublished is work someone started and an item published is work
 * that is done. Bulk ingestion (LIB-09) is not built; when it is, it lands
 * here as a queue rather than as a different console.
 */
export default async function CuratorConsole() {
  await requireRole('curator', 'super_admin');

  const items = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .orderBy(desc(libraryItems.updatedAt))
    .limit(100);

  const licenceOptions = await db.select().from(licences);

  const claims = await db
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.status, 'received'))
    .orderBy(desc(takedownRequests.createdAt))
    .limit(5);

  const byStatus = (status: string) => items.filter((r) => r.item.status === status);
  const drafts = [...byStatus('draft'), ...byStatus('in_review')];
  const published = byStatus('published');
  const down = byStatus('taken_down');

  return (
    <div>
      <StaffBand institution="Platform" role="Library curator" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Curating the library</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Every item carries a licence and a source, and neither is optional. An item without both
          cannot be published — which is the whole of how this platform stays on the right side of
          §5.7.
        </p>

        {claims.length > 0 ? (
          <div className="mt-8">
            <Banner tone="warning" title={`${claims.length} takedown claim${claims.length === 1 ? '' : 's'} waiting`}>
              <p>
                Claims come in from the public form. The Data Protection Officer is copied on all of
                them and they are listed in{' '}
                <Link href="/dpo/evidence" className="text-ink-900 underline underline-offset-2">
                  the compliance console
                </Link>
                .
              </p>
            </Banner>
          </div>
        ) : null}

        <p className="t-body-sm mt-6">
          <Link href="/curate/submissions" className="text-ink-900 underline underline-offset-2">
            Papers contributed by students and faculty
          </Link>
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <h2 className="t-h2 m-0 mb-4 text-ink-900">
              In progress {drafts.length > 0 ? `(${drafts.length})` : ''}
            </h2>

            {drafts.length === 0 ? (
              <EmptyState heading="Nothing in progress">
                Items you add start here as drafts, and stay there until their licence and source
                are recorded.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-4 p-0">
                {drafts.map(({ item, licence }) => (
                  <Record
                    as="li"
                    key={item.id}
                    title={item.title}
                    meta={`${item.collection === 'library' ? 'E-Library' : 'Resource Centre'} · ${item.status.replace(/_/g, ' ')}`}
                  >
                    <p
                      className={cx(
                        't-body-sm mt-0 mb-4',
                        licence ? 'text-ink-700' : 'text-warning',
                      )}
                    >
                      {licence
                        ? `${licence.name} — ${licence.allowsHosting ? 'may be hosted' : 'link only'}`
                        : 'No licence recorded. This cannot be published.'}
                    </p>
                    <Link
                      href={`/curate/${item.id}`}
                      className="t-body-sm font-semibold text-authority underline underline-offset-2"
                    >
                      Open it
                    </Link>
                  </Record>
                ))}
              </ul>
            )}

            <h2 className="t-h2 mt-12 mb-4 text-ink-900">Published ({published.length})</h2>
            <ul className="m-0 grid list-none gap-3 p-0">
              {published.map(({ item, licence }) => (
                <li key={item.id} className="border-b border-ink-300 pb-3">
                  <Link
                    href={`/curate/${item.id}`}
                    className="t-body-sm font-semibold text-ink-900 underline underline-offset-2"
                  >
                    {item.title}
                  </Link>
                  <p className="t-caption m-0 text-ink-700">
                    {[item.jurisdiction, item.instrumentType, item.year, licence?.code]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
              {published.length === 0 ? (
                <li className="t-body-sm text-ink-700">Nothing is published yet.</li>
              ) : null}
            </ul>

            {down.length > 0 ? (
              <>
                <h2 className="t-h2 mt-12 mb-4 text-ink-900">Taken down ({down.length})</h2>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {down.map(({ item }) => (
                    <li key={item.id} className="t-body-sm border-b border-ink-300 pb-3">
                      <Link
                        href={`/curate/${item.id}`}
                        className="text-ink-900 underline underline-offset-2"
                      >
                        {item.title}
                      </Link>
                      <span className="t-caption ml-2 text-ink-700">
                        — the page stays and explains why, rather than 404ing
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <aside>
            <Panel title="Add an item">
              <ItemEditor
                licenceOptions={licenceOptions.map((l) => ({
                  id: l.id,
                  code: l.code,
                  name: l.name,
                  allowsHosting: l.allowsHosting,
                }))}
              />
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
