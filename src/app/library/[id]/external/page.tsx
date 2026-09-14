import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { Footer, TopBar } from '@/components/shell';
import { Banner, LinkButton, Panel } from '@/components/ui';

/**
 * LB-04 link-out interstitial (LIB-02, LIB-06).
 *
 * §5 gives this screen an unusual and correct purpose: it exists "to make the
 * licensing boundary legible to students rather than looking like a broken
 * download". A student who clicks a paper and lands on a publisher's paywall
 * with no explanation concludes the library is broken or that the programme
 * is cheap. A sentence saying we are not allowed to host this one, and why,
 * turns the same click into a lesson about the thing they are studying.
 */
export default async function LinkOut({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);

  if (!row || !row.item.externalUrl || row.item.status === 'draft') notFound();
  const { licence } = row;
  // Narrowed here rather than asserted at the call site: the guard above is
  // what makes the link real, and TypeScript should be told so once.
  const item = { ...row.item, externalUrl: row.item.externalUrl };

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-12">
        <p className="t-body-sm m-0">
          <Link href={`/library/${id}`} className="text-ink-700 underline underline-offset-2">
            Back to the item
          </Link>
        </p>

        <h1 className="t-h1 measure mt-4 text-ink-900">This one lives somewhere else</h1>

        <p className="t-body measure mt-4 text-ink-700">
          <strong className="text-ink-900">{item.title}</strong> is catalogued here, but we do not
          host it.{' '}
          {licence && !licence.allowsHosting
            ? `Its licence — ${licence.name} — does not permit us to.`
            : 'It is held by its publisher.'}
        </p>

        <div className="mt-8">
          <Banner tone="info" title="Why the library works this way">
            <p>
              Most academic books and journal articles are copyrighted. A data protection programme
              distributing material it has no licence for would be teaching one thing and doing
              another — so the catalogue records what exists, and links to it where it lawfully
              lives.
            </p>
          </Banner>
        </div>

        <div className="mt-10">
          <Panel title="Where it is">
            <p className="t-body-sm mt-0 mb-4 break-all text-ink-700">{item.externalUrl}</p>
            <LinkButton href={item.externalUrl} target="_blank" rel="noopener noreferrer">
              Continue to the publisher
            </LinkButton>
            <p className="t-caption mt-4 mb-0 text-ink-700">
              Opens in a new tab. Your institution may already have a subscription — it is worth
              asking the library before paying for a single article.
            </p>
          </Panel>
        </div>

        <p className="t-caption mt-10 text-ink-700">Source: {item.sourceAttribution}</p>
      </main>
      <Footer />
    </>
  );
}
