import Link from 'next/link';
import { and, asc, desc, eq, or, isNull } from 'drizzle-orm';
import { withTenant } from '@/db';
import { enrollments, liveSessions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, EmptyState, Panel, Record, cx } from '@/components/ui';
import { JoinButton } from '@/components/session-panels';

/**
 * ST-11 live sessions (LRN-07).
 *
 * The five states the flow names are all real and all visible here: upcoming,
 * live now, ended, recording available, and nothing scheduled. "Live now" is
 * computed from the clock rather than set by anyone, because a facilitator
 * who forgets to flip a switch should not make a session invisible to the
 * people waiting for it.
 *
 * The join link is never printed. It arrives when someone joins, which is
 * also when their attendance is recorded (LRN-10).
 */
export default async function LiveSessions() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [enrolment] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, me.userId),
          eq(enrollments.institutionId, institution.id),
          eq(enrollments.status, 'active'),
        ),
      )
      .limit(1),
  );

  // A session either names a cohort or is open to the institution. Someone
  // with no active enrolment — a facilitator, an alumnus — sees the open ones.
  const sessions = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(liveSessions)
      .where(
        enrolment
          ? or(isNull(liveSessions.cohortId), eq(liveSessions.cohortId, enrolment.cohortId))
          : isNull(liveSessions.cohortId),
      )
      .orderBy(asc(liveSessions.startsAt)),
  );

  const now = Date.now();
  const endOf = (s: (typeof sessions)[number]) =>
    s.startsAt.getTime() + s.durationMinutes * 60_000;

  const upcoming = sessions.filter((s) => endOf(s) > now);
  const past = sessions.filter((s) => endOf(s) <= now).sort((a, b) => +b.startsAt - +a.startsAt);

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Live sessions</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          Taught live by your facilitators. Everything on this programme is assessed from the
          written material, so a session you miss costs you nothing but the conversation.
        </p>

        {upcoming.length === 0 && past.length === 0 ? (
          <EmptyState heading="Nothing scheduled">
            Live sessions appear here when a facilitator schedules one, with a calendar invite you
            can add before you forget.
          </EmptyState>
        ) : null}

        {upcoming.length > 0 ? (
          <ul className="m-0 grid list-none gap-5 p-0">
            {upcoming.map((session) => {
              const live = session.startsAt.getTime() <= now;
              const soon = !live && session.startsAt.getTime() - now < 60 * 60_000;

              return (
                <Record
                  as="li"
                  key={session.id}
                  title={session.title}
                  meta={session.startsAt.toLocaleString('en-NG', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  className={cx(live && 'border-l-[3px] border-l-verified-fill')}
                >
                  {live ? (
                    <p className="t-body-sm mt-0 mb-3 font-semibold text-verified-text">
                      Happening now — {session.durationMinutes} minutes from the start time.
                    </p>
                  ) : null}
                  {soon ? (
                    <p className="t-body-sm mt-0 mb-3 text-ink-900">Starting within the hour.</p>
                  ) : null}
                  {session.description ? (
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">{session.description}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-4">
                    <JoinButton
                      sessionId={session.id}
                      label={live ? 'Join now' : 'Get the link'}
                    />
                    <a
                      href={`/api/sessions/${session.id}/calendar`}
                      className="t-body-sm text-ink-900 underline underline-offset-2"
                    >
                      Add to my calendar
                    </a>
                  </div>

                  <p className="t-caption mt-3 mb-0 text-ink-700">
                    {/* CMP-14 in plain words, where the person can act on it. */}
                    Opening the link records that you joined — that record is what your university
                    files as attendance evidence.
                  </p>
                </Record>
              );
            })}
          </ul>
        ) : null}

        {past.length > 0 ? (
          <>
            <h2 className="t-h2 mt-12 mb-4 text-ink-900">Already happened</h2>
            <ul className="m-0 grid list-none gap-4 p-0">
              {past.slice(0, 20).map((session) => (
                <li key={session.id} className="border-b border-ink-300 pb-4">
                  <p className="t-body-sm m-0 font-semibold text-ink-900">{session.title}</p>
                  <p className="t-caption m-0 text-ink-700">
                    {session.startsAt.toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  {session.recordingUrl ? (
                    <p className="t-body-sm mt-2 mb-0">
                      <a
                        href={session.recordingUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="text-authority underline underline-offset-2"
                      >
                        Watch the recording
                      </a>
                    </p>
                  ) : (
                    <p className="t-caption mt-2 mb-0 text-ink-700">No recording was published.</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-12">
          <Panel title="If the link does not work">
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              The call itself runs on Zoom, Meet or Teams — whichever your facilitator uses — and
              this platform only holds the link. If it fails, the conversation to have is with
              them, not with support here.
            </p>
          </Panel>
        </div>

        <p className="t-body-sm mt-8">
          <Link href="/programme" className="text-ink-700 underline underline-offset-2">
            Back to the programme
          </Link>
        </p>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
