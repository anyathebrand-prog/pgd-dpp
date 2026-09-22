import Link from 'next/link';
import { asc, desc } from 'drizzle-orm';
import { db } from '@/db';
import { grievanceNotices, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { ActionForm } from '@/components/form';
import { Banner, EmptyState, Field, Input, Panel, Record, Select, StaffBand, Textarea } from '@/components/ui';
import {
  logGrievance,
  recordGrievanceOutcome,
  respondToGrievance,
} from '@/modules/compliance/register-actions';

/**
 * DP-04 SNAG intake and response — `app./dpo/snag` (CMP-08, a Must).
 *
 * GAID Article 40(2) gives a data subject a standard form for serving a
 * grievance. The controller must respond substantively — accept the violation
 * and state the remedy, or explain why none occurred — and record the
 * outcome. Unresolved, the subject may escalate to the NDPC or go to court, so
 * the outcome records which, rather than letting "closed" stand for all of
 * them.
 *
 * The response form offers exactly the two substantive answers and nothing
 * else. A reply that acknowledges the notice without taking a position is
 * the most common way a SNAG goes wrong, and the form will not record one.
 *
 * No statutory response deadline is shown, because the PRD does not state
 * one for SNAGs and inventing a clock here would be worse than having none:
 * a DPO would schedule against a number the law never gave. Days open is
 * shown instead, as a fact.
 */
const OUTCOMES = [
  { value: 'resolved', label: 'Resolved with the data subject' },
  { value: 'escalated_ndpc', label: 'Escalated to the NDPC' },
  { value: 'civil_proceedings', label: 'Civil proceedings brought' },
  { value: 'withdrawn', label: 'Withdrawn by the data subject' },
];

export default async function Snag({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string; responded?: string; closed?: string }>;
}) {
  const me = await requireRole('dpo', 'super_admin');
  const { logged, responded, closed } = await searchParams;

  const rows = await db.select().from(grievanceNotices).orderBy(desc(grievanceNotices.receivedAt));
  const insts = await db.select().from(institutions).orderBy(asc(institutions.name));
  const instName = (id: string | null) =>
    id ? (insts.find((i) => i.id === id)?.shortName ?? 'Unknown') : 'Platform';

  const daysOpen = (from: Date) => Math.floor((Date.now() - from.getTime()) / 86_400_000);
  const open = rows.filter((r) => r.status === 'open').sort((a, b) => +a.receivedAt - +b.receivedAt);
  const awaitingOutcome = rows.filter((r) => r.status === 'responded');
  const done = rows.filter((r) => r.status === 'closed');

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform" role="dpo" />
      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-caption m-0">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Data protection
          </Link>
        </p>
        <h1 className="t-h1 mt-2 mb-2 text-ink-900">Grievance notices</h1>
        <p className="t-body measure mt-0 mb-8 text-ink-700">
          Standard Notices to Address Grievance served under GAID Article 40(2). Each needs a
          substantive response and a recorded outcome.
        </p>

        {logged ? (
          <div className="mb-8">
            <Banner tone="info" title="Notice logged">
              <p>It is waiting for a substantive response.</p>
            </Banner>
          </div>
        ) : null}
        {responded ? (
          <div className="mb-8">
            <Banner tone="verified" title="Response recorded">
              <p>Record how it ends once the data subject has replied, or once it escalates.</p>
            </Banner>
          </div>
        ) : null}
        {closed ? (
          <div className="mb-8">
            <Banner tone="verified" title="Outcome recorded">
              <p>The notice is closed and the whole exchange is in the audit log.</p>
            </Banner>
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <h2 className="t-h2 mt-0 mb-4 text-ink-900">Waiting for a response</h2>
            {open.length === 0 ? (
              <EmptyState heading="Nothing waiting">
                A notice appears here from the moment it is logged until it has been answered.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-6 p-0">
                {open.map((g) => (
                  <li key={g.id}>
                    <Record
                      title={g.subjectName}
                      meta={`${instName(g.institutionId)} · received ${g.receivedAt.toLocaleDateString('en-NG')} · open ${daysOpen(g.receivedAt)} days`}
                    >
                      <p className="t-body-sm measure mt-0 mb-5 whitespace-pre-line text-ink-900">
                        {g.grievance}
                      </p>
                      <ActionForm action={respondToGrievance} submitLabel="Record the response">
                        <input type="hidden" name="noticeId" value={g.id} />
                        <Field label="Position" name="responseType" inputId={`type-${g.id}`} required>
                          <Select id={`type-${g.id}`} name="responseType" required defaultValue="">
                            <option value="" disabled>
                              Choose one
                            </option>
                            <option value="accepted_violation">
                              A violation occurred, and here is the remedy
                            </option>
                            <option value="no_violation">No violation occurred, and here is why</option>
                          </Select>
                        </Field>
                        <Field
                          label="The response"
                          name="responseText"
                          inputId={`text-${g.id}`}
                          required
                          helper="As sent to the data subject. It has to answer what the notice actually says."
                        >
                          <Textarea id={`text-${g.id}`} name="responseText" rows={5} required />
                        </Field>
                        <Field
                          label="Remedial action"
                          name="remedialAction"
                          inputId={`remedy-${g.id}`}
                          helper="Required if you accept a violation: what is being done about it."
                        >
                          <Textarea id={`remedy-${g.id}`} name="remedialAction" rows={3} />
                        </Field>
                      </ActionForm>
                    </Record>
                  </li>
                ))}
              </ul>
            )}

            {awaitingOutcome.length > 0 ? (
              <>
                <h2 className="t-h2 mt-12 mb-4 text-ink-900">Answered, outcome not yet recorded</h2>
                <ul className="m-0 grid list-none gap-6 p-0">
                  {awaitingOutcome.map((g) => (
                    <li key={g.id}>
                      <Record
                        title={g.subjectName}
                        meta={`${g.responseType === 'accepted_violation' ? 'Violation accepted' : 'No violation found'} · answered ${g.respondedAt?.toLocaleDateString('en-NG') ?? ''}`}
                      >
                        <ActionForm action={recordGrievanceOutcome} submitLabel="Record the outcome">
                          <input type="hidden" name="noticeId" value={g.id} />
                          <Field label="How it ended" name="outcome" inputId={`outcome-${g.id}`} required>
                            <Select id={`outcome-${g.id}`} name="outcome" required defaultValue="">
                              <option value="" disabled>
                                Choose
                              </option>
                              {OUTCOMES.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Note" name="outcomeNote" inputId={`onote-${g.id}`} required>
                            <Textarea id={`onote-${g.id}`} name="outcomeNote" rows={2} required />
                          </Field>
                        </ActionForm>
                      </Record>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {done.length > 0 ? (
              <>
                <h2 className="t-h2 mt-12 mb-4 text-ink-900">Closed</h2>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {done.map((g) => (
                    <li key={g.id} className="border-t border-ink-300 pt-3">
                      <p className="t-body-sm m-0 text-ink-900">
                        {g.subjectName}{' '}
                        <span className="text-ink-700">
                          · {OUTCOMES.find((o) => o.value === g.outcome)?.label ?? g.outcome}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <aside className="space-y-6">
            <Panel title="Log a notice">
              <ActionForm action={logGrievance} submitLabel="Log the notice">
                <Field label="Data subject" name="subjectName" inputId="snag-name" required>
                  <Input id="snag-name" name="subjectName" required />
                </Field>
                <Field label="Their email" name="subjectEmail" inputId="snag-email" required>
                  <Input id="snag-email" name="subjectEmail" type="email" required />
                </Field>
                <div className="grid gap-x-6 md:grid-cols-2">
                  <Field label="Received" name="receivedAt" inputId="snag-received" required>
                    <Input id="snag-received" name="receivedAt" type="datetime-local" required />
                  </Field>
                  <Field label="How it arrived" name="channel" inputId="snag-channel" required>
                    <Select id="snag-channel" name="channel" required defaultValue="email">
                      <option value="email">Email</option>
                      <option value="post">Post</option>
                      <option value="in_person">In person</option>
                      <option value="portal">Through the platform</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Concerning" name="institutionId" inputId="snag-inst">
                  <Select id="snag-inst" name="institutionId" defaultValue="">
                    <option value="">The platform itself</option>
                    {insts.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.shortName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="The grievance, as served"
                  name="grievance"
                  inputId="snag-grievance"
                  required
                >
                  <Textarea id="snag-grievance" name="grievance" rows={5} required />
                </Field>
              </ActionForm>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
