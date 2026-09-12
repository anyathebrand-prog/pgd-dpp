import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import {
  announcements,
  cohorts,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  programmes,
} from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { DataString, EmptyState, LinkButton, Panel, Record } from '@/components/ui';

/**
 * ST-01 student dashboard.
 *
 * One question first: what do I do next. The resume link is the primary action
 * because LRN-03's whole point is that a student on a phone at 11pm should not
 * have to find their place again.
 */
export default async function Dashboard() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [enrollment] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, me.userId), eq(enrollments.status, 'active')))
      .limit(1),
  );
  if (!enrollment) redirect('/apply');

  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, enrollment.cohortId)).limit(1),
  );

  const [programme] = await withTenant(institution.id, (tx) =>
    tx.select().from(programmes).where(eq(programmes.institutionId, institution.id)).limit(1),
  );

  const allLessons = programme
    ? await withTenant(institution.id, (tx) =>
        tx
          .select({
            lessonId: lessons.id,
            lessonTitle: lessons.title,
            lessonPosition: lessons.position,
            moduleId: modules.id,
            moduleTitle: modules.title,
            modulePosition: modules.position,
            completedAt: lessonProgress.completedAt,
            positionSeconds: lessonProgress.positionSeconds,
          })
          .from(lessons)
          .innerJoin(modules, eq(modules.id, lessons.moduleId))
          .leftJoin(
            lessonProgress,
            and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, me.userId)),
          )
          .where(and(eq(modules.programmeId, programme.id), eq(modules.published, true)))
          .orderBy(modules.position, lessons.position),
      )
    : [];

  const done = allLessons.filter((l) => l.completedAt).length;
  const next = allLessons.find((l) => !l.completedAt);
  const percent = allLessons.length ? Math.round((done / allLessons.length) * 100) : 0;

  const notices = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(announcements)
      .where(eq(announcements.cohortId, enrollment.cohortId))
      .orderBy(desc(announcements.createdAt))
      .limit(4),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <p className="t-label m-0 text-ink-700">{institution.name}</p>
        <h1 className="t-h1 mt-2 text-ink-900">{me.fullName ?? 'Your programme'}</h1>
        <p className="t-caption mt-2 text-ink-700">
          <DataString value={enrollment.matricNumber} label="Matriculation number" /> · {cohort?.name}
        </p>

        <div className="mt-10 grid gap-8 md:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            {next ? (
              <Record
                title={next.lessonTitle}
                meta={`${next.moduleTitle} · ${done === 0 ? 'your first lesson' : 'where you left off'}`}
              >
                <LinkButton href={`/lesson/${next.lessonId}`}>
                  {next.positionSeconds ? 'Resume this lesson' : 'Start this lesson'}
                </LinkButton>
              </Record>
            ) : allLessons.length ? (
              <Record title="You have finished every published lesson" meta="Assessments remain">
                <LinkButton href="/programme">Review the programme</LinkButton>
              </Record>
            ) : (
              <EmptyState heading="Your modules are not published yet">
                {institution.shortName} publishes each module as the cohort reaches it. You will see
                them here, and you will be told when the first one opens.
              </EmptyState>
            )}

            <Panel title="Progress">
              <p className="t-body-sm m-0 mb-3 text-ink-700">
                {done} of {allLessons.length} lessons complete
              </p>
              {/* A progress fill is one of the few legitimate uses of Signal:
                  it means completed, which is what Signal is reserved for. */}
              <div
                className="h-2 w-full overflow-hidden bg-ink-100"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Lessons complete"
              >
                <div className="h-full bg-verified-fill" style={{ width: `${percent}%` }} />
              </div>
            </Panel>
          </div>

          <aside className="space-y-6">
            <Panel title="Announcements">
              {notices.length === 0 ? (
                <p className="t-body-sm m-0 text-ink-700">Nothing from your cohort yet.</p>
              ) : (
                <ul className="m-0 list-none space-y-4 p-0">
                  {notices.map((n) => (
                    <li key={n.id}>
                      <p className="t-body-sm m-0 font-semibold text-ink-900">{n.title}</p>
                      <p className="t-body-sm m-0 text-ink-700">{n.body}</p>
                      <p className="t-caption m-0 text-ink-700">
                        {n.createdAt.toLocaleDateString('en-NG')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Elsewhere">
              <ul className="m-0 list-none space-y-2 p-0">
                {[
                  ['/grades', 'Your grades'],
                  ['/certificates', 'Certificates'],
                  ['/billing', 'Payments and receipts'],
                  ['/library', 'E-Library'],
                  ['/account/privacy', 'Privacy and consent'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="t-body-sm text-ink-900 underline underline-offset-2">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
