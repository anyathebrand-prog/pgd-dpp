import Link from 'next/link';
import { asc, desc } from 'drizzle-orm';
import { db } from '@/db';
import { breaches, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { ActionForm } from '@/components/form';
import { Banner, EmptyState, Field, Input, Panel, Record, Select, StaffBand, Textarea, cx } from '@/components/ui';
import { advanceBreach, logBreach, scopeBreach } from '@/modules/compliance/register-actions';
import { breachClock, formatClock, ndpcDeadline } from '@/modules/compliance/breach-clock';

/**
 * DP-05 breach register — `app./dpo/breaches` (CMP-09, a Must).
 *
 * Leads with the clock, because NDPA s.40 gives 72 hours from awareness and
 * the only question that matters on the day is how many are left. Unnotified
 * breaches sort by deadline, so the one closest to the wall is first.
 *
 * The notification template is on the page rather than in a document
 * somewhere, because the worst time to go looking for the contents of an NDPC
 * notification is hour 70.
 */
export default async function BreachRegister({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string; updated?: string; scoped?: string; n?: string }>;
}) {
  const me = await requireRole('dpo', 'super_admin');
  const { logged, updated, scoped, n } = await searchParams;

  const rows = await db.select().from(breaches).orderBy(desc(breaches.discoveredAt));
  const insts = await db.select().from(institutions).orderBy(asc(institutions.name));
  const instName = (id: string | null) =>
    id ? (insts.find((i) => i.id === id)?.shortName ?? 'Unknown') : 'Platform-wide';

  const withClock = rows.map((b) => ({
    b,
    clock: breachClock({ discoveredAt: b.discoveredAt, ndpcNotifiedAt: b.ndpcNotifiedAt }),
  }));

  // Unnotified first, nearest deadline first. A register sorted by date
  // logged puts the most urgent row wherever it happens to fall.
  const open = withClock
    .filter(({ b }) => b.status !== 'closed')
    .sort((x, y) => {
      const xn = x.clock.state === 'notified' ? 1 : 0;
      const yn = y.clock.state === 'notified' ? 1 : 0;
      if (xn !== yn) return xn - yn;
      return x.clock.hoursLeft - y.clock.hoursLeft;
    });
  const closed = withClock.filter(({ b }) => b.status === 'closed');

  const overdue = open.filter(({ clock }) => clock.state === 'overdue');

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform" role="dpo" />
      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-caption m-0">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Data protection
          </Link>
        </p>
        <h1 className="t-h1 mt-2 mb-2 text-ink-900">Breach register</h1>
        <p className="t-body measure mt-0 mb-8 text-ink-700">
          The Commission must be told within 72 hours of the controller becoming aware of a breach
          (NDPA s.40). A partner institution must be told immediately, because its own 72 hours
          starts when it learns.
        </p>

        {overdue.length > 0 ? (
          <div className="mb-8">
            <Banner tone="danger" title={`${overdue.length} past the 72-hour deadline`}>
              <p>
                The Commission has not been notified and the deadline has passed. Notify now and
                record the time. A late notification is still a notification; no notification is a
                second breach of the Act.
              </p>
            </Banner>
          </div>
        ) : null}

        {logged ? (
          <div className="mb-8">
            <Banner tone="info" title="Breach logged">
              <p>The clock below is running from the discovery time you entered.</p>
            </Banner>
          </div>
        ) : null}
        {updated ? (
          <div className="mb-8">
            <Banner tone="verified" title="Register updated">
              <p>The change is in the audit log with your name and the time.</p>
            </Banner>
          </div>
        ) : null}
        {scoped ? (
          <div className="mb-8">
            <Banner tone="info" title={`${n ?? '0'} data subjects in scope`}>
              <p>
                Every distinct person whose record was read or written at that institution during
                the window. It is recorded on the breach as the affected count.
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <h2 className="t-h2 mt-0 mb-4 text-ink-900">Open</h2>
            {open.length === 0 ? (
              <EmptyState heading="No open breaches">
                Nothing is on the clock. If that changes, log it the moment you are aware.
              </EmptyState>
            ) : (
              <ul className="m-0 grid list-none gap-6 p-0">
                {open.map(({ b, clock }) => (
                  <li key={b.id}>
                    <Record
                      title={b.title}
                      meta={`${instName(b.institutionId)} · ${b.severity} severity`}
                      className={cx(
                        clock.state === 'overdue' && 'border-l-[3px] border-l-danger',
                        clock.state === 'due_soon' && 'border-l-[3px] border-l-warning',
                      )}
                    >
                      <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Commission</dt>
                          <dd
                            className={cx(
                              't-data m-0 ml-0',
                              clock.state === 'overdue' && 'text-danger',
                              clock.state === 'due_soon' && 'text-warning',
                              clock.state === 'running' && 'text-ink-900',
                              clock.state === 'notified' && 'text-verified-text',
                            )}
                          >
                            {clock.state === 'notified'
                              ? clock.late
                                ? 'Notified late'
                                : 'Notified'
                              : formatClock(clock.hoursLeft)}
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Deadline</dt>
                          <dd className="t-body-sm m-0 ml-0 text-ink-900">
                            {ndpcDeadline(b.discoveredAt).toLocaleString('en-NG')}
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Subjects in scope</dt>
                          <dd className="t-data m-0 ml-0 text-ink-900">
                            {b.affectedSubjectCount ?? 'Not scoped'}
                          </dd>
                        </div>
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Status</dt>
                          <dd className="t-body-sm m-0 ml-0 text-ink-900">{b.status}</dd>
                        </div>
                      </dl>
                      <p className="t-body-sm measure mt-0 mb-5 text-ink-700">{b.description}</p>

                      <details className="mb-4">
                        <summary className="t-body-sm cursor-pointer text-ink-900">
                          Scope the affected data subjects
                        </summary>
                        <div className="mt-4">
                          <ActionForm action={scopeBreach} submitLabel="Count the subjects in scope">
                            <input type="hidden" name="breachId" value={b.id} />
                            <div className="grid gap-x-6 md:grid-cols-2">
                              <Field label="From" name="from" inputId={`from-${b.id}`} required>
                                <Input id={`from-${b.id}`} name="from" type="datetime-local" required />
                              </Field>
                              <Field label="To" name="to" inputId={`to-${b.id}`} required>
                                <Input id={`to-${b.id}`} name="to" type="datetime-local" required />
                              </Field>
                            </div>
                          </ActionForm>
                        </div>
                      </details>

                      <div className="grid gap-4 md:grid-cols-2">
                        {!b.ndpcNotifiedAt ? (
                          <ActionForm action={advanceBreach} submitLabel="Record: Commission notified">
                            <input type="hidden" name="breachId" value={b.id} />
                            <input type="hidden" name="step" value="ndpc" />
                            <Field
                              label="Notified at"
                              name="at"
                              inputId={`ndpc-${b.id}`}
                              helper="Leave blank for now."
                            >
                              <Input id={`ndpc-${b.id}`} name="at" type="datetime-local" />
                            </Field>
                          </ActionForm>
                        ) : null}
                        {!b.subjectsNotifiedAt ? (
                          <ActionForm action={advanceBreach} submitLabel="Record: subjects notified">
                            <input type="hidden" name="breachId" value={b.id} />
                            <input type="hidden" name="step" value="subjects" />
                          </ActionForm>
                        ) : null}
                        {b.status === 'open' ? (
                          <ActionForm action={advanceBreach} submitLabel="Record: contained">
                            <input type="hidden" name="breachId" value={b.id} />
                            <input type="hidden" name="step" value="contained" />
                          </ActionForm>
                        ) : null}
                        <ActionForm action={advanceBreach} submitLabel="Close the breach">
                          <input type="hidden" name="breachId" value={b.id} />
                          <input type="hidden" name="step" value="close" />
                        </ActionForm>
                      </div>
                    </Record>
                  </li>
                ))}
              </ul>
            )}

            {closed.length > 0 ? (
              <>
                <h2 className="t-h2 mt-12 mb-4 text-ink-900">Closed</h2>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {closed.map(({ b, clock }) => (
                    <li key={b.id} className="border-t border-ink-300 pt-3">
                      <p className="t-body-sm m-0 text-ink-900">
                        {b.title}{' '}
                        <span className="text-ink-700">
                          · {instName(b.institutionId)} ·{' '}
                          {clock.late ? 'Commission notified late' : 'Commission notified in time'}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <aside className="space-y-6">
            <Panel title="Log a breach">
              <ActionForm action={logBreach} submitLabel="Log it and start the clock">
                <Field label="Title" name="title" inputId="breach-title" required>
                  <Input id="breach-title" name="title" required />
                </Field>
                <Field
                  label="Discovered at"
                  name="discoveredAt"
                  inputId="breach-discovered"
                  required
                  helper="When anybody here became aware of it. The 72 hours run from this, not from now."
                >
                  <Input id="breach-discovered" name="discoveredAt" type="datetime-local" required />
                </Field>
                <div className="grid gap-x-6 md:grid-cols-2">
                  <Field label="Severity" name="severity" inputId="breach-severity" required>
                    <Select id="breach-severity" name="severity" required defaultValue="">
                      <option value="" disabled>
                        Choose
                      </option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </Field>
                  <Field label="Institution" name="institutionId" inputId="breach-inst">
                    <Select id="breach-inst" name="institutionId" defaultValue="">
                      <option value="">Platform-wide</option>
                      {insts.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.shortName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field
                  label="Data involved"
                  name="dataCategories"
                  inputId="breach-categories"
                  helper="Comma separated: identity documents, contact details, payment references…"
                >
                  <Input id="breach-categories" name="dataCategories" />
                </Field>
                <Field label="What happened" name="description" inputId="breach-description" required>
                  <Textarea id="breach-description" name="description" rows={4} required />
                </Field>
              </ActionForm>
            </Panel>

            <Panel title="What the notification has to say">
              {/* NDPA s.40: the contents, where the DPO will look for them at
                  hour 70 rather than in a document somewhere. */}
              <ol className="t-body-sm m-0 grid list-decimal gap-2 pl-5 text-ink-700">
                <li>The nature of the breach, including the categories and approximate number of data subjects and records.</li>
                <li>The name and contact details of the Data Protection Officer.</li>
                <li>The likely consequences for the people affected.</li>
                <li>The measures taken or proposed, including to mitigate harm.</li>
              </ol>
              <p className="t-caption mt-4 mb-0 text-ink-700">
                If everything is not known yet, notify with what is known and follow up. A complete
                notice on day four is a late one.
              </p>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
