import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, dataSubjectRequests, institutions, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { assembleSubjectData, erasureConflicts, slaClass, slaFor } from '@/modules/compliance/dsr';
import { DsrPanels } from '@/components/dsr-panels';
import { Banner, DataString, Panel, Record, StaffBand } from '@/components/ui';

/**
 * DP-03 request detail and fulfilment (CMP-07).
 *
 * The screen is arranged around the order the work actually happens in:
 * verify who is asking, see what we hold, decide who controls it, then act
 * and record what was done. The affected-data summary is generated from the
 * same assembler that powers the student's own export, so what the DPO sees
 * and what the subject would receive cannot drift apart.
 */
export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireRole('dpo', 'super_admin');

  const [row] = await db
    .select({ request: dataSubjectRequests, institution: institutions.name })
    .from(dataSubjectRequests)
    .leftJoin(institutions, eq(institutions.id, dataSubjectRequests.institutionId))
    .where(eq(dataSubjectRequests.id, id))
    .limit(1);
  if (!row) notFound();

  const { request, institution } = row;
  const sla = slaFor(request);

  // The request may name someone who never had an account.
  const [subject] = request.userId
    ? await db.select().from(users).where(eq(users.id, request.userId)).limit(1)
    : await db.select().from(users).where(eq(users.email, request.subjectEmail)).limit(1);

  const held = subject ? await assembleSubjectData(subject.id) : null;
  const conflicts =
    request.kind === 'erasure' ? await erasureConflicts(request.subjectEmail, subject?.id ?? null) : [];

  const history = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, request.id))
    .orderBy(auditLog.at);

  const closed = Boolean(request.closedAt);

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform" role="dpo" />

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-body-sm m-0">
          <Link href="/dpo/requests" className="text-ink-700 underline underline-offset-2">
            Back to the queue
          </Link>
        </p>

        <div className="mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="t-h1 m-0 text-ink-900">
              {request.kind.charAt(0).toUpperCase() + request.kind.slice(1)} request
            </h1>
            <p className="t-caption mt-2 mb-0 text-ink-700">
              {request.subjectEmail} · received{' '}
              {request.receivedAt.toLocaleDateString('en-NG', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="t-caption m-0 text-ink-700">Statutory deadline</p>
            <p className={`t-data-lg m-0 ${closed ? 'text-ink-500' : slaClass(sla.level)}`}>
              {closed
                ? 'Closed'
                : sla.daysLeft <= 0
                  ? `${Math.abs(sla.daysLeft)} days overdue`
                  : `${sla.daysLeft} days left`}
            </p>
            <p className="t-caption m-0 text-ink-700">
              Due {request.dueAt.toLocaleDateString('en-NG')}
            </p>
          </div>
        </div>

        {closed ? (
          <div className="mb-8">
            <Banner tone={request.status === 'refused' ? 'warning' : 'verified'} title={request.status === 'refused' ? 'Refused' : 'Fulfilled'}>
              <p>
                Closed {request.closedAt?.toLocaleString('en-NG')}. {request.outcomeNote}
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
          <div className="space-y-5">
            <Record title="What was asked" meta={`Routed to the ${request.routedTo}`}>
              <p className="t-body-sm mt-0 mb-3 whitespace-pre-line text-ink-900">
                {request.detail ?? 'No further detail was given.'}
              </p>
              {institution ? (
                <p className="t-caption m-0 text-ink-700">
                  Institution on the record: {institution}. Where the data is theirs, they fulfil it
                  with our assistance — the requester deals only with us either way.
                </p>
              ) : null}
            </Record>

            {/* §6.6: erasure vs academic retention, stated before anyone acts. */}
            {conflicts.length > 0 ? (
              <div>
                <Banner tone="warning" title="Erasure collides with records that must be retained">
                  <p>
                    These cannot be deleted on request. Refuse the erasure with this reasoning
                    rather than marking it fulfilled — a claimed deletion that did not happen is
                    worse than a refusal.
                  </p>
                  <ul className="mt-2 list-disc pl-5">
                    {conflicts.map((c) => (
                      <li key={`${c.holder}-${c.basis}`}>
                        <strong>{c.holder}</strong> — {c.basis}. {c.detail}
                      </li>
                    ))}
                  </ul>
                </Banner>
              </div>
            ) : null}

            <Record
              title="What we hold about this person"
              meta={held ? 'Generated from the same export the subject can download themselves' : undefined}
            >
              {!held ? (
                <p className="t-body-sm m-0 text-ink-700">
                  No account matches {request.subjectEmail}. If they are certain we hold data,
                  confirm the address before going further — and do not ask for identity documents
                  to prove ownership of an address we have no record of.
                </p>
              ) : (
                <dl className="t-body-sm m-0 grid grid-cols-[220px_1fr] gap-x-5 gap-y-2 text-ink-900">
                  <dt className="text-ink-700">Account</dt>
                  <dd className="m-0">
                    {held.account.fullName ?? '—'} · {held.account.status}
                  </dd>
                  <dt className="text-ink-700">Consents recorded</dt>
                  <dd className="m-0">{held.consents.length}</dd>
                  <dt className="text-ink-700">Applications</dt>
                  <dd className="m-0">
                    {held.applications.length
                      ? held.applications.map((a) => `${a.institution} (${a.status})`).join(', ')
                      : 'None'}
                  </dd>
                  <dt className="text-ink-700">Uploaded documents</dt>
                  <dd className="m-0">
                    {held.documents.length} ·{' '}
                    {held.documents.filter((d) => d.purgedAt).length} already purged
                  </dd>
                  <dt className="text-ink-700">Enrolments</dt>
                  <dd className="m-0">
                    {held.enrolments.length
                      ? held.enrolments.map((e) => e.matricNumber).join(', ')
                      : 'None'}
                  </dd>
                  <dt className="text-ink-700">Payments</dt>
                  <dd className="m-0">{held.payments.length}</dd>
                  <dt className="text-ink-700">Graded results</dt>
                  <dd className="m-0">{held.results.length}</dd>
                </dl>
              )}
            </Record>

            <Panel title="What has been done">
              {history.length === 0 ? (
                <p className="t-body-sm m-0 text-ink-700">
                  Nothing recorded yet beyond intake.
                </p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {history.map((h) => (
                    <li key={h.id} className="t-body-sm text-ink-900">
                      <DataString value={h.at.toISOString().slice(0, 16).replace('T', ' ')} label="At" />{' '}
                      · {h.action.replace('dsr.', '').replace(/_/g, ' ')}
                      {typeof h.detail?.note === 'string' ? ` — ${h.detail.note}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <p className="t-caption mt-4 mb-0 text-ink-700">
                This trail is what CMP-16 has to produce for an investigation, on a clock of roughly
                21 days. It is written as the work happens, not reconstructed afterwards.
              </p>
            </Panel>
          </div>

          <aside className="space-y-6">
            <DsrPanels
              requestId={request.id}
              kind={request.kind}
              closed={closed}
              identityVerified={Boolean(request.identityVerifiedAt)}
              identityNote={request.identityVerifiedNote}
              hasInstitution={Boolean(request.institutionId)}
              conflictCount={conflicts.length}
              subjectEmail={request.subjectEmail}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
