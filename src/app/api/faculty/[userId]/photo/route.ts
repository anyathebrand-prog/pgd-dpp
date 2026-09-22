import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { facilitatorProfiles } from '@/db/schema';
import { getObject } from '@/lib/storage';

/**
 * A facilitator's photograph, for the public Faculty page.
 *
 * The one object in storage served without a signed link, because the page
 * it belongs on is public. It is served only while the profile is published:
 * unpublishing takes it offline on the next request, and a photograph that
 * was replaced is never served again (each upload is a new key, and only the
 * current key is ever looked up). Short caching, so unpublishing takes
 * effect within minutes even at a shared cache.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(userId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [profile] = await db
    .select({ key: facilitatorProfiles.photoObjectKey })
    .from(facilitatorProfiles)
    .where(and(eq(facilitatorProfiles.userId, userId), eq(facilitatorProfiles.published, true)))
    .limit(1);
  if (!profile?.key) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = await getObject(profile.key).catch(() => null);
  if (!body) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': profile.key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
