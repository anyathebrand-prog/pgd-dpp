import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';

/**
 * Reads behind the curator console.
 *
 * Separate from the actions because every export of a 'use server' module is
 * a live endpoint, and these take ids rather than deriving everything from
 * the session.
 */

/**
 * CU-02's blocking rule, in one place.
 *
 * "Publishing is disabled until licence and provenance are recorded" — and a
 * hosted item with no file is the other half of it, because an item that
 * claims to be readable and is not wastes the reader's time and makes the
 * corpus look padded.
 */
export async function publishBlockers(itemId: string) {
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item) return ['That item does not exist.'];

  const [licence] = item.licenceId
    ? await db.select().from(licences).where(eq(licences.id, item.licenceId)).limit(1)
    : [];

  const missing: string[] = [];
  if (!licence) missing.push('Record the licence. Nothing publishes without one.');
  if (!item.sourceAttribution?.trim()) missing.push('Record where this came from.');

  if (licence?.allowsHosting && !item.objectKey && !item.externalUrl) {
    missing.push('Attach the file, or give a link to where it lives.');
  }
  if (licence && !licence.allowsHosting && !item.externalUrl) {
    missing.push('This licence forbids hosting, so the item needs a link out.');
  }
  return missing;
}
