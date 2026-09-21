import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { lessons, modules } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { putObject, videoKey } from '@/lib/storage';
import { streamConfig, uploadToStream } from '@/modules/learning/stream';

/**
 * LRN-02 / FC-02 — attaching a video to a lesson.
 *
 * A route handler rather than a server action, and not for style: an action's
 * body is capped (6MB here, for APP-04's documents) and a lecture recording is
 * two orders of magnitude larger than that. Raising the action limit to fit
 * video would raise it for every form in the product, which is the wrong
 * trade — a 200MB body arriving at a text form is a denial of service with a
 * file picker.
 */

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const form = await request.formData();
  const lessonId = String(form.get('lessonId') ?? '');
  const file = form.get('file');
  const durationSeconds = Number(form.get('durationSeconds') ?? 0);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a video file.' }, { status: 400 });
  }
  if (file.type !== 'video/mp4') {
    return NextResponse.json(
      { error: 'Upload an MP4. It is the one format every phone in this market can play.' },
      { status: 415 },
    );
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB and the limit is 200MB. Export it at 720p — students are watching on phones over mobile data.`,
      },
      { status: 413 },
    );
  }

  // The lesson has to be one this facilitator's institution owns. RLS makes
  // that a matter of the row not being found rather than of a check here.
  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select({ lesson: lessons, facilitatorId: modules.facilitatorId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(lessons.id, lessonId))
      .limit(1),
  );
  if (!row) return NextResponse.json({ error: 'That lesson does not exist.' }, { status: 404 });

  // With Stream configured, the recording goes there to be transcoded into
  // an adaptive-bitrate ladder; otherwise it is stored as the MP4 it is.
  const stream = streamConfig();
  let uid: string;
  if (stream) {
    try {
      uid = await uploadToStream(stream, file, { institutionId: institution.id, lessonId });
    } catch (err) {
      return NextResponse.json(
        { error: `The video service did not accept the upload: ${(err as Error).message}. Try again shortly.` },
        { status: 502 },
      );
    }
  } else {
    uid = randomUUID();
    await putObject(videoKey(institution.id, uid), Buffer.from(await file.arrayBuffer()));
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(lessons)
      .set({
        videoUid: uid,
        videoProvider: stream ? 'cloudflare' : 'local',
        videoStatus: stream ? 'processing' : 'ready',
        videoDurationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds)
          : null,
      })
      .where(eq(lessons.id, lessonId)),
  );

  // The previous video, if any, is left in the store rather than deleted:
  // originals are immutable (§7.6), and a facilitator who replaces the wrong
  // lesson's recording should be recoverable by someone, not silently past
  // saving.
  await audit({
    action: 'lesson.video_attached',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'lessons',
    entityId: lessonId,
    detail: {
      uid,
      provider: stream ? 'cloudflare' : 'local',
      sizeBytes: file.size,
      replaced: row.lesson.videoUid ?? null,
    },
  });

  return NextResponse.json({ ok: true, uid });
}
