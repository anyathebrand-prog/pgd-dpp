import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bookmarks, libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, DataString, LicenceBadge, LinkButton, Panel } from '@/components/ui';
import { BookmarkButton, CitationBlock } from '@/components/resource-panels';
import { citations } from '@/modules/library/citation';

/**
 * RC-02 resource item detail (RES-03, RES-05, RES-06).
 *
 * The same four availability states as LB-02, plus the two things a
 * researcher actually came for: a citation they can paste, and a way to keep
 * the paper where they will find it again.
 *
 * The citation is generated on the server from the metadata rather than typed
 * by a curator, so it cannot drift from the record it describes — and a
 * student is marked on it, which makes that worth more than it sounds.
 */
export default async function ResourceItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);

  if (!row || row.item.status === 'draft' || row.item.status === 'in_review') notFound();

  const { item, licence } = row;
  const withdrawn = item.status === 'taken_down';

  const [saved] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, me.userId), eq(bookmarks.itemId, id)))
    .limit(1);

  if (!withdrawn) {
    await db
      .update(libraryItems)
      .set({ viewCount: sql`${libraryItems.viewCount} + 1` })
      .where(eq(libraryItems.id, id));
  }

  const hosted = Boolean(item.objectKey) && Boolean(licence?.allowsHosting);
  const cite = citations({
    id: item.id,
    title: item.title,
    authors: item.authors,
    year: item.year,
    citation: item.citation,
    court: item.court,
    jurisdiction: item.jurisdiction,
    instrumentType: item.instrumentType,
    externalUrl: item.externalUrl,
  });

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/resources" className="text-ink-700 underline underline-offset-2">
            Back to the Resource Centre
          </Link>
        </p>

        <h1 className="t-h1 measure mt-4 mb-0 text-ink-900">{item.title}</h1>
        <p className="t-body-sm mt-2 text-ink-700">
          {[item.authors, item.year, item.instrumentType].filter(Boolean).join(' · ')}
        </p>

        {withdrawn ? (
          <div className="mt-8">
            <Banner tone="warning" title="This paper has been withdrawn">
              <p>
                It is no longer available here. The record stays so that a citation pointing at it
                leads somewhere that explains itself.
              </p>
            </Banner>
          </div>
        ) : null}

        {item.abstract ? (
          <p className="t-read measure-read mt-8 whitespace-pre-line text-ink-900">{item.abstract}</p>
        ) : null}

        {!withdrawn ? (
          <div className="mt-10 flex flex-wrap items-center gap-4">
            {hosted ? (
              <LinkButton href={`/api/library/${id}/file`} target="_blank" rel="noopener">
                {licence?.allowsDownload ? 'Download the paper' : 'Read it here'}
              </LinkButton>
            ) : null}
            {item.externalUrl ? (
              <LinkButton href={`/library/${id}/external`} variant={hosted ? 'secondary' : 'primary'}>
                Go to the publisher
              </LinkButton>
            ) : null}
            <BookmarkButton itemId={id} saved={Boolean(saved)} />
          </div>
        ) : null}

        <div className="mt-12 grid gap-6">
          <Panel title="Cite this">
            <CitationBlock citations={cite} />
            <p className="t-caption mt-4 mb-0 text-ink-700">
              Generated from the record, so it cannot drift from it. Check it against your
              department&apos;s house style before you submit — these are formatted citations, not a
              reference manager.
            </p>
          </Panel>

          <Panel title="Licence and source">
            <div className="mb-4">
              <LicenceBadge downloadable={Boolean(hosted && licence?.allowsDownload)} />
            </div>
            {licence ? (
              <>
                <p className="t-body-sm mt-0 mb-2 font-semibold text-ink-900">{licence.name}</p>
                <p className="t-body-sm mt-0 mb-4 text-ink-700">{licence.statement}</p>
              </>
            ) : null}
            <p className="t-caption m-0 text-ink-700">Source: {item.sourceAttribution}</p>
          </Panel>

          <Panel title="Something wrong with this paper?">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              A dead link, a misattribution, or a rights claim — all three go the same way, and the
              route needs no account.
            </p>
            <Link
              href={`/library/takedown?item=${id}`}
              className="t-body-sm text-ink-900 underline underline-offset-2"
            >
              Report this item
            </Link>
          </Panel>
        </div>

        <p className="t-caption mt-10 text-ink-700">
          Item <DataString value={item.id.slice(0, 8)} label="Item reference" /> ·{' '}
          {item.viewCount + 1} views
        </p>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
