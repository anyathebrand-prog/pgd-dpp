import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { Banner, DataString, Panel, StaffBand } from '@/components/ui';
import { ItemEditor, ItemFile, ItemStatus } from '@/components/curator-panels';
import { publishBlockers } from '@/modules/library/queries';

/**
 * CU-02 metadata and licence editor (LIB-05, LIB-06).
 *
 * The flow marks content class, licence and provenance as **mandatory,
 * blocking** for every single item, and that is what this screen enforces:
 * publishing is refused until both are recorded, and the licence decides
 * whether the item can carry a file at all.
 *
 * The order on the page follows the order of the decision. Description first,
 * because that is what a curator has in front of them; licence and source
 * next, under their own rule, because they are what determine whether any of
 * the rest can be shown to anyone.
 */
export default async function ItemEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole('curator', 'super_admin');

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);
  if (!row) notFound();

  const licenceOptions = await db.select().from(licences);
  const blockers = await publishBlockers(id);
  const { item, licence } = row;

  return (
    <div>
      <StaffBand institution="Platform" role="Library curator" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <p className="t-body-sm m-0">
          <Link href="/curate" className="text-ink-700 underline underline-offset-2">
            Back to the queue
          </Link>
        </p>

        <div className="mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="t-h1 measure m-0 text-ink-900">{item.title}</h1>
          <p className="t-caption m-0 text-ink-700">{item.status.replace(/_/g, ' ')}</p>
        </div>

        {item.status === 'taken_down' ? (
          <div className="mb-8">
            <Banner tone="warning" title="This item has been taken down">
              <p>
                Its page still exists and says so. A withdrawn item that 404s teaches a reader
                nothing and looks like a broken link rather than a decision.
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            <Panel title="The item">
              <ItemEditor
                item={{
                  id: item.id,
                  collection: item.collection,
                  title: item.title,
                  citation: item.citation ?? '',
                  authors: item.authors ?? '',
                  jurisdiction: item.jurisdiction ?? '',
                  instrumentType: item.instrumentType ?? '',
                  court: item.court ?? '',
                  year: item.year,
                  abstract: item.abstract ?? '',
                  subjectAreas: item.subjectAreas ?? [],
                  licenceId: item.licenceId,
                  sourceAttribution: item.sourceAttribution,
                  externalUrl: item.externalUrl ?? '',
                }}
                licenceOptions={licenceOptions.map((l) => ({
                  id: l.id,
                  code: l.code,
                  name: l.name,
                  allowsHosting: l.allowsHosting,
                }))}
              />
            </Panel>
          </div>

          <aside className="space-y-6">
            <Panel title="Publishing">
              <ItemStatus itemId={id} status={item.status} blockers={blockers} />
            </Panel>

            <Panel title="The file">
              <ItemFile
                itemId={id}
                filename={item.objectKey ? item.objectKey.split('/').pop() ?? null : null}
                hostingAllowed={Boolean(licence?.allowsHosting)}
              />
              {item.objectKey ? (
                <p className="t-caption mt-4 mb-0">
                  {/* The library's own file route, not the documents one:
                      that resolves keys against `documents` and would 404 for
                      everything in the corpus. */}
                  <a
                    href={`/api/library/${id}/file`}
                    className="text-ink-900 underline underline-offset-2"
                    target="_blank"
                    rel="noopener"
                  >
                    Open what is stored
                  </a>{' '}
                  · published items only
                </p>
              ) : null}
            </Panel>

            <Panel title="Licence in force">
              {licence ? (
                <>
                  <p className="t-body-sm mt-0 mb-2 font-semibold text-ink-900">{licence.name}</p>
                  <p className="t-body-sm mt-0 mb-3 text-ink-700">{licence.statement}</p>
                  <p className="t-caption m-0 text-ink-700">
                    Hosting {licence.allowsHosting ? 'permitted' : 'not permitted'} · download{' '}
                    {licence.allowsDownload ? 'permitted' : 'not permitted'} ·{' '}
                    <DataString value={licence.code} label="Licence code" />
                  </p>
                </>
              ) : (
                <p className="t-body-sm m-0 text-warning">
                  None recorded. Nothing about this item can be published until there is.
                </p>
              )}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
