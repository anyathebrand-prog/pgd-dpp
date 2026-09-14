import 'server-only';
import { count, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, questions, submissions } from '@/db/schema';

/**
 * Reads behind FC-02's assessment authoring.
 *
 * They live here rather than beside the actions because every export of a
 * 'use server' module is a live endpoint: a helper taking an institutionId
 * would be an unauthenticated "count anyone's submissions" API reachable from
 * any browser. Nothing here is exported to a client.
 */

/** How many people have already answered this paper. */
export async function attemptCount(institutionId: string, assessmentId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select({ n: count() })
      .from(submissions)
      .where(eq(submissions.assessmentId, assessmentId)),
  );
  return Number(row?.n ?? 0);
}

/** What stands between this assessment and being publishable. */
export async function assessmentBlockers(institutionId: string, assessmentId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1),
  );
  const items = await withTenant(institutionId, (tx) =>
    tx.select().from(questions).where(eq(questions.assessmentId, assessmentId)),
  );

  const missing: string[] = [];
  if (!row) return ['That assessment does not exist.'];

  if (row.kind === 'quiz' && items.length === 0) {
    missing.push('A quiz needs at least one question.');
  }
  for (const q of items) {
    if (q.kind === 'mcq') {
      if (q.options.length < 2) {
        missing.push(`"${q.prompt.slice(0, 40)}…" needs at least two options.`);
      } else if (!q.options.some((o) => o.key === q.correctAnswer)) {
        // The one that silently ruins a cohort's marks: a question whose
        // correct answer matches none of its options is unanswerable, and the
        // auto-marker scores every attempt at it zero without complaint.
        missing.push(`"${q.prompt.slice(0, 40)}…" has no correct option marked.`);
      }
    }
    if (q.kind === 'true_false' && q.correctAnswer !== 'true' && q.correctAnswer !== 'false') {
      missing.push(`"${q.prompt.slice(0, 40)}…" needs an answer of true or false.`);
    }
  }
  return missing;
}
