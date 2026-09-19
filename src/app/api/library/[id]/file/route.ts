import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getObject } from '@/lib/storage';

/**
 * The only way a library file is read (LIB-06, LIB-08, RES-03, RES-07).
 *
 * Not `/api/files`: that route resolves a key against the `documents` table
 * and exists to protect one applicant's degree certificate from another
 * applicant. A library item is a different thing with different rules — the
 * question is not "is this yours" but "does its licence let you have it" —
 * and pointing library links at the documents route produced a 404 for every
 * one of them.
 *
 * Three gates, in the order that matters:
 *
 *   1. a session (LIB-08: alumni keep access, so this is not enrolment),
 *   2. the item is published — a draft is not a thing a reader may open,
 *   3. the licence permits hosting. §5.7's whole point is that the licence
 *      decides, and it decides here as well as in the curator console.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const me = await currentPrincipal();
  if (!me) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, id))
    .limit(1);

  if (!row?.item.objectKey) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (row.item.status === 'taken_down') {
    // 410 rather than 404: it was here, and it was withdrawn. The item page
    // says the same thing in words.
    return NextResponse.json(
      { error: 'This item has been withdrawn following a claim.' },
      { status: 410 },
    );
  }
  if (row.item.status !== 'published') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  if (!row.licence?.allowsHosting) {
    return NextResponse.json(
      { error: 'This item is catalogued here but held by its publisher.' },
      { status: 403 },
    );
  }

  // RES-07. Counted for curation: an item nobody opens in a year is a
  // decision waiting to be made, and an item everyone opens is an argument
  // for acquiring more like it.
  await db
    .update(libraryItems)
    .set({ downloadCount: sql`${libraryItems.downloadCount} + 1` })
    .where(eq(libraryItems.id, id));

  await audit({
    action: 'library.file_opened',
    actorId: me.userId,
    actorRole: 'self',
    entity: 'library_items',
    entityId: id,
  });

  const body = await getObject(row.item.objectKey);
  const filename = row.item.objectKey.split('/').pop() ?? 'document.pdf';

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` where the licence allows reading but not download is the
      // honest default: a browser viewer rather than a save dialog. The
      // licence statement on the item page says which it is.
      'Content-Disposition': `${row.licence.allowsDownload ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
