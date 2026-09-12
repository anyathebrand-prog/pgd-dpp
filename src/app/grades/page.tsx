import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, grades, modules, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { EmptyState, cx } from '@/components/ui';

/** ST-08 gradebook (LRN-05). */
export default async function Gradebook() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({
        assessmentTitle: assessments.title,
        assessmentId: assessments.id,
        passMark: assessments.passMark,
        moduleCode: modules.code,
        moduleTitle: modules.title,
        attempt: submissions.attempt,
        status: submissions.status,
        submittedAt: submissions.submittedAt,
        score: grades.score,
        maxScore: grades.maxScore,
      })
      .from(submissions)
      .innerJoin(assessments, eq(assessments.id, submissions.assessmentId))
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .leftJoin(grades, eq(grades.submissionId, submissions.id))
      .where(eq(submissions.userId, me.userId))
      .orderBy(modules.position, submissions.attempt),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Your grades</h1>

        {rows.length === 0 ? (
          <div className="mt-8">
            <EmptyState heading="Nothing marked yet">
              Results appear here once you have submitted an assessment and it has been marked.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Your assessment results by module</caption>
              <thead>
                <tr className="border-b border-ink-500">
                  {['Module', 'Assessment', 'Attempt', 'Result', 'Outcome'].map((h) => (
                    <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const marked = r.score !== null && r.maxScore !== null;
                  const percent = marked ? (r.score! / r.maxScore!) * 100 : null;
                  const passed = percent !== null && percent >= r.passMark;
                  return (
                    <tr key={`${r.assessmentId}-${r.attempt}`} className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}>
                      <td className="t-body-sm px-3 py-3 text-ink-700">{r.moduleCode}</td>
                      <td className="t-body-sm px-3 py-3 text-ink-900">
                        <Link href={`/assessment/${r.assessmentId}/result`} className="text-ink-900 underline underline-offset-2">
                          {r.assessmentTitle}
                        </Link>
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">{r.attempt}</td>
                      <td className="t-data px-3 py-3 text-ink-900">
                        {marked ? `${r.score}/${r.maxScore}` : '—'}
                      </td>
                      <td className="t-body-sm px-3 py-3">
                        {!marked ? (
                          <span className="text-ink-700">Waiting to be marked</span>
                        ) : passed ? (
                          <span className="font-semibold text-verified-text">Passed</span>
                        ) : (
                          <span className="text-ink-900">Below the {r.passMark}% pass mark</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
