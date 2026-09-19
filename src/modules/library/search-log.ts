import 'server-only';
import { db } from '@/db';
import { searchEvents } from '@/db/schema';

/**
 * LIB-02 / SA-02 — recording what the collection failed to answer.
 *
 * LB-01 has always told readers that "searches that return nothing are logged
 * and reviewed by the curator". Nothing logged them. This is that sentence
 * becoming true, which matters twice over: it is a promise made to a user,
 * and zero-result queries are the one demand signal a library has for what to
 * acquire next.
 *
 * Nobody's identity is recorded — see the table's own note. The query and the
 * count answer the curation question completely.
 */
export async function recordSearch(input: {
  query: string;
  institutionId: string | null;
  filters: Record<string, unknown>;
  resultCount: number;
}) {
  const query = input.query.trim();

  // A blank search is a page view, and a very long one is somebody pasting a
  // document into the box rather than asking the collection a question.
  if (query.length === 0 || query.length > 200) return;

  /*
   * Never allowed to break the search.
   *
   * This runs during the render of LB-01, so a failure here — a lock, a
   * connection blip — would turn an analytics write into a reader's blank
   * page. The event is worth having and never worth that.
   */
  try {
    await db.insert(searchEvents).values({
      query,
      institutionId: input.institutionId,
      filters: input.filters,
      resultCount: input.resultCount,
    });
  } catch {
    // Deliberately swallowed.
  }
}
