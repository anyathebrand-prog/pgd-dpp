'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bookmarks, libraryItems } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { putObject, uploadProblem } from '@/lib/storage';
import type { FormState } from '../auth/actions';

/**
 * What a reader can do to the corpus: keep a bookmark, and offer a paper.
 *
 * Separate from the curator's actions because the authority is different. A
 * curator decides what the library holds; a reader decides what they are
 * reading and what they would like considered. Nothing here publishes
 * anything.
 */

/** RES-06. */
export async function toggleBookmark(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const itemId = String(form.get('itemId') ?? '');

  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item || item.status !== 'published') return { error: 'That item is not available.' };

  const existing = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, me.userId), eq(bookmarks.itemId, itemId)))
    .returning({ id: bookmarks.id });

  if (existing.length > 0) {
    revalidatePath('/resources/saved');
    return { notice: 'Removed from your reading list.' };
  }

  await db.insert(bookmarks).values({ userId: me.userId, itemId });
  revalidatePath('/resources/saved');
  return { notice: 'Saved to your reading list.' };
}

/**
 * RES-04 / RC-03 — a student or faculty member offers a paper.
 *
 * §5.7 permits faculty-authored works "with author licence", and the flow
 * makes a contributor licence agreement part of this screen for exactly that
 * reason. So the declaration is not a checkbox for form's sake: it is the
 * document that makes hosting the paper lawful, and without it the submission
 * does not exist.
 *
 * It lands as `in_review`, never published. CU-03 is where a curator decides,
 * and a contributor cannot put anything in front of students by themselves.
 */
export async function submitPaper(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const title = String(form.get('title') ?? '').trim();
  const authors = String(form.get('authors') ?? '').trim();
  const yearRaw = String(form.get('year') ?? '').trim();
  const abstract = String(form.get('abstract') ?? '').trim();
  const externalUrl = String(form.get('externalUrl') ?? '').trim();
  const declared = form.get('declaration') === 'on';
  const file = form.get('file');

  if (title.length < 5) return { error: 'Give the paper its title.' };
  if (authors.length < 2) return { error: 'Name the authors, in the order they appear on it.' };
  if (abstract.length < 40) {
    return { error: 'Write an abstract. A curator decides from it, and so does every reader after.' };
  }
  if (!declared) {
    return {
      error:
        'The contributor licence has to be agreed. Without it we have no right to host the paper, which is the whole reason this form asks.',
    };
  }

  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1)) {
    return { error: 'Give a four-digit year, or leave it blank.' };
  }

  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !externalUrl) {
    return { error: 'Attach the paper, or give a link to where it is published.' };
  }
  if (hasFile) {
    const problem = uploadProblem(file);
    if (problem) return { error: problem };
  }

  const [created] = await db
    .insert(libraryItems)
    .values({
      collection: 'resource_centre',
      title,
      authors,
      year,
      abstract,
      externalUrl: externalUrl || null,
      // The submitter's own words about where it came from, which the curator
      // will check before anything is published.
      sourceAttribution: `Submitted by ${me.fullName ?? me.email} under the contributor licence.`,
      submittedBy: me.userId,
      status: 'in_review',
    })
    .returning({ id: libraryItems.id });

  if (hasFile) {
    const key = `library/${created.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await putObject(key, Buffer.from(await file.arrayBuffer()));
    await db.update(libraryItems).set({ objectKey: key }).where(eq(libraryItems.id, created.id));
  }

  await audit({
    action: 'library.paper_submitted',
    actorId: me.userId,
    actorRole: 'self',
    subjectId: me.userId,
    entity: 'library_items',
    entityId: created.id,
    detail: { title, contributorLicence: true },
  });

  revalidatePath('/curate');
  return { redirectTo: '/resources/submit?sent=1' };
}

/** CU-03. A curator's decision on a submission. */
export async function decideSubmission(_prev: FormState, form: FormData): Promise<FormState> {
  const { requireRole } = await import('@/lib/auth');
  const me = await requireRole('curator', 'super_admin');

  const itemId = String(form.get('itemId') ?? '');
  const decision = String(form.get('decision') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  if (decision === 'reject' && reason.length < 10) {
    return { error: 'Say why. The contributor is told verbatim, and a bare refusal teaches nobody anything.' };
  }

  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item || item.status !== 'in_review') return { error: 'That submission is no longer open.' };

  if (decision === 'accept') {
    // Accepting moves it to draft, not to published: the licence and
    // provenance still have to be recorded, and CU-02 is where that happens.
    // A submission is a request to consider, not a queue-jump past LIB-06.
    await db.update(libraryItems).set({ status: 'draft' }).where(eq(libraryItems.id, itemId));
    await audit({
      action: 'library.submission_accepted',
      actorId: me.userId,
      actorRole: 'curator',
      entity: 'library_items',
      entityId: itemId,
    });
    /*
     * No revalidatePath here, deliberately.
     *
     * Revalidating this path re-renders the queue as part of the action's
     * response, the decided row leaves the list, and the component that was
     * going to report the outcome unmounts before its effect can run — so
     * the curator sees the row vanish and nothing else. The client navigates
     * to a URL carrying the outcome instead, which fetches fresh data anyway.
     */
    return { notice: 'Accepted for curation. Record its licence before publishing it.' };
  }

  await db
    .update(libraryItems)
    .set({ status: 'taken_down', sourceAttribution: `${item.sourceAttribution} Rejected: ${reason}` })
    .where(eq(libraryItems.id, itemId));

  await audit({
    action: 'library.submission_rejected',
    actorId: me.userId,
    actorRole: 'curator',
    entity: 'library_items',
    entityId: itemId,
    detail: { reason },
  });

  // Same reason as above: the navigation is what refreshes this queue.
  return { notice: 'Rejected, with the reason recorded.' };
}
