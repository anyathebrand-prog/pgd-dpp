import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { facilitatorProfiles } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { getObject } from '@/lib/storage';

/**
 * The signed-in facilitator's own photograph, for the preview on "My
 * profile", published or not. Only ever their own: the key is read from
 * their profile, never from the request.
 */
export async function GET() {
  const me = await currentPrincipal();
  if (!me) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const [profile] = await db
    .select({ key: facilitatorProfiles.photoObjectKey })
    .from(facilitatorProfiles)
    .where(eq(facilitatorProfiles.userId, me.userId))
    .limit(1);
  if (!profile?.key) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = await getObject(profile.key);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': profile.key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
