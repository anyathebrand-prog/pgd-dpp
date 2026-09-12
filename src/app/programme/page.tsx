import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, enrollments, lessonProgress, lessons, modules, programmes } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { EmptyState, Record } from '@/components/ui';

/**
 * ST-02 programme structure (LRN-01: programme → semester → module → lesson).
 *
 * Each module is a Record card, because a module is a filed artefact — a thing
 * on the record about what you are studying. The lesson list inside it is not.
 */
export default async function ProgrammePage() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [enrollment] = await withTenant(institution.id, (tx) =>
    tx.select().from(enrollments).where(eq(enrollments.userId, me.userId)).limit(1),
  );
  if (!enrollment) redirect('/apply');

  const [programme] = await withTenant(institution.id, (tx) =>
    tx.select().from(programmes).where(eq(programmes.institutionId, institution.id)).limit(1),
  );
  if (!programme) redirect('/dashboard');

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({
        moduleId: modules.id,
        moduleCode: modules.code,
        moduleTitle: modules.title,
        moduleSummary: modules.summary,
        semester: modules.semester,
        modulePosition: modules.position,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        lessonPosition: lessons.position,
        completedAt: lessonProgress.completedAt,
      })
      .from(modules)
      .leftJoin(lessons, eq(lessons.moduleId, modules.id))
      .leftJoin(
        lessonProgress,
        and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, me.userId)),
      )
      .where(and(eq(modules.programmeId, programme.id), eq(modules.published, true)))
      .orderBy(modules.semester, modules.position, lessons.position),
  );

  const tests = await withTenant(institution.id, (tx) =>
    tx
      .select({ id: assessments.id, moduleId: assessments.moduleId, title: assessments.title })
      .from(assessments)
      .where(eq(assessments.published, true)),
  );

  const bySemester = new Map<number, Map<string, typeof rows>>();
  for (const r of rows) {
    if (!bySemester.has(r.semester)) bySemester.set(r.semester, new Map());
    const sem = bySemester.get(r.semester)!;
    if (!sem.has(r.moduleId)) sem.set(r.moduleId, []);
    sem.get(r.moduleId)!.push(r);
  }

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">{programme.title}</h1>
        <p className="t-body measure mt-3 text-ink-700">{programme.summary}</p>

        {rows.length === 0 ? (
          <div className="mt-10">
            <EmptyState heading="No modules are published yet">
              {institution.shortName} publishes modules as the cohort reaches them.
            </EmptyState>
          </div>
        ) : null}

        {[...bySemester.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([semester, mods]) => (
            <section key={semester} className="mt-12">
              <h2 className="t-h2 m-0 text-ink-900">Semester {semester}</h2>
              <ul className="mt-6 grid list-none gap-5 p-0">
                {[...mods.values()].map((lessonRows) => {
                  const head = lessonRows[0];
                  const real = lessonRows.filter((l) => l.lessonId);
                  const done = real.filter((l) => l.completedAt).length;
                  const moduleTests = tests.filter((t) => t.moduleId === head.moduleId);
                  return (
                    <Record
                      as="li"
                      key={head.moduleId}
                      title={`${head.moduleCode} · ${head.moduleTitle}`}
                      meta={`${done} of ${real.length} lessons complete`}
                    >
                      {head.moduleSummary ? (
                        <p className="t-body-sm mt-0 mb-4 text-ink-700">{head.moduleSummary}</p>
                      ) : null}
                      <ol className="m-0 list-none space-y-2 p-0">
                        {real.map((l) => (
                          <li key={l.lessonId} className="t-body-sm flex items-baseline gap-2">
                            <span aria-hidden="true" className="w-4 text-ink-700">
                              {l.completedAt ? '✓' : '·'}
                            </span>
                            <Link
                              href={`/lesson/${l.lessonId}`}
                              className="text-ink-900 underline underline-offset-2"
                            >
                              {l.lessonTitle}
                            </Link>
                            {l.completedAt ? <span className="sr-only"> — completed</span> : null}
                          </li>
                        ))}
                      </ol>
                      {moduleTests.length > 0 ? (
                        <ul className="mt-4 list-none space-y-1 border-t border-ink-700/20 p-0 pt-4">
                          {moduleTests.map((t) => (
                            <li key={t.id} className="t-body-sm">
                              <Link
                                href={`/assessment/${t.id}`}
                                className="font-semibold text-authority underline underline-offset-2"
                              >
                                {t.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Record>
                  );
                })}
              </ul>
            </section>
          ))}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
