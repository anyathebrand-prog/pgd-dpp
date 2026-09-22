import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, takedownRequests } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { StaffBand, Banner, DataString, Panel, Record } from '@/components/ui';
import { evidenceSummary } from '@/modules/compliance/evidence';

/**
 * DP-08 compliance evidence export (CMP-16).
 *
 * §6.6 gives roughly 21 days to answer an NDPC investigation. The flow is
 * explicit that this "cannot be a reconstruction exercise", so the screen's
 * job is to show that the evidence already exists and can leave the building
 * in one action — not to offer a report builder.
 *
 * Two windows are offered because two things are being asked for in practice:
 * an annual audit filing, and an investigation into something that happened
 * last month. Everything except the audit trail is a current position and is
 * not windowed at all.
 */
export default async function EvidenceExport({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  await requireRole('dpo', 'super_admin');
  const { months } = await searchParams;

  const span = months === '3' ? 3 : 12;
  const to = new Date();
  const from = new Date(to.getTime() - span * 30 * 86_400_000);

  const counts = await evidenceSummary(from, to);

  const lastExports = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, 'compliance.evidence_exported'))
    .orderBy(desc(auditLog.at))
    .limit(3);

  const openClaims = await db
    .select()
    .from(takedownRequests)
    .orderBy(desc(takedownRequests.createdAt))
    .limit(5);

  const href = `/api/dpo/evidence?from=${from.toISOString()}&to=${to.toISOString()}`;

  return (
    <div>
      <StaffBand institution="Platform" role="dpo" />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Compliance evidence export</h1>
        <p className="t-body measure mt-3 text-ink-700">
          One archive containing the Record of Processing Activities, consent records, data subject
          requests, the breach register, the retention schedule and the audit trail — for a DPCO
          audit or an NDPC investigation.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            <Panel title="What this export contains">
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                {[
                  ['Processing activities', counts.processingActivities],
                  ['Consent records', counts.consentRecords],
                  ['Data subject requests', counts.dataSubjectRequests],
                  ['Breaches on the register', counts.breaches],
                  ['Retention rules', counts.retentionRules],
                  ['Library takedown claims', counts.takedowns],
                  [`Audit entries, last ${span} months`, counts.auditEntries],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="t-caption m-0 text-ink-700">{label}</dt>
                    <dd className="t-data-lg m-0 text-ink-900">{Number(value).toLocaleString('en-NG')}</dd>
                  </div>
                ))}
              </dl>

              {counts.processingActivities === 0 ? (
                // An empty RoPA is not a formatting problem. CMP-04 requires
                // it to be a living document, and a bundle that silently
                // contained nothing would export that failure as a blank.
                <div className="mt-6">
                  <Banner tone="danger" title="The Record of Processing Activities is empty">
                    <p>
                      CMP-04 requires it to exist and to be current. Exporting now would send an
                      investigator an empty section, which reads as a finding rather than as a
                      formatting error.
                    </p>
                  </Banner>
                </div>
              ) : null}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                {/* A plain link, not a form: this is a GET that returns a
                    file, and the access check runs on the request that
                    produces the bytes. */}
                <a
                  href={href}
                  className="motion-state inline-flex min-h-11 items-center rounded-sm bg-authority px-5 font-semibold text-surface no-underline hover:bg-authority-hover"
                  download
                >
                  Export the bundle
                </a>
                <Link
                  href={span === 12 ? '/dpo/evidence?months=3' : '/dpo/evidence?months=12'}
                  className="t-body-sm text-ink-700 underline underline-offset-2"
                >
                  {span === 12 ? 'Narrow the audit trail to three months' : 'Widen it to twelve months'}
                </Link>
              </div>

              <p className="t-caption mt-5 mb-0 text-ink-700">
                Producing this bundle is itself written to the audit log, against your account.
              </p>
            </Panel>

            <div className="mt-8">
              <Panel title="Library takedown claims (LIB-07)">
                <p className="t-body-sm mt-0 mb-4 text-ink-700">
                  Claims arrive from the public form. The DPO is copied on all of them because a
                  claim about personal data in a hosted judgment is a rights request wearing a
                  different hat.
                </p>
                <ul className="m-0 grid list-none gap-4 p-0">
                  {openClaims.map((claim) => (
                    <Record
                      as="li"
                      key={claim.id}
                      title={claim.itemDescription}
                      meta={`${claim.reference} · ${claim.basis.replace(/_/g, ' ')} · ${claim.status.replace(/_/g, ' ')} · ${claim.createdAt.toLocaleDateString('en-NG')}`}
                    >
                      <p className="t-body-sm m-0 text-ink-900">{claim.detail}</p>
                    </Record>
                  ))}
                  {openClaims.length === 0 ? (
                    <li className="t-body-sm text-ink-700">No claims have been received.</li>
                  ) : null}
                </ul>
              </Panel>
            </div>
          </div>

          <aside className="space-y-6">
            <Panel title="Who produced the last ones">
              <ul className="m-0 list-none space-y-3 p-0">
                {lastExports.map((row) => (
                  <li key={row.id} className="t-caption text-ink-700">
                    <DataString value={row.at.toISOString().slice(0, 16)} label="Exported at" />
                  </li>
                ))}
                {lastExports.length === 0 ? (
                  <li className="t-body-sm text-ink-700">No bundle has been exported yet.</li>
                ) : null}
              </ul>
            </Panel>

            <Banner tone="info" title="What is not in here">
              <p>
                The DPIA is a signed document held outside the platform, and the privacy notices are
                already public at their versioned URLs. The bundle carries the notice versions so a
                consent record can be tied to the text that was in force.
              </p>
            </Banner>
          </aside>
        </div>

        <p className="t-body-sm mt-12">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Back to the console
          </Link>
        </p>
      </main>
    </div>
  );
}
