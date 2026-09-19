import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, grades, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { TopBar, Footer } from '@/components/shell';
import { Banner, LinkButton, Record } from '@/components/ui';

/** ST-06. */
export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [assessment] = await withTenant(institution.id, (tx) =>
    tx.select().from(assessments).where(eq(assessments.id, id)).limit(1),
  );
  if (!assessment) notFound();

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({ submission: submissions, grade: grades })
      .from(submissions)
      .leftJoin(grades, eq(grades.submissionId, submissions.id))
      .where(and(eq(submissions.assessmentId, id), eq(submissions.userId, me.userId)))
      .orderBy(desc(submissions.attempt)),
  );

  const latest = rows[0];

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">{assessment.title}</h1>

        {!latest ? (
          <p className="t-body mt-6 text-ink-700">You have not attempted this assessment.</p>
        ) : latest.submission.status === 'returned' ? (
          <div className="mt-8">
            {/* Not an error — a returned submission is work in progress, and
                styling it as a failure would misread what happened. */}
            <Banner tone="warning" title="Returned for revision">
              <p>{latest.submission.returnedNote}</p>
              <p className="mt-2">
                Your facilitator has asked for changes rather than marking it. Attempt it again
                once you have addressed the above.
              </p>
            </Banner>
          </div>
        ) : latest.submission.status === 'submitted' ? (
          <div className="mt-8">
            {/* Not an error, so not --danger. Pending marking is a neutral state. */}
            <Banner tone="info" title="Waiting to be marked">
              <p>
                Your answers were received on{' '}
                {latest.submission.submittedAt?.toLocaleString('en-NG')}. Some questions on this
                assessment are marked by your facilitator rather than automatically, so the result
                is not immediate. You will see it here and in your gradebook.
              </p>
            </Banner>
          </div>
        ) : latest.grade ? (
          <div className="mt-8">
            <Record
              title={`${latest.grade.score} out of ${latest.grade.maxScore}`}
              meta={`Attempt ${latest.submission.attempt} · marked ${latest.grade.gradedAt.toLocaleDateString('en-NG')}`}
            >
              <p
                className={
                  (latest.grade.score / latest.grade.maxScore) * 100 >= assessment.passMark
                    ? 't-body-sm m-0 font-semibold text-verified-text'
                    : 't-body-sm m-0 font-semibold text-ink-900'
                }
              >
                {(latest.grade.score / latest.grade.maxScore) * 100 >= assessment.passMark
                  ? `Passed — the pass mark is ${assessment.passMark}%.`
                  : `Below the ${assessment.passMark}% pass mark.`}
              </p>
              {latest.grade.feedback ? (
                <div className="mt-4 border-t border-ink-700/20 pt-4">
                  <p className="t-caption m-0 mb-1 text-ink-700">Feedback</p>
                  <p className="t-body-sm m-0 whitespace-pre-line text-ink-900">
                    {latest.grade.feedback}
                  </p>
                </div>
              ) : null}
            </Record>
          </div>
        ) : null}

        {rows.length > 1 ? (
          <div className="mt-10">
            <h2 className="t-h3 m-0 text-ink-900">Earlier attempts</h2>
            <ul className="t-body-sm mt-3 list-none space-y-2 p-0 text-ink-700">
              {rows.slice(1).map((r) => (
                <li key={r.submission.id}>
                  Attempt {r.submission.attempt} ·{' '}
                  {r.grade ? `${r.grade.score}/${r.grade.maxScore}` : r.submission.status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-16 flex flex-wrap gap-4">
          <LinkButton href="/grades">Your gradebook</LinkButton>
          <Link href="/programme" className="t-body-sm self-center text-ink-700 underline underline-offset-2">
            Back to the programme
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
