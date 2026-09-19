import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bookmarks, libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { EmptyState, LicenceBadge, LinkButton, Record } from '@/components/ui';

/**
 * RC-04 reading list (RES-06).
 *
 * Saved searches are not built; bookmarks are, and they are the half people
 * actually use. The empty state says what the list is for rather than
 * apologising for being empty — §5.6 asks for a heading, one sentence and an
 * action, which is exactly what a new reader needs here.
 */
export default async function ReadingList() {
  const me = await requireUser();

  const rows = await db
    .select({ item: libraryItems, licence: licences, savedAt: bookmarks.createdAt })
    .from(bookmarks)
    .innerJoin(libraryItems, eq(libraryItems.id, bookmarks.itemId))
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(bookmarks.userId, me.userId))
    .orderBy(desc(bookmarks.createdAt));

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Your reading list</h1>
        <p className="t-body mt-3 mb-8 text-ink-700">
          Items you saved, newest first. It is yours alone — nobody at your institution sees it.
        </p>

        {rows.length === 0 ? (
          <EmptyState
            heading="Nothing saved yet"
            action={<LinkButton href="/resources">Browse the Resource Centre</LinkButton>}
          >
            Saving an item keeps it here across sessions and after you graduate, which is when a
            reading list starts being worth having.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {rows.map(({ item, licence, savedAt }) => (
              <Record
                as="li"
                key={item.id}
                title={item.title}
                meta={`${[item.authors, item.year].filter(Boolean).join(' · ')} · saved ${savedAt.toLocaleDateString('en-NG')}`}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <LicenceBadge downloadable={Boolean(licence?.allowsDownload)} />
                  <Link
                    href={
                      item.collection === 'resource_centre'
                        ? `/resources/${item.id}`
                        : `/library/${item.id}`
                    }
                    className="t-body-sm font-semibold text-authority underline underline-offset-2"
                  >
                    Open it
                  </Link>
                  {item.status === 'taken_down' ? (
                    <span className="t-caption text-warning">Withdrawn since you saved it</span>
                  ) : null}
                </div>
              </Record>
            ))}
          </ul>
        )}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
