'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences, readingNotes } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import type { FormState } from '../auth/actions';

/**
 * LB-03 — a reader's own highlights and notes (LIB-03).
 *
 * Every action here is scoped by `userId` as well as by id. These are personal
 * notes on a shared catalogue: the row id is not a capability, and a reader
 * editing another reader's note by guessing an id would be the same failure as
 * reading their search history.
 */

/** The gate the reader page uses too: published, hosted, and a text layer. */
async function readable(itemId: string) {
  const [row] = await db
    .select({ item: libraryItems, licence: licences })
    .from(libraryItems)
    .leftJoin(licences, eq(licences.id, libraryItems.licenceId))
    .where(eq(libraryItems.id, itemId))
    .limit(1);

  if (!row || row.item.status !== 'published') return null;
  if (!row.licence?.allowsHosting) return null;
  return row.item;
}

export async function saveHighlight(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const itemId = String(form.get('itemId') ?? '');
  const startOffset = Number(form.get('startOffset'));
  const endOffset = Number(form.get('endOffset'));
  const quote = String(form.get('quote') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();

  const item = await readable(itemId);
  if (!item) return { error: 'That item cannot be read here.' };

  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || endOffset <= startOffset) {
    return { error: 'Select some text before saving a note on it.' };
  }
  /*
   * Bounded by the document itself. An offset past the end of the text layer
   * could only come from a hand-made request, and it would render as a
   * highlight that can never be found again.
   */
  const length = item.fullText?.length ?? 0;
  if (startOffset < 0 || endOffset > length) {
    return { error: 'That selection is not inside this document.' };
  }
  if (quote.length === 0) return { error: 'Select some text before saving a note on it.' };
  if (note.length > 2000) return { error: 'Keep a note under two thousand characters.' };

  await db.insert(readingNotes).values({
    userId: me.userId,
    itemId,
    startOffset,
    endOffset,
    // Trimmed to what a note needs to show; the offsets are the anchor.
    quote: quote.slice(0, 500),
    note: note || null,
  });

  revalidatePath(`/library/${itemId}/read`);
  return { notice: 'Saved.' };
}

export async function updateNote(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const id = String(form.get('noteId') ?? '');
  const note = String(form.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Keep a note under two thousand characters.' };

  const [row] = await db
    .update(readingNotes)
    .set({ note: note || null, updatedAt: new Date() })
    // Scoped by user as well as id: the id is not a capability.
    .where(and(eq(readingNotes.id, id), eq(readingNotes.userId, me.userId)))
    .returning({ itemId: readingNotes.itemId });

  if (!row) return { error: 'That note is not yours to change.' };

  revalidatePath(`/library/${row.itemId}/read`);
  return { notice: 'Saved.' };
}

export async function deleteHighlight(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const id = String(form.get('noteId') ?? '');
  const [row] = await db
    .delete(readingNotes)
    .where(and(eq(readingNotes.id, id), eq(readingNotes.userId, me.userId)))
    .returning({ itemId: readingNotes.itemId });

  if (!row) return { error: 'That note is not yours to remove.' };

  /*
   * Deliberately no `revalidatePath` here.
   *
   * A confirmation cannot live inside the row it is confirming: revalidating
   * this path re-renders the margin and unmounts the note's own component —
   * including the effect that was about to navigate — so the note simply
   * vanished and nothing was ever said. The outcome travels in the URL
   * instead, and the navigation below is what refreshes the page.
   */
  return { redirectTo: `/library/${row.itemId}/read?removed=1` };
}
