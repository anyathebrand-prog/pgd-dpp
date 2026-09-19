'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { documentQueries, documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { documentKey, putObject, uploadProblem } from '@/lib/storage';
import { imageSize, photoProblem } from '@/lib/image';
import { getOrCreateApplication } from './application';
import type { FormState } from '../auth/actions';

/**
 * AP-06 passport photograph (APP-05).
 *
 * The cropping happens in the browser, on a canvas, and what arrives here is
 * the cropped result. The dimension check is repeated on these bytes anyway:
 * the crop tool is a courtesy to the candidate, and a form post is whatever
 * the person sending it decides it is. A photograph that cannot be printed at
 * 35×45mm is one the registry discovers at ID-card time, long after the
 * candidate has stopped reading their email.
 *
 * §6.4: this photograph is used for the ID card, exam identity and the
 * certificate — and explicitly not for facial recognition. The flow asks for
 * that to be stated where the person is, not only in the privacy notice, so
 * the page says it too.
 */
const EDITABLE = new Set(['draft', 'awaiting_application_fee', 'documents_queried']);

export async function savePassportPhoto(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  if (!app) return { error: 'There is no open intake to apply to at the moment.' };
  if (!EDITABLE.has(app.status)) {
    return { error: 'Documents can no longer be changed on this application.' };
  }

  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'Choose a photograph first.' };

  const problem = uploadProblem(file);
  if (problem) return { error: problem };

  const bytes = Buffer.from(await file.arrayBuffer());
  const size = imageSize(bytes);
  const unusable = photoProblem(size);
  if (unusable) return { error: unusable };

  const key = documentKey(institution.id, app.id, 'passport_photo', 'passport.jpg');
  await putObject(key, bytes);

  await withTenant(institution.id, async (tx) => {
    // Originals are immutable here too: a re-crop supersedes rather than
    // overwrites, so what the registry saw at each point stays on the record.
    await tx
      .update(documents)
      .set({ status: 'rejected' })
      .where(and(eq(documents.applicationId, app.id), eq(documents.kind, 'passport_photo')));

    await tx.insert(documents).values({
      institutionId: institution.id,
      applicationId: app.id,
      kind: 'passport_photo',
      objectKey: key,
      filename: 'passport.jpg',
      contentType: file.type || 'image/jpeg',
      sizeBytes: bytes.byteLength,
      scanStatus: 'pending',
      status: 'uploaded',
    });

    await tx
      .update(documentQueries)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(documentQueries.applicationId, app.id),
          eq(documentQueries.documentKind, 'passport_photo'),
        ),
      );
  });

  await audit({
    action: 'document.uploaded',
    institutionId: institution.id,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'documents',
    entityId: app.id,
    detail: { kind: 'passport_photo', bytes: bytes.byteLength, width: size?.width, height: size?.height },
  });

  revalidatePath('/apply/documents');
  return { redirectTo: '/apply/documents?photo=saved' };
}
