import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, memberships } from '@/db/schema';

/**
 * Reads behind the alumni community.
 *
 * Here rather than beside the actions because they take ids: every export of
 * a 'use server' module is a live endpoint, and "may this person enter that
 * channel" is not a question a browser should be able to ask about anyone
 * other than itself.
 */

/**
 * ALM-12, enforced rather than hidden.
 *
 * An alumnus of School A may see School B graduates in the directory, but may
 * not enter School B's channel. This is the check that makes that true —
 * called on the server by AL-05 rather than expressed by not rendering a
 * link, because a link nobody renders is still a URL anyone can type.
 */
export async function mayEnterChannel(userId: string, institutionId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.institutionId, institutionId),
        eq(memberships.role, 'alumni'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The channels this person may actually enter.
 *
 * Derived from their own memberships rather than from a list of institutions
 * filtered afterwards: the question "which channels are mine" and the
 * question "may I enter this one" have to have the same answer, and sharing
 * `mayEnterChannel` is how that stays true.
 */
export async function myChannels(userId: string) {
  return db
    .select({
      id: institutions.id,
      name: institutions.name,
      shortName: institutions.shortName,
    })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'alumni')));
}
