import Link from 'next/link';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, enrollments, liveSessions, sessionAttendance, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, DataString, EmptyState, Panel, Record } from '@/components/ui';
import { RecordingForm, SessionForm } from '@/components/session-panels';

/**
 * FC — scheduling live sessions and reading the register (LRN-07, LRN-10).
 *
 * The attendance half is the part with a use beyond this term: §5.5 ties it
 * to NUC accreditation evidence, which means an institution has to be able to
 * produce it years later. So it is counted against the cohort rather than
 * shown as a bare list — "nine of twenty-three" is the shape of the question
 * an accreditation panel asks.
 *
 * What the register attests to is stated plainly on the page, because it is
 * narrower than the word "attendance" implies: this platform handed someone
 * the link at a particular moment. It was not in the call.
 */
export default async function Sessions() {
  const institution = await requireInstitution();
  await requireRole('facilitator', 'institution_admin');

  const intakes = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(inArray(cohorts.status, ['open', 'running'])).orderBy(asc(cohorts.startsAt)),
  );

  const sessions = await withTenant(institution.id, (tx) =>
    tx.select().from(liveSessions).orderBy(desc(liveSessions.startsAt)).limit(30),
  );

  const attendance = sessions.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(sessionAttendance)
          .where(
            inArray(
              sessionAttendance.sessionId,
              sessions.map((s) => s.id),
            ),
          ),
      )
    : [];

  // How many people the session was for, so a count means something.
  const enrolled = await withTenant(institution.id, (tx) =>
    tx.select().from(enrollments).where(eq(enrollments.status, 'active')),
  );

  const attendeeIds = [...new Set(attendance.map((a) => a.userId))];
  const people = attendeeIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, attendeeIds))
    : [];
  const nameOf = (id: string) => {
    const person = people.find((p) => p.id === id);
    return person?.fullName ?? person?.email ?? 'A student';
  };

  const now = Date.now();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Live sessions</h1>
        <p className="t-caption m-0 text-ink-700">Most recent first</p>
      </div>

      <div className="mb-8">
        <Banner tone="info" title="What the register actually says">
          <p>
            It records that this platform handed someone the join link, and when. It cannot say
            whether they stayed, because the call is on Zoom or Meet and we are not in it. That is
            the honest claim to make in an accreditation file, so it is the claim the page makes.
          </p>
        </Banner>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
        <div>
          {sessions.length === 0 ? (
            <EmptyState heading="Nothing scheduled">
              Schedule one and it appears on your students&apos; live sessions page, with a
              calendar invite.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-6 p-0">
              {sessions.map((session) => {
                const joined = attendance.filter((a) => a.sessionId === session.id);
                const audience = session.cohortId
                  ? enrolled.filter((e) => e.cohortId === session.cohortId).length
                  : enrolled.length;
                const ended = session.startsAt.getTime() + session.durationMinutes * 60_000 < now;

                return (
                  <Record
                    as="li"
                    key={session.id}
                    title={session.title}
                    meta={`${session.startsAt.toLocaleString('en-NG', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })} · ${session.durationMinutes} minutes${
                      session.cohortId
                        ? ` · ${intakes.find((c) => c.id === session.cohortId)?.name ?? 'one cohort'}`
                        : ' · every cohort'
                    }`}
                  >
                    {session.description ? (
                      <p className="t-body-sm mt-0 mb-4 text-ink-700">{session.description}</p>
                    ) : null}

                    <p className="t-body-sm mt-0 mb-4 text-ink-900">
                      <strong>
                        {joined.length} of {audience}
                      </strong>{' '}
                      {joined.length === 1 ? 'student was' : 'students were'} given the link
                      {ended ? '' : ' so far'}.
                    </p>

                    {joined.length > 0 ? (
                      <details className="mb-4">
                        <summary className="t-body-sm cursor-pointer text-ink-900">
                          Who, and when
                        </summary>
                        <ul className="m-0 mt-3 list-none space-y-1 p-0">
                          {joined.map((a) => (
                            <li key={a.id} className="t-caption text-ink-700">
                              {nameOf(a.userId)} ·{' '}
                              <DataString
                                value={a.joinedAt.toISOString().slice(0, 16).replace('T', ' ')}
                                label="Joined at"
                              />
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    {ended ? <RecordingForm sessionId={session.id} url={session.recordingUrl ?? ''} /> : null}
                  </Record>
                );
              })}
            </ul>
          )}
        </div>

        <aside>
          <Panel title="Schedule a session">
            <SessionForm cohorts={intakes.map((c) => ({ id: c.id, name: c.name }))} />
          </Panel>
        </aside>
      </div>

      <p className="t-body-sm mt-10">
        <Link href="/teach" className="text-ink-700 underline underline-offset-2">
          Back to my modules
        </Link>
      </p>
    </>
  );
}
