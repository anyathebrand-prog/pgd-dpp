import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences, readingNotes } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, LinkButton, Panel } from '@/components/ui';
import { highlightsOnPage, pageForOffset, paginate, runs } from '@/modules/library/reader';
import { ReaderPage, ReadingNotes } from '@/components/reader';

/**
 * LB-03 document reader — `app./library/{id}/read` (LIB-03).
 *
 * Two modes, and which one a reader gets is decided by whether the OCR worker
 * has produced a text layer.
 *
 * With one, the text is paginated and readable here, and highlighting works
 * because there is something to anchor a highlight to. Without one — which is
 * the common case, since Nigerian judgments are overwhelmingly scanned PDFs —
 * the file itself is served and the page says plainly that highlighting is
 * unavailable and why. The flow is explicit about that: "highlighting degrades
 * — warn rather than silently failing". A reader who selects text in a scan
 * and finds nothing happens assumes the product is broken.
 */
export default async function ReaderRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; note?: string; removed?: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const { page: pageParam, note: focusNote, removed } = await searchParams;

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);

  if (!row) notFound();
  const { item, licence } = row;

  // LB-02's tombstone rule applies to the reader too: a withdrawn item
  // explains itself rather than 404ing.
  if (item.status === 'taken_down') {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
          <h1 className="t-h1 m-0 text-ink-900">{item.title}</h1>
          <div className="mt-6">
            <Banner tone="info" title="This item has been withdrawn">
              <p>
                It was removed from the collection following a takedown request. The record is kept
                so that a citation to it still resolves to an explanation rather than to nothing.
              </p>
            </Banner>
          </div>
          <p className="t-body-sm mt-8">
            <Link href="/library" className="text-ink-700 underline underline-offset-2">
              Back to the library
            </Link>
          </p>
        </main>
        <Footer />
      </>
    );
  }

  if (item.status !== 'published') notFound();

  // §5.7: the licence decides, here as well as in the curator console.
  const hosted = Boolean(item.objectKey) && Boolean(licence?.allowsHosting);
  if (!hosted) {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
          <h1 className="t-h1 m-0 text-ink-900">{item.title}</h1>
          <div className="mt-6">
            <Banner tone="info" title="This one is not hosted here">
              <p>
                Its licence does not allow us to hold a copy, so there is nothing to open in a
                reader. It is catalogued here and lives with its publisher.
              </p>
            </Banner>
          </div>
          <div className="mt-8 flex flex-wrap gap-4">
            <LinkButton href={`/library/${id}/external`}>Go to the source</LinkButton>
            <Link
              href={`/library/${id}`}
              className="t-body-sm self-center text-ink-700 underline underline-offset-2"
            >
              Back to the record
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const notes = await db
    .select()
    .from(readingNotes)
    .where(and(eq(readingNotes.itemId, id), eq(readingNotes.userId, me.userId)))
    .orderBy(asc(readingNotes.startOffset));

  const pages = paginate(item.fullText ?? '');
  const hasTextLayer = pages.length > 0;

  // A note linked from the margin takes the reader to its page.
  const focused = focusNote ? notes.find((n) => n.id === focusNote) : undefined;
  const requested = focused
    ? pageForOffset(pages, focused.startOffset)
    : Number(pageParam ?? '1');
  const current = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), Math.max(pages.length, 1));
  const page = pages[current - 1];

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <p className="t-caption m-0 text-ink-700">
          <Link href={`/library/${id}`} className="text-ink-700 underline underline-offset-2">
            Back to the record
          </Link>
        </p>
        <h1 className="t-h1 mt-2 mb-0 text-ink-900">{item.title}</h1>
        {item.citation ? (
          <p className="t-data mt-2 mb-0 text-ink-700">{item.citation}</p>
        ) : null}

        {removed ? (
          <div className="mt-6">
            <Banner tone="info" title="Note removed">
              <p>It is gone from your margin and from the text.</p>
            </Banner>
          </div>
        ) : null}

        {!hasTextLayer ? (
          <>
            <div className="mt-8">
              {/*
                The state the flow names: warn rather than silently failing.
                Somebody who selects text in a scan and sees nothing happen
                concludes the product is broken, not that the document is.
              */}
              <Banner tone="warning" title="Highlighting is not available for this document">
                <p>
                  This is a scan with no text layer behind it yet — the words on the page are
                  pixels, so there is nothing for a highlight to attach to. You can read and
                  download it below. Once it has been through text extraction, highlighting and
                  notes will work here and full-text search will find it.
                </p>
              </Banner>
            </div>

            <div className="mt-8">
              {/*
                Served through the licence-checked route, never a public URL.
                `object` rather than `iframe`: it degrades to its own fallback
                content when the browser has no PDF viewer.
              */}
              <object
                data={`/api/library/${id}/file`}
                type="application/pdf"
                className="h-[70vh] w-full rounded-sm border border-ink-500 bg-record"
                aria-label={`${item.title}, as a document`}
              >
                <p className="t-body-sm m-0 p-4 text-ink-700">
                  Your browser will not display this document inline.{' '}
                  <a
                    href={`/api/library/${id}/file`}
                    className="text-ink-900 underline underline-offset-2"
                  >
                    Open it in a new tab
                  </a>
                  .
                </p>
              </object>
            </div>
          </>
        ) : (
          <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
            <div>
              <ReaderPage
                itemId={id}
                pageStart={page.start}
                runs={runs(page, highlightsOnPage(notes, page))}
              />

              <nav
                aria-label="Pages"
                className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-ink-300 pt-4"
              >
                {current > 1 ? (
                  <Link
                    href={`/library/${id}/read?page=${current - 1}`}
                    className="t-body-sm text-ink-900 underline underline-offset-2"
                  >
                    ← Page {current - 1}
                  </Link>
                ) : (
                  <span />
                )}
                <p className="t-caption m-0 text-ink-700">
                  Page {current} of {pages.length}
                </p>
                {current < pages.length ? (
                  <Link
                    href={`/library/${id}/read?page=${current + 1}`}
                    className="t-body-sm text-ink-900 underline underline-offset-2"
                  >
                    Page {current + 1} →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            </div>

            <aside>
              <ReadingNotes
                itemId={id}
                notes={notes.map((n) => ({
                  id: n.id,
                  quote: n.quote,
                  note: n.note,
                  page: pageForOffset(pages, n.startOffset),
                }))}
              />
            </aside>
          </div>
        )}

        <div className="mt-12">
          <Panel title="Your notes are yours">
            <p className="t-body-sm m-0 text-ink-700">
              Highlights and notes on this document are visible only to you. Nobody at your
              institution or at the platform can read them, and they are not used to work out what
              you are researching.
            </p>
          </Panel>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
