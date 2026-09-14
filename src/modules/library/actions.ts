'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { putObject, uploadProblem } from '@/lib/storage';
import { publishBlockers } from './queries';
import type { FormState } from '../auth/actions';

/**
 * LIB-05 / LIB-06 — curating the corpus.
 *
 * §5.7 is the blunt constraint this whole module is built around: we cannot
 * "search online and collect all books and articles" on data protection and
 * host them. Most academic books and journal articles are copyrighted, and a
 * data protection programme distributing pirated PDFs is not survivable —
 * reputationally or legally.
 *
 * So the licence is not metadata. It is the thing that decides whether an
 * item can be hosted at all, and CU-02 makes it blocking: nothing publishes
 * without a licence and a provenance statement, and an item whose licence
 * forbids hosting cannot carry a file however hard anyone tries.
 *
 * `library_items` is shared by design — the corpus is the same for every
 * institution — so these run as the platform curator rather than in a tenant
 * context.
 */

const COLLECTIONS = ['library', 'resource_centre'] as const;

export async function saveItem(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('curator', 'super_admin');

  const id = String(form.get('itemId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const collection = String(form.get('collection') ?? 'library') as (typeof COLLECTIONS)[number];
  const citation = String(form.get('citation') ?? '').trim();
  const authors = String(form.get('authors') ?? '').trim();
  const jurisdiction = String(form.get('jurisdiction') ?? '').trim();
  const instrumentType = String(form.get('instrumentType') ?? '').trim();
  const court = String(form.get('court') ?? '').trim();
  const yearRaw = String(form.get('year') ?? '').trim();
  const abstract = String(form.get('abstract') ?? '').trim();
  const subjectAreas = String(form.get('subjectAreas') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const licenceId = String(form.get('licenceId') ?? '').trim();
  const sourceAttribution = String(form.get('sourceAttribution') ?? '').trim();
  const externalUrl = String(form.get('externalUrl') ?? '').trim();

  if (title.length < 3) return { error: 'Give the item its real title.' };
  if (!COLLECTIONS.includes(collection)) return { error: 'Unknown collection.' };
  if (sourceAttribution.length < 8) {
    // LIB-06. "Where did this come from" is the question a takedown claim
    // starts with, and an item nobody can answer it for has to come down
    // whether or not the claim was good.
    return { error: 'Record where this came from. Every item has to carry its source.' };
  }

  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear() + 1)) {
    return { error: 'Give a four-digit year, or leave it blank.' };
  }

  const [licence] = licenceId
    ? await db.select().from(licences).where(eq(licences.id, licenceId)).limit(1)
    : [];

  if (licenceId && !licence) return { error: 'That licence does not exist.' };
  if (licence && !licence.allowsHosting && !externalUrl) {
    return {
      error: `The ${licence.name} licence does not allow hosting, so this item needs a link to where it actually lives.`,
    };
  }

  const values = {
    collection,
    title,
    citation: citation || null,
    authors: authors || null,
    jurisdiction: jurisdiction || null,
    instrumentType: instrumentType || null,
    court: court || null,
    year,
    abstract: abstract || null,
    subjectAreas: subjectAreas.length ? subjectAreas : null,
    licenceId: licenceId || null,
    sourceAttribution,
    externalUrl: externalUrl || null,
    updatedAt: new Date(),
  };

  if (id) {
    await db.update(libraryItems).set(values).where(eq(libraryItems.id, id));
    await audit({
      action: 'library.item_updated',
      actorId: me.userId,
      actorRole: 'curator',
      entity: 'library_items',
      entityId: id,
    });
    revalidatePath(`/curate/${id}`);
    return { notice: 'Saved.' };
  }

  const [created] = await db
    .insert(libraryItems)
    .values({ ...values, status: 'draft' })
    .returning({ id: libraryItems.id });

  await audit({
    action: 'library.item_created',
    actorId: me.userId,
    actorRole: 'curator',
    entity: 'library_items',
    entityId: created.id,
  });

  revalidatePath('/curate');
  return { redirectTo: `/curate/${created.id}` };
}

/** LIB-05. The file itself, for items whose licence permits hosting. */
export async function uploadItemFile(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('curator', 'super_admin');

  const id = String(form.get('itemId') ?? '');
  const file = form.get('file');

  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
  if (!item) return { error: 'That item does not exist.' };

  const [licence] = item.licenceId
    ? await db.select().from(licences).where(eq(licences.id, item.licenceId)).limit(1)
    : [];

  if (!licence) return { error: 'Record the licence before attaching a file.' };
  if (!licence.allowsHosting) {
    // The check that makes §5.7's promise real. Everything else about
    // licensing is a label; this is the line the file cannot cross.
    return {
      error: `The ${licence.name} licence does not permit hosting. This item can carry a link to the publisher, and nothing more.`,
    };
  }

  if (!(file instanceof File)) return { error: 'Choose a file.' };
  const problem = uploadProblem(file);
  if (problem) return { error: problem };

  const key = `library/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()));

  await db
    .update(libraryItems)
    .set({ objectKey: key, updatedAt: new Date() })
    .where(eq(libraryItems.id, id));

  await audit({
    action: 'library.file_attached',
    actorId: me.userId,
    actorRole: 'curator',
    entity: 'library_items',
    entityId: id,
    detail: { filename: file.name, licence: licence.code },
  });

  revalidatePath(`/curate/${id}`);
  return { notice: 'File attached.' };
}

export async function setItemStatus(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('curator', 'super_admin');

  const id = String(form.get('itemId') ?? '');
  const status = String(form.get('status') ?? '') as 'draft' | 'in_review' | 'published' | 'taken_down';

  if (!['draft', 'in_review', 'published', 'taken_down'].includes(status)) {
    return { error: 'Unknown status.' };
  }

  if (status === 'published') {
    const blockers = await publishBlockers(id);
    if (blockers.length > 0) return { error: blockers[0] };
  }

  await db.update(libraryItems).set({ status, updatedAt: new Date() }).where(eq(libraryItems.id, id));

  await audit({
    action: `library.item_${status}`,
    actorId: me.userId,
    actorRole: 'curator',
    entity: 'library_items',
    entityId: id,
  });

  revalidatePath(`/curate/${id}`);
  revalidatePath('/library');
  return {
    notice:
      status === 'published'
        ? 'Published. It is in the library now.'
        : status === 'taken_down'
          ? 'Taken down. The page stays and explains that it was withdrawn, rather than becoming a dead link.'
          : 'Status updated.',
  };
}
