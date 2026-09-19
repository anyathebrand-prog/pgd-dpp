import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { EmptyState, Input, LicenceBadge, LinkButton, Panel, Record, cx } from '@/components/ui';

/**
 * RC-01 Resource Centre search (RES-01, RES-02).
 *
 * The same corpus table as the E-Library, filtered to the research
 * collection. They are two reading rooms rather than two libraries: a
 * judgment and a paper about that judgment are catalogued the same way,
 * carry licences the same way, and are taken down the same way — and one
 * ingest pipeline that serves both is the only version of this that a single
 * curator can keep current.
 *
 * LIB-08: alumni keep access, so the gate is a session rather than an
 * enrolment.
 */
export default async function ResourceCentre({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; author?: string; year?: string; type?: string }>;
}) {
  await requireUser();
  const { q, author, year, type } = await searchParams;

  const filters: SQL[] = [
    eq(libraryItems.status, 'published'),
    eq(libraryItems.collection, 'resource_centre'),
  ];

  if (q) {
    filters.push(
      or(
        ilike(libraryItems.title, `%${q}%`),
        ilike(libraryItems.abstract, `%${q}%`),
        ilike(libraryItems.authors, `%${q}%`),
        sql`to_tsvector('english', coalesce(${libraryItems.fullText}, '')) @@ plainto_tsquery('english', ${q})`,
      )!,
    );
  }
  if (author) filters.push(ilike(libraryItems.authors, `%${author}%`));
  if (year) filters.push(eq(libraryItems.year, Number(year)));
  if (type) filters.push(eq(libraryItems.instrumentType, type));

  const rows = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(and(...filters))
    .orderBy(desc(libraryItems.year), desc(libraryItems.createdAt))
    .limit(50);

  const facets = await db
    .select({ year: libraryItems.year, instrumentType: libraryItems.instrumentType })
    .from(libraryItems)
    .where(
      and(
        eq(libraryItems.status, 'published'),
        eq(libraryItems.collection, 'resource_centre'),
      ),
    );

  const years = [...new Set(facets.map((f) => f.year).filter(Boolean))].sort((a, b) => b! - a!);
  const types = [...new Set(facets.map((f) => f.instrumentType).filter(Boolean))].sort();

  const keep = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(q ? { q } : {}),
      ...(author ? { author } : {}),
      ...(year ? { year } : {}),
      ...(type ? { type } : {}),
      ...extra,
    }).toString();

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Resource Centre</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Research papers on data protection and privacy. Where a licence allows it the paper is
          here; where it does not, the record is here and the paper is one click away at its
          publisher.
        </p>

        <form method="get" className="mt-8">
          <label htmlFor="q" className="t-label mb-2 block text-ink-900">
            Search papers
          </label>
          <div className="flex flex-wrap gap-3">
            <Input
              id="q"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Title, author, abstract or full text"
              className="h-14 max-w-[480px]"
            />
            <button
              type="submit"
              className="motion-state inline-flex h-14 items-center rounded-sm bg-authority px-5 font-semibold text-surface"
            >
              Search
            </button>
          </div>
        </form>

        <p className="t-body-sm mt-4 text-ink-700" role="status" aria-live="polite">
          {rows.length} {rows.length === 1 ? 'paper' : 'papers'}
          {q ? ` matching “${q}”` : ''}
        </p>

        <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr]">
          <Panel title="Narrow it down" className="self-start">
            <p className="t-label m-0 mb-2 text-ink-900">Year</p>
            <ul className="m-0 mb-5 list-none space-y-1 p-0">
              {years.map((y) => (
                <li key={y}>
                  <Link
                    href={`/resources?${keep({ year: String(y) })}`}
                    className={cx(
                      't-body-sm no-underline',
                      year === String(y) ? 'font-semibold text-ink-900' : 'text-ink-700',
                    )}
                  >
                    {y}
                  </Link>
                </li>
              ))}
              {years.length === 0 ? <li className="t-body-sm text-ink-700">—</li> : null}
            </ul>

            <p className="t-label m-0 mb-2 text-ink-900">Document type</p>
            <ul className="m-0 list-none space-y-1 p-0">
              {types.map((t) => (
                <li key={t}>
                  <Link
                    href={`/resources?${keep({ type: t! })}`}
                    className={cx(
                      't-body-sm no-underline',
                      type === t ? 'font-semibold text-ink-900' : 'text-ink-700',
                    )}
                  >
                    {t}
                  </Link>
                </li>
              ))}
              {types.length === 0 ? <li className="t-body-sm text-ink-700">—</li> : null}
            </ul>

            {q || author || year || type ? (
              <p className="t-body-sm mt-5 mb-0">
                <Link href="/resources" className="text-ink-900 underline underline-offset-2">
                  Clear all filters
                </Link>
              </p>
            ) : null}

            <div className="mt-6 border-t border-ink-300 pt-5">
              <p className="t-body-sm mt-0 mb-3 text-ink-700">
                Written something relevant? Faculty and students can offer a paper for the
                collection.
              </p>
              <LinkButton href="/resources/submit" size="dense" variant="secondary">
                Submit a paper
              </LinkButton>
            </div>
          </Panel>

          <div>
            {rows.length === 0 ? (
              <EmptyState
                heading="Nothing here yet"
                action={<LinkButton href="/resources/submit">Submit a paper</LinkButton>}
              >
                The Resource Centre grows by curation and by contribution. Searches that return
                nothing are what tell the curator what to acquire next.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-5 p-0">
                {rows.map(({ item, licence }) => (
                  <Record
                    as="li"
                    key={item.id}
                    title={item.title}
                    meta={[item.authors, item.year, item.instrumentType]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    {item.abstract ? (
                      <p className="t-body-sm mt-0 mb-4 text-ink-700">
                        {item.abstract.slice(0, 240)}
                        {item.abstract.length > 240 ? '…' : ''}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4">
                      <LicenceBadge downloadable={Boolean(licence?.allowsDownload)} />
                      <Link
                        href={`/resources/${item.id}`}
                        className="t-body-sm font-semibold text-authority underline underline-offset-2"
                      >
                        Open the record
                      </Link>
                    </div>
                  </Record>
                ))}
              </ul>
            )}

            <p className="t-body-sm mt-8">
              <Link href="/resources/saved" className="text-ink-700 underline underline-offset-2">
                Your reading list
              </Link>
            </p>
          </div>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
