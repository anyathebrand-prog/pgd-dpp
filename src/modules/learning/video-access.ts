import 'server-only';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { enrollments } from '@/db/schema';
import type { Principal } from '@/lib/auth';
import { myPlan } from '@/modules/payments/plan';

/**
 * LRN-02 — who may watch a lesson's video. One rule, read by the MP4 route
 * and by the lesson page before it signs a Stream URL, so the two delivery
 * paths cannot disagree.
 *
 * Staff who teach at the institution, or a student actively enrolled there
 * whose tuition is not overdue (PAY-09: gating the page while serving the
 * video would be a gate with the back door open).
 */
export async function videoAccess(
  me: Principal,
  institutionId: string,
): Promise<'ok' | 'not_enrolled' | 'payment_overdue'> {
  const teachesHere = me.allMemberships.some(
    (m) =>
      m.institutionId === institutionId &&
      ['facilitator', 'institution_admin', 'super_admin'].includes(m.role),
  );
  if (teachesHere) return 'ok';

  const [enrolled] = await withTenant(institutionId, (tx) =>
    tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, me.userId),
          eq(enrollments.institutionId, institutionId),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1),
  );
  if (!enrolled) return 'not_enrolled';

  const plan = await myPlan(institutionId, me.userId);
  return plan.gated ? 'payment_overdue' : 'ok';
}
