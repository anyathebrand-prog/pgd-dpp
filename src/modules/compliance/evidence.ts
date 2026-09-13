import { and, count, desc, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog,
  breaches,
  consentRecords,
  dataSubjectRequests,
  privacyNotices,
  processingActivities,
  retentionRules,
  takedownRequests,
} from '@/db/schema';

/**
 * CMP-16 / DP-08 — the evidence bundle.
 *
 * §6.6 gives roughly 21 days to answer an NDPC investigation, which sounds
 * generous until you notice what is being asked for: the RoPA as it stands,
 * every consent decision with the notice version it was given against, the
 * audit trail, the breach register, and the retention schedule with evidence
 * it actually ran. None of that can be assembled retrospectively — either the
 * system recorded it at the time or it did not.
 *
 * So this is a read, not a build. Nothing here derives or reconstructs
 * anything: every section is a table, exported as it stands. An empty section
 * is reported as empty rather than quietly omitted, because a missing section
 * in an audit response is itself a finding.
 */

export type EvidenceBundle = Awaited<ReturnType<typeof assembleEvidence>>;

export async function assembleEvidence(from: Date, to: Date) {
  const inWindow = and(gte(auditLog.at, from), lte(auditLog.at, to));

  const [ropa, notices, rules, register, requests, consents, takedowns, trail] = await Promise.all([
    db.select().from(processingActivities),
    db.select().from(privacyNotices).orderBy(desc(privacyNotices.version)),
    db.select().from(retentionRules),
    db.select().from(breaches).orderBy(desc(breaches.discoveredAt)),
    db.select().from(dataSubjectRequests).orderBy(desc(dataSubjectRequests.receivedAt)),
    db.select().from(consentRecords).orderBy(desc(consentRecords.recordedAt)),
    db.select().from(takedownRequests).orderBy(desc(takedownRequests.createdAt)),
    // The audit log is the only section bounded by the window — the others
    // are states rather than event streams, and a RoPA truncated to a date
    // range would be a misleading answer to the question actually asked.
    db.select().from(auditLog).where(inWindow).orderBy(desc(auditLog.at)),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
    note:
      'Produced under CMP-16 for DPCO audit or NDPC investigation. The audit trail is bounded ' +
      'by the window above; every other section is the position as at generation.',
    recordOfProcessingActivities: ropa,
    privacyNotices: notices.map((n) => ({
      version: n.version,
      effectiveFrom: n.effectiveFrom,
      // The bodies are long and already public at /privacy/v{n}, so the
      // bundle carries the version and effective date — which is what a
      // consent record points at — rather than restating every text.
      length: n.body.length,
    })),
    consentRecords: consents,
    dataSubjectRequests: requests,
    breachRegister: register,
    retentionSchedule: rules,
    libraryTakedowns: takedowns,
    auditTrail: trail,
    counts: {
      processingActivities: ropa.length,
      consentRecords: consents.length,
      dataSubjectRequests: requests.length,
      breaches: register.length,
      retentionRules: rules.length,
      takedowns: takedowns.length,
      auditEntries: trail.length,
    },
  };
}

/**
 * What the DPO sees before exporting: the shape of the bundle, without the
 * bundle. The console page should not itself become a disclosure of every
 * consent record in the system merely to say how many there are — and
 * counting in Postgres is cheaper than assembling an archive to measure it.
 */
export async function evidenceSummary(from: Date, to: Date) {
  const [ropa, consents, requests, register, rules, takedowns, trail] = await Promise.all([
    db.select({ n: count() }).from(processingActivities),
    db.select({ n: count() }).from(consentRecords),
    db.select({ n: count() }).from(dataSubjectRequests),
    db.select({ n: count() }).from(breaches),
    db.select({ n: count() }).from(retentionRules),
    db.select({ n: count() }).from(takedownRequests),
    db
      .select({ n: count() })
      .from(auditLog)
      .where(and(gte(auditLog.at, from), lte(auditLog.at, to))),
  ]);

  return {
    processingActivities: Number(ropa[0]?.n ?? 0),
    consentRecords: Number(consents[0]?.n ?? 0),
    dataSubjectRequests: Number(requests[0]?.n ?? 0),
    breaches: Number(register[0]?.n ?? 0),
    retentionRules: Number(rules[0]?.n ?? 0),
    takedowns: Number(takedowns[0]?.n ?? 0),
    auditEntries: Number(trail[0]?.n ?? 0),
  };
}
