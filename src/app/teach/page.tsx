import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { announcements, assessments, cohorts, lessons, modules, submissions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, EmptyState, LinkButton, Panel, Record, cx } from '@/components/ui';
import { AnnouncementComposer, AnnouncementRemove } from '@/components/announcement-panels';

/**
 * FC-01 facilitator course list.
 *
 * Assigned modules, pending grading count, cohort. Grading leads, because it
 * is the thing with someone waiting on the other end — a student cannot see
 * a result until a facilitator has looked at it, and LRN-05 makes that a
 * person's job rather than a job the system does.
 */
export default async function MyModules() {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const mine = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(modules)
      .where(eq(modules.facilitatorId, me.userId))
      .orderBy(asc(modules.semester), asc(modules.position)),
  );

  const moduleIds = mine.map((m) => m.id);

  const lessonCounts = moduleIds.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select({ moduleId: lessons.moduleId, n: sql<number>`count(*)::int` })
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .groupBy(lessons.moduleId),
      )
    : [];

  // Everything submitted and not yet marked, per module.
  const waiting = moduleIds.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select({ moduleId: assessments.moduleId, n: sql<number>`count(*)::int` })
          .from(submissions)
          .innerJoin(assessments, eq(assessments.id, submissions.assessmentId))
          .where(
            and(
              inArray(assessments.moduleId, moduleIds),
              eq(submissions.status, 'submitted'),
            ),
          )
          .groupBy(assessments.moduleId),
      )
    : [];

  const running = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(inArray(cohorts.status, ['open', 'running'])),
  );

  // LRN-06: what this facilitator has already told their cohorts, newest
  // first. Scoped to the cohorts that are actually running, so a console does
  // not slowly fill with notices about intakes that finished years ago.
  const posted = running.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(announcements)
          .where(inArray(announcements.cohortId, running.map((c) => c.id)))
          .orderBy(desc(announcements.createdAt))
          .limit(10),
      )
    : [];
  const cohortNames = new Map(running.map((c) => [c.id, c.name]));

  const lessonsBy = new Map(lessonCounts.map((r) => [r.moduleId, Number(r.n)]));
  const waitingBy = new Map(waiting.map((r) => [r.moduleId, Number(r.n)]));
  const totalWaiting = [...waitingBy.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">My modules</h1>
        <p className="t-caption m-0 text-ink-700">
          {running.map((c) => c.name).join(' · ') || 'No cohort is running'}
        </p>
      </div>

      {totalWaiting > 0 ? (
        <div className="mb-6">
          <Banner tone="warning" title={`${totalWaiting} ${totalWaiting === 1 ? 'submission is' : 'submissions are'} waiting to be marked`}>
            <p>
              Nobody can see their result until you have looked at it.{' '}
              <Link href="/teach/grading" className="text-ink-900 underline underline-offset-2">
                Open the grading queue
              </Link>
              .
            </p>
          </Banner>
        </div>
      ) : null}

      {mine.length === 0 ? (
        <EmptyState heading="No modules are assigned to you">
          An institution admin assigns modules to facilitators. Once one is yours, it appears here
          with its lessons and its grading queue.
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-5 p-0 md:grid-cols-2">
          {mine.map((m) => {
            const pending = waitingBy.get(m.id) ?? 0;
            return (
              <Record
                as="li"
                key={m.id}
                title={`${m.code} · ${m.title}`}
                meta={`Semester ${m.semester} · ${lessonsBy.get(m.id) ?? 0} lessons · ${
                  m.published ? 'published' : 'draft'
                }`}
              >
                {m.summary ? (
                  <p className="t-body-sm mt-0 mb-4 text-ink-700">{m.summary}</p>
                ) : (
                  <p className="t-body-sm mt-0 mb-4 text-warning">
                    No summary yet — the module cannot be published without one.
                  </p>
                )}

                <p className={cx('t-body-sm mb-4', pending > 0 ? 'text-ink-900' : 'text-ink-700')}>
                  {pending > 0
                    ? `${pending} submission${pending === 1 ? '' : 's'} waiting`
                    : 'Nothing waiting to be marked'}
                </p>

                <div className="flex flex-wrap gap-3">
                  <LinkButton href={`/teach/${m.id}`} size="dense" variant="secondary">
                    Edit content
                  </LinkButton>
                  {pending > 0 ? (
                    <LinkButton href="/teach/grading" size="dense">
                      Mark work
                    </LinkButton>
                  ) : null}
                </div>
              </Record>
            );
          })}
        </ul>
      )}

      {/* LRN-06. The dashboard has rendered these since the beginning and
          nothing could write one, so every cohort's announcements were
          whatever the seed said. */}
      <p className="t-body-sm mt-8">
        <Link href="/teach/sessions" className="text-ink-900 underline underline-offset-2">
          Live sessions and the attendance register
        </Link>
      </p>

      <h2 className="t-h2 mt-14 mb-4 text-ink-900">Announcements</h2>
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div>
          {posted.length === 0 ? (
            <EmptyState heading="Nothing posted yet">
              An announcement appears on the dashboard of everyone in the cohort. Use it for a
              deadline moving, or a session being rescheduled.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0">
              {posted.map((a) => (
                <Record
                  as="li"
                  key={a.id}
                  title={a.title}
                  meta={`${cohortNames.get(a.cohortId ?? '') ?? 'Cohort'} · ${a.createdAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}`}
                >
                  <p className="t-body-sm mt-0 mb-4 whitespace-pre-line text-ink-900">{a.body}</p>
                  <AnnouncementRemove announcementId={a.id} title={a.title} />
                </Record>
              ))}
            </ul>
          )}
        </div>

        <aside>
          <Panel title="Post an announcement">
            <AnnouncementComposer
              cohorts={running.map((c) => ({ id: c.id, name: c.name }))}
            />
          </Panel>
        </aside>
      </div>

      <p className="t-caption mt-10 text-ink-700">
        Everything you do here is recorded against your account, including opening a student&apos;s
        submission.
      </p>
    </>
  );
}
