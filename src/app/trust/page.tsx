import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { privacyNotices, processingActivities } from '@/db/schema';
import { Footer, TopBar } from '@/components/shell';
import { Panel } from '@/components/ui';

/**
 * PB-05 trust and compliance page (CMP-18, CMP-02).
 *
 * A public page naming the DPO, the registration status and every
 * sub-processor. It exists because a platform that teaches data protection
 * while being vague about its own processing has no standing to teach it — and
 * because prospective institutions ask for exactly this during procurement.
 *
 * The sub-processor list is generated from the Record of Processing Activities
 * rather than maintained separately, so it cannot drift from the RoPA an
 * auditor would be shown.
 */
export default async function TrustPage() {
  const [notice] = await db
    .select()
    .from(privacyNotices)
    .orderBy(desc(privacyNotices.version))
    .limit(1);

  const activities = await db.select().from(processingActivities);
  const processors = [...new Set(activities.flatMap((a) => a.processors ?? []))].sort();

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-12">
        <h1 className="t-h1 m-0 text-ink-900">Trust and compliance</h1>
        <p className="t-body measure mt-3 mb-10 text-ink-700">
          What we process, on what basis, who else touches it, and who to contact. Everything here
          is generated from the same records we would hand the Commission.
        </p>

        <div className="grid gap-6">
          <Panel title="Data Protection Officer">
            <p className="t-body-sm m-0 text-ink-700">
              The DPO is appointed under section 32 of the NDPA 2023, registered with the Nigeria
              Data Protection Commission, and reports independently.
            </p>
            <p className="t-body-sm mt-3 mb-0 text-ink-900">
              dpo@example.ng · reachable directly, without going through support
            </p>
          </Panel>

          <Panel title="Registration">
            <p className="t-body-sm m-0 text-ink-700">
              Registered with the NDPC as a Data Controller or Processor of Major Importance. The
              annual Compliance Audit Return is filed by 31 March each year, and the DPO compiles a
              semi-annual data protection report forming part of our Record of Processing
              Activities.
            </p>
          </Panel>

          <Panel title="Who is responsible for what">
            <p className="t-body-sm m-0 text-ink-700">
              Your institution decides who is admitted, what is taught and what your academic record
              says — it is the controller for those. The platform operates the systems, holds your
              account and processes payments, and is the controller for those. Each institution has
              a signed data processing agreement with the platform, and either party will take a
              request and route it to the right one.
            </p>
          </Panel>

          <Panel title="What we process, and why">
            <ul className="m-0 list-none space-y-4 p-0">
              {activities.map((a) => (
                <li key={a.id}>
                  <p className="t-body-sm m-0 font-semibold text-ink-900">{a.name}</p>
                  <p className="t-body-sm m-0 text-ink-700">{a.purpose}</p>
                  <p className="t-caption m-0 text-ink-700">
                    Lawful basis: {a.lawfulBasis} · Controller: {a.controller} · Retention:{' '}
                    {a.retentionRule}
                  </p>
                  {a.crossBorder ? (
                    <p className="t-caption m-0 text-ink-700">Transfers: {a.crossBorder}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Sub-processors">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Every one of these is under a written agreement, and institutions are notified before
              this list changes.
            </p>
            <ul className="t-body-sm m-0 list-disc pl-5 text-ink-900">
              {processors.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Panel>

          <Panel title="Security">
            <ul className="t-body-sm m-0 list-disc space-y-1 pl-5 text-ink-900">
              <li>Encryption in transit and at rest.</li>
              <li>
                Documents are never publicly addressable. Every access is through a link that expires
                in minutes and is recorded against the person who opened it.
              </li>
              <li>
                Institutional data is isolated at the database layer, not only in application code.
              </li>
              <li>
                Two-factor authentication is mandatory for every role that can read another
                person&apos;s records.
              </li>
              <li>No card details ever reach our servers or our database.</li>
            </ul>
          </Panel>

          <Panel title="Reporting something">
            <ul className="m-0 list-none space-y-2 p-0">
              <li>
                <Link href="/dpo/request" className="t-body-sm text-ink-900 underline underline-offset-2">
                  Exercise a data protection right
                </Link>
              </li>
              <li>
                <Link href="/library/takedown" className="t-body-sm text-ink-900 underline underline-offset-2">
                  Report content in the library
                </Link>
              </li>
              <li>
                <Link
                  href={`/privacy/v${notice?.version ?? 1}`}
                  className="t-body-sm text-ink-900 underline underline-offset-2"
                >
                  Read the privacy notice, version {notice?.version ?? 1}
                </Link>
              </li>
            </ul>
            <p className="t-caption mt-4 mb-0 text-ink-700">
              You also have the right to complain to the Nigeria Data Protection Commission directly.
            </p>
          </Panel>
        </div>
      </main>
      <Footer />
    </>
  );
}
