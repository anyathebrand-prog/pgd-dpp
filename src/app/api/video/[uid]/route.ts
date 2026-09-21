import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { lessons, modules } from '@/db/schema';
import { videoAccess } from '@/modules/learning/video-access';
import { currentPrincipal } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { getObject, objectSize, videoKey } from '@/lib/storage';

/**
 * LRN-02 — lesson video.
 *
 * What this is: authenticated byte-range streaming from object storage, so a
 * player can seek and a phone can stop downloading when someone closes the
 * tab.
 *
 * What this is not: adaptive bitrate. That is Cloudflare Stream's job
 * (`modules/learning/stream.ts`), and a lesson uploaded while Stream is
 * configured never comes through here. This route is the fallback driver,
 * and the path for videos uploaded before Stream was switched on.
 *
 * Access is the same shape as CMP-13's rule for documents: the URL is not the
 * authorisation. A lesson video belongs to a module at an institution, and
 * only someone enrolled there — or teaching there — may read it.
 *
 * It needs no cross-tenant exemption. The request arrives on the institution's
 * own host, so the tenant resolves from Host the way every other request does
 * and the lookup runs inside `withTenant` — which also means a uid from
 * another institution finds nothing, as row-level security intends.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const { uid } = await params;

  const me = await currentPrincipal();
  if (!me) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const institution = await requireInstitution();

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select({ lesson: lessons, moduleId: modules.id, institutionId: modules.institutionId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(lessons.videoUid, uid))
      .limit(1),
  );
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const access = await videoAccess(me, row.institutionId);
  if (access === 'not_enrolled') return NextResponse.json({ error: 'Not yours to watch.' }, { status: 403 });
  if (access === 'payment_overdue') {
    return NextResponse.json(
      { error: 'A tuition payment is overdue. Lessons resume when it settles.' },
      { status: 402 },
    );
  }

  // A Stream video has no file here to serve; it plays from Stream.
  if (row.lesson.videoProvider !== 'local') {
    return NextResponse.json({ error: 'This video streams from the video service.' }, { status: 404 });
  }

  const key = videoKey(row.institutionId, uid);
  const size = await objectSize(key);
  if (size === null) {
    // The row says there is a video and the store disagrees. That is a content
    // problem for a facilitator, not a 500 for a student mid-lesson.
    return NextResponse.json({ error: 'This video is not available.' }, { status: 404 });
  }

  const range = request.headers.get('range');
  const common = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };

  if (range) {
    // A seek, or a player asking for the next chunk. Serving the whole file in
    // answer to a range request is what makes video on a slow connection feel
    // like it has hung.
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = Number(match?.[1] || 0);
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

    if (!Number.isFinite(start) || start >= size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...common, 'Content-Range': `bytes */${size}` },
      });
    }

    const chunk = (await getObject(key)).subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...common,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(chunk.length),
      },
    });
  }

  // CMP-14, but once per lesson rather than once per chunk: a player issues
  // dozens of range requests for one viewing, and an audit log that records
  // every one of them is a log nobody can read.
  await audit({
    action: 'lesson.video_opened',
    institutionId: row.institutionId,
    actorId: me.userId,
    actorRole: me.allMemberships.some(
      (m) =>
        m.institutionId === row.institutionId &&
        ['facilitator', 'institution_admin', 'super_admin'].includes(m.role),
    )
      ? 'staff'
      : 'self',
    entity: 'lessons',
    entityId: row.lesson.id,
  });

  const body = await getObject(key);
  return new NextResponse(new Uint8Array(body), {
    headers: { ...common, 'Content-Length': String(size) },
  });
}
