import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';
import { recordSearch } from '@/modules/library/search-log';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { EmptyState, Input, LicenceBadge, Panel, Record, cx } from '@/components/ui';

/**
 * LB-01 E-Library search (LIB-01, LIB-02).
 *
 * Search is Postgres full-text at v1 (§7.2). That is enough for a few hundred
 * curated items, and Typesense earns its place once the corpus grows and
 * faceted legal search starts to matter — the query below is deliberately the
 * only thing that would need to change.
 *
 * LIB-08: alumni retain access, so this is gated on a session rather than on
 * an active enrollment.
 *
 * §5.2 search input: 56px tall, submit on enter, and the result count is
 * announced rather than only shown.
 */
export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; jurisdiction?: string; type?: string }>;
}) {
  await requireUser();
  const { q, jurisdiction, type } = await searchParams;

  const filters: SQL[] = [eq(libraryItems.status, 'published')];
  if (q) {
    // Title and citation matched directly; `full_text` is what the OCR worker
    // populates, and it is where the value is — Nigerian judgments are
    // overwhelmingly scanned PDFs, so without extraction a search over them
    // silently returns nothing.
    filters.push(
      or(
        ilike(libraryItems.title, `%${q}%`),
        ilike(libraryItems.citation, `%${q}%`),
        ilike(libraryItems.abstract, `%${q}%`),
        sql`to_tsvector('english', coalesce(${libraryItems.fullText}, '')) @@ plainto_tsquery('english', ${q})`,
      )!,
    );
  }
  if (jurisdiction) filters.push(eq(libraryItems.jurisdiction, jurisdiction));
  if (type) filters.push(eq(libraryItems.instrumentType, type));

  const rows = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(and(...filters))
    .orderBy(desc(libraryItems.year))
    .limit(50);

  const facets = await db
    .select({
      jurisdiction: libraryItems.jurisdiction,
      instrumentType: libraryItems.instrumentType,
    })
    .from(libraryItems)
    .where(eq(libraryItems.status, 'published'));

  /*
   * LIB-02: the zero-result signal the empty state below promises is kept.
   * Recorded after the query rather than before it, because the count is the
   * half of the event that matters — and with no data subject attached, per
   * §6.3 and the table's own note.
   */
  if (q) {
    const inst = await currentInstitution();
    await recordSearch({
      query: q,
      institutionId: inst?.id ?? null,
      filters: { jurisdiction: jurisdiction ?? null, type: type ?? null },
      resultCount: rows.length,
    });
  }

  const jurisdictions = [...new Set(facets.map((f) => f.jurisdiction).filter(Boolean))].sort();
  const types = [...new Set(facets.map((f) => f.instrumentType).filter(Boolean))].sort();

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">E-Library</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Nigerian legislation, NDPC guidance and enforcement decisions, and privacy judgments. Every
          item states its source and its licence, and nothing is hosted that we do not have the right
          to host.
        </p>

        <form method="get" className="mt-8">
          <label htmlFor="q" className="t-label mb-2 block text-ink-900">
            Search the library
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="NDPA, consent, cross-border transfer…"
            className="h-14 text-lg"
          />
          {jurisdiction ? <input type="hidden" name="jurisdiction" value={jurisdiction} /> : null}
          {type ? <input type="hidden" name="type" value={type} /> : null}
        </form>

        <p className="t-body-sm mt-4 text-ink-700" role="status" aria-live="polite">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
          {q ? ` matching “${q}”` : ''}
        </p>

        <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr]">
          <Panel title="Narrow it down" className="self-start">
            <p className="t-label m-0 mb-2 text-ink-900">Jurisdiction</p>
            <ul className="m-0 mb-5 list-none space-y-1 p-0">
              {jurisdictions.map((j) => (
                <li key={j}>
                  <Link
                    href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), jurisdiction: j! }).toString()}`}
                    className={cx(
                      't-body-sm no-underline',
                      jurisdiction === j ? 'font-semibold text-ink-900' : 'text-ink-700',
                    )}
                  >
                    {j}
                  </Link>
                </li>
              ))}
            </ul>

            <p className="t-label m-0 mb-2 text-ink-900">Instrument</p>
            <ul className="m-0 list-none space-y-1 p-0">
              {types.map((t) => (
                <li key={t}>
                  <Link
                    href={`/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(jurisdiction ? { jurisdiction } : {}), type: t! }).toString()}`}
                    className={cx(
                      't-body-sm no-underline',
                      type === t ? 'font-semibold text-ink-900' : 'text-ink-700',
                    )}
                  >
                    {t}
                  </Link>
                </li>
              ))}
            </ul>

            {q || jurisdiction || type ? (
              <p className="t-body-sm mt-5 mb-0">
                <Link href="/library" className="text-ink-900 underline underline-offset-2">
                  Clear all filters
                </Link>
              </p>
            ) : null}
          </Panel>

          <div>
            {rows.length === 0 ? (
              <EmptyState heading="Nothing matches that yet">
                {/* §9: zero-result searches are what drive curation, so this
                    says so rather than treating the gap as the user's fault. */}
                Searches that return nothing are logged and reviewed by the curator — this is how the
                collection decides what to acquire next.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-5 p-0">
                {rows.map(({ item, licence }) => (
                  <Record
                    as="li"
                    key={item.id}
                    title={item.title}
                    meta={[item.citation, item.jurisdiction, item.year].filter(Boolean).join(' · ')}
                  >
                    {item.abstract ? (
                      <p className="t-body-sm mt-0 mb-4 text-ink-700">{item.abstract}</p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4">
                      <LicenceBadge downloadable={Boolean(licence?.allowsDownload)} />
                      <Link
                        href={`/library/${item.id}`}
                        className="t-body-sm font-semibold text-authority underline underline-offset-2"
                      >
                        {licence?.allowsHosting ? 'Read it here' : 'See the record'}
                      </Link>
                    </div>

                    {/* LIB-06: the attribution is visible on the item, not
                        buried in a policy page. */}
                    <p className="t-caption mt-4 mb-0 text-ink-700">{item.sourceAttribution}</p>
                  </Record>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
