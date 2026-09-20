import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, DataString, LicenceBadge, LinkButton, Panel } from '@/components/ui';

/**
 * LB-02 library item detail (LIB-06).
 *
 * Four states, and the fourth is the one that takes the thought: an item
 * withdrawn after a takedown claim shows a tombstone explaining that it was
 * removed. It does not 404. A reader who followed a citation deserves to know
 * the item existed and was taken down, rather than being left to conclude
 * that their link was wrong.
 *
 * LIB-08: alumni keep library access, so this is gated on a session rather
 * than on an active enrolment.
 */
export default async function LibraryItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);

  // A draft is not a thing a reader can have seen, so it is genuinely absent.
  if (!row || row.item.status === 'draft' || row.item.status === 'in_review') notFound();

  const { item, licence } = row;
  const withdrawn = item.status === 'taken_down';

  if (!withdrawn) {
    // LIB-07 curation feeds on this: an item nobody opens in a year is a
    // curation decision waiting to be made.
    await db
      .update(libraryItems)
      .set({ viewCount: sql`${libraryItems.viewCount} + 1` })
      .where(eq(libraryItems.id, id));
  }

  const hosted = Boolean(item.objectKey) && Boolean(licence?.allowsHosting);
  const downloadable = hosted && Boolean(licence?.allowsDownload);

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/library" className="text-ink-700 underline underline-offset-2">
            Back to the library
          </Link>
        </p>

        <h1 className="t-h1 measure mt-4 mb-0 text-ink-900">{item.title}</h1>
        <p className="t-body-sm mt-2 text-ink-700">
          {[item.authors, item.citation, item.court, item.year].filter(Boolean).join(' · ')}
        </p>

        {withdrawn ? (
          <div className="mt-8">
            {/* The tombstone. §5 is explicit: do not 404. */}
            <Banner tone="warning" title="This item has been withdrawn">
              <p>
                It was taken down following a claim about its licensing or its content, so it is no
                longer available here. The record is left in place deliberately — a citation that
                leads to a dead link tells a reader nothing about what happened.
              </p>
              <p className="mt-2">
                {item.externalUrl
                  ? 'The publisher may still hold it; the link below is where it lived.'
                  : 'If you believe it was withdrawn in error, the takedown contact is in the footer.'}
              </p>
            </Banner>
          </div>
        ) : null}

        {item.abstract && !withdrawn ? (
          <p className="t-read measure-read mt-8 whitespace-pre-line text-ink-900">
            {item.abstract}
          </p>
        ) : null}

        {!withdrawn ? (
          <div className="mt-10 flex flex-wrap items-center gap-4">
            {hosted ? (
              // LB-02's primary action is LB-03, not the file. The reader is
              // where highlighting and notes live, and it serves the file
              // itself for a scan with no text layer behind it.
              <LinkButton href={`/library/${id}/read`}>Read it here</LinkButton>
            ) : null}

            {downloadable ? (
              <LinkButton
                href={`/api/library/${id}/file`}
                variant="secondary"
                target="_blank"
                rel="noopener"
              >
                Download
              </LinkButton>
            ) : null}

            {item.externalUrl ? (
              // LB-04 rather than a direct link: the interstitial is what makes
              // the licensing boundary legible instead of looking like a
              // broken download.
              <LinkButton
                href={`/library/${id}/external`}
                variant={hosted ? 'secondary' : 'primary'}
              >
                Go to the source
              </LinkButton>
            ) : null}

            {!hosted && !item.externalUrl ? (
              <p className="t-body-sm m-0 text-ink-700">
                Metadata only — this item is catalogued here but held elsewhere.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-12 grid gap-6">
          <Panel title="Licence and source">
            {/* LIB-06: every item carries a visible source attribution and
                licence statement. Not in a footnote — here, with the item. */}
            <div className="mb-4">
              <LicenceBadge downloadable={Boolean(downloadable)} />
            </div>
            {licence ? (
              <>
                <p className="t-body-sm mt-0 mb-2 font-semibold text-ink-900">{licence.name}</p>
                <p className="t-body-sm mt-0 mb-4 text-ink-700">{licence.statement}</p>
              </>
            ) : null}
            <p className="t-caption m-0 text-ink-700">Source: {item.sourceAttribution}</p>
          </Panel>

          {item.subjectAreas?.length ? (
            <Panel title="Subjects">
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {item.subjectAreas.map((s) => (
                  <li key={s} className="t-caption rounded-sm bg-record px-2 py-1 text-ink-900">
                    {s}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Something wrong with this item?">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              If you hold rights in it, or it contains personal data about you, the takedown route
              is public and needs no account.
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
          Item <DataString value={item.id.slice(0, 8)} label="Item reference" />
          {me.status === 'alumni' ? ' · your library access continues as an alumnus.' : ''}
        </p>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
