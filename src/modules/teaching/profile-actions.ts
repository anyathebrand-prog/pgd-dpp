'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { facilitatorProfiles } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { imageSize } from '@/lib/image';
import { MAX_UPLOAD_BYTES, putObject } from '@/lib/storage';
import type { FormState } from '../auth/actions';

/**
 * A facilitator's own public profile (the Faculty page).
 *
 * Only the facilitator writes it, and only they publish it. The photograph
 * is checked by its bytes (JPEG or PNG, at least 300px each way); each new
 * one gets a new key, so a replaced photograph stops being served at once.
 */

const MIN_SIDE = 300;

function imageKind(bytes: Buffer): 'jpg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

export async function saveFacilitatorProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('facilitator');

  const title = String(form.get('title') ?? '').trim();
  const bio = String(form.get('bio') ?? '').trim();
  const published = form.get('published') === 'on';
  const photo = form.get('photo');

  if (title.length > 120) return { error: 'Keep the title line under 120 characters.' };
  if (bio.length > 2000) return { error: 'Keep the profile under 2,000 characters: about 300 words.' };
  if (published && bio.length < 80) {
    return { error: 'Write at least a few sentences before publishing: 80 characters or more.' };
  }

  let photoObjectKey: string | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_UPLOAD_BYTES) return { error: 'That photograph is over 5MB. Save it smaller and try again.' };
    const bytes = Buffer.from(await photo.arrayBuffer());
    const kind = imageKind(bytes);
    if (!kind) return { error: 'Upload the photograph as a JPG or PNG.' };
    const size = imageSize(bytes);
    if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) {
      return { error: `The photograph needs to be at least ${MIN_SIDE} pixels wide and tall.` };
    }
    photoObjectKey = `faculty/${me.userId}/${Date.now()}.${kind}`;
    await putObject(photoObjectKey, bytes);
  }

  // `facilitator_profiles` is shared (a person, not a tenant), so a plain write.
  const values = { title: title || null, bio: bio || null, published, ...(photoObjectKey ? { photoObjectKey } : {}) };
  await db
    .insert(facilitatorProfiles)
    .values({ userId: me.userId, ...values })
    .onConflictDoUpdate({ target: facilitatorProfiles.userId, set: { ...values, updatedAt: new Date() } });

  await audit({
    action: 'faculty.profile_saved',
    actorId: me.userId,
    actorRole: 'facilitator',
    entity: 'facilitator_profiles',
    entityId: me.userId,
    subjectId: me.userId,
    detail: { published, photoChanged: Boolean(photoObjectKey) },
  });

  return { redirectTo: `/teach/profile?saved=${published ? 'public' : 'private'}` };
}

export async function removeFacilitatorPhoto(_prev: FormState): Promise<FormState> {
  const me = await requireRole('facilitator');
  await db
    .update(facilitatorProfiles)
    .set({ photoObjectKey: null, updatedAt: new Date() })
    .where(eq(facilitatorProfiles.userId, me.userId));
  return { redirectTo: '/teach/profile?saved=photo-removed' };
}
