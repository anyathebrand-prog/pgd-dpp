import 'server-only';
import { and, asc, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import {
  applications,
  auditLog,
  enrollments,
  institutions,
  lessonProgress,
  lessons,
  searchEvents,
  transactions,
} from '@/db/schema';

/**
 * SA-02 platform analytics (§9).
 *
 * The constraint that shapes every query in this file is §6.3: cross-tenant
 * data must be aggregated or pseudonymised **before it leaves tenant scope**.
 *
 * So nothing here uses `readAcrossTenants`. Each figure is gathered inside
 * each institution's own row-level-security context and reduced to a count or
 * a duration there; what crosses the boundary is a number. The loop is bounded
 * by the number of institutions on the platform (target: five), which is the
 * same trade PB-02 and SA-01 make, and it means the platform can answer "how
 * is the funnel doing" without ever holding a cross-tenant list of people.
 *
 * Two of the metrics §9 names are absent, and the screen says so rather than
 * inventing them: there is no support desk in this product, and no session
 * records a login "method" beyond what the audit log already distinguishes.
 */

export type Tenant = { id: string; name: string; shortName: string };

/** Every institution the platform runs, which is the loop bound for all of this. */
export async function tenants(): Promise<Tenant[]> {
  return db
    .select({ id: institutions.id, name: institutions.name, shortName: institutions.shortName })
    .from(institutions)
    .orderBy(asc(institutions.name));
}

/**
 * APP funnel. The steps are cumulative — someone enrolled also got admitted —
 * so the count at each step is "reached this step or went past it", which is
 * the only reading under which drop-off means anything.
 */
const REACHED: Record<string, string[]> = {
  started: [
    'draft',
    'awaiting_application_fee',
    'submitted',
    'under_review',
    'documents_queried',
    'admitted',
    'offer_accepted',
    'enrolled',
    'rejected',
    'waitlisted',
    'offer_lapsed',
    'withdrawn',
  ],
  paid_and_submitted: [
    'submitted',
    'under_review',
    'documents_queried',
    'admitted',
    'offer_accepted',
    'enrolled',
    'rejected',
    'waitlisted',
    'offer_lapsed',
  ],
  decided: ['admitted', 'offer_accepted', 'enrolled', 'rejected', 'waitlisted', 'offer_lapsed'],
  admitted: ['admitted', 'offer_accepted', 'enrolled', 'offer_lapsed'],
  accepted: ['offer_accepted', 'enrolled'],
  enrolled: ['enrolled'],
};

export const FUNNEL_STEPS = [
  { key: 'started', label: 'Started an application' },
  { key: 'paid_and_submitted', label: 'Paid the fee and submitted' },
  { key: 'decided', label: 'Received a decision' },
  { key: 'admitted', label: 'Admitted' },
  { key: 'accepted', label: 'Accepted the offer' },
  { key: 'enrolled', label: 'Enrolled' },
] as const;

export async function funnel(all: Tenant[]) {
  const perTenant = await Promise.all(
    all.map(async (t) => {
      const rows = await withTenant(t.id, (tx) =>
        tx
          .select({ status: applications.status, n: count() })
          .from(applications)
          .where(eq(applications.institutionId, t.id))
          .groupBy(applications.status),
      );
      // Reduced to counts here, inside the tenant's own context.
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      return { tenant: t, byStatus };
    }),
  );

  const steps = FUNNEL_STEPS.map((step, i) => {
    const total = perTenant.reduce(
      (sum, { byStatus }) =>
        sum + REACHED[step.key].reduce((s, status) => s + (byStatus[status] ?? 0), 0),
      0,
    );
    return { ...step, total, index: i };
  });

  return steps.map((step, i) => {
    const previous = i === 0 ? step.total : steps[i - 1].total;
    const lost = Math.max(previous - step.total, 0);
    return {
      ...step,
      // Drop-off is against the step before, not against the top: "we lose
      // 40% at payment" is actionable and "we lose 40% overall" is not.
      dropOffPercent: previous === 0 ? 0 : Math.round((lost / previous) * 100),
      lost,
    };
  });
}

/**
 * Time to decision — PRD risk 3 names registry turnaround as the residual
 * bottleneck, so this is the number that risk is measured by.
 *
 * Median rather than mean. One application that sat for ninety days over a
 * holiday moves a mean enough to hide a queue that is otherwise healthy, and
 * it is exactly the kind of outlier an admissions office actually has.
 */
export async function timeToDecision(all: Tenant[]) {
  const days: number[] = [];

  for (const t of all) {
    const rows = await withTenant(t.id, (tx) =>
      tx
        .select({
          days: sql<number>`extract(epoch from (${applications.decisionAt} - ${applications.submittedAt})) / 86400`,
        })
        .from(applications)
        .where(
          and(
            eq(applications.institutionId, t.id),
            isNotNull(applications.decisionAt),
            isNotNull(applications.submittedAt),
          ),
        ),
    );
    for (const r of rows) {
      const d = Number(r.days);
      if (Number.isFinite(d) && d >= 0) days.push(d);
    }
  }

  if (days.length === 0) return { median: null, slowest: null, decided: 0 };

  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];

  return {
    median: Math.round(median * 10) / 10,
    slowest: Math.round(days[days.length - 1] * 10) / 10,
    decided: days.length,
  };
}

/** PAY: success rate by channel. The two channels fail in entirely different ways. */
export async function paymentsByChannel(all: Tenant[]) {
  const totals = new Map<string, Map<string, number>>();

  for (const t of all) {
    const rows = await withTenant(t.id, (tx) =>
      tx
        .select({ channel: transactions.channel, status: transactions.status, n: count() })
        .from(transactions)
        .where(eq(transactions.institutionId, t.id))
        .groupBy(transactions.channel, transactions.status),
    );
    for (const r of rows) {
      const byStatus = totals.get(r.channel) ?? new Map<string, number>();
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + Number(r.n));
      totals.set(r.channel, byStatus);
    }
  }

  return [...totals.entries()].map(([channel, byStatus]) => {
    const attempts = [...byStatus.values()].reduce((a, b) => a + b, 0);
    const success = byStatus.get('success') ?? 0;
    return {
      channel,
      attempts,
      success,
      abandoned: byStatus.get('abandoned') ?? 0,
      failed: byStatus.get('failed') ?? 0,
      awaiting: byStatus.get('awaiting_approval') ?? 0,
      successPercent: attempts === 0 ? 0 : Math.round((success / attempts) * 100),
    };
  });
}

/** LRN: how far enrolled students actually get through published material. */
export async function moduleCompletion(all: Tenant[]) {
  let completions = 0;
  let possible = 0;
  let learners = 0;

  for (const t of all) {
    const [lessonCount] = await withTenant(t.id, (tx) =>
      tx
        .select({ n: count() })
        .from(lessons)
        .where(eq(lessons.institutionId, t.id)),
    );
    const [active] = await withTenant(t.id, (tx) =>
      tx
        .select({ n: count() })
        .from(enrollments)
        .where(and(eq(enrollments.institutionId, t.id), eq(enrollments.status, 'active'))),
    );
    const [done] = await withTenant(t.id, (tx) =>
      tx
        .select({ n: count() })
        .from(lessonProgress)
        .where(
          and(eq(lessonProgress.institutionId, t.id), isNotNull(lessonProgress.completedAt)),
        ),
    );

    learners += Number(active?.n ?? 0);
    possible += Number(lessonCount?.n ?? 0) * Number(active?.n ?? 0);
    completions += Number(done?.n ?? 0);
  }

  return {
    learners,
    completions,
    possible,
    percent: possible === 0 ? 0 : Math.round((completions / possible) * 100),
  };
}

/**
 * How people are getting in. Counted from the audit log rather than from
 * sessions, because `sessions` records that somebody is signed in and the
 * audit log records how they came to be — and SSO-02 handoffs never touch the
 * password path at all.
 *
 * The audit log is a shared table, so this is a plain read; it counts rows and
 * reads no actor.
 */
export async function loginMethods(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = await db
    .select({ action: auditLog.action, n: count() })
    .from(auditLog)
    .where(and(gte(auditLog.at, since), sql`${auditLog.action} IN ('auth.login', 'sso.handoff_accepted', 'sso.handoff_rejected')`))
    .groupBy(auditLog.action);

  const get = (a: string) => Number(rows.find((r) => r.action === a)?.n ?? 0);
  const password = get('auth.login');
  const sso = get('sso.handoff_accepted');
  const total = password + sso;

  return {
    password,
    sso,
    ssoRejected: get('sso.handoff_rejected'),
    total,
    ssoPercent: total === 0 ? 0 : Math.round((sso / total) * 100),
  };
}

/**
 * LIB-02: what the collection was asked for and could not answer.
 *
 * The one metric here with no tenant dimension at all, because the catalogue
 * is shared and a search carries no data subject — see the table's own note
 * on why there is no user id to group by.
 */
export async function zeroResultSearches(limit = 10, sinceDays = 90) {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = await db
    .select({ query: searchEvents.query, n: count(), last: sql<Date>`max(${searchEvents.createdAt})` })
    .from(searchEvents)
    .where(and(eq(searchEvents.resultCount, 0), gte(searchEvents.createdAt, since)))
    .groupBy(searchEvents.query)
    .orderBy(desc(count()))
    .limit(limit);

  const [totals] = await db
    .select({
      searches: count(),
      empty: sql<number>`count(*) FILTER (WHERE ${searchEvents.resultCount} = 0)::int`,
    })
    .from(searchEvents)
    .where(gte(searchEvents.createdAt, since));

  const searches = Number(totals?.searches ?? 0);
  const empty = Number(totals?.empty ?? 0);

  return {
    top: rows.map((r) => ({ query: r.query, n: Number(r.n), last: r.last })),
    searches,
    empty,
    emptyPercent: searches === 0 ? 0 : Math.round((empty / searches) * 100),
  };
}
