import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, questions, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { startAttempt } from '@/modules/learning/actions';
import { TopBar, Footer } from '@/components/shell';
import { Banner, Button, LinkButton, Record } from '@/components/ui';

/**
 * ST-04 assessment instructions.
 *
 * Everything that constrains the attempt is stated before it starts: the
 * timer, the attempt count, the pass mark and what happens if the connection
 * drops. Discovering a timer after starting is how a student on a bad line
 * loses an attempt they never really had.
 */
export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ blocked?: string }>;
}) {
  const { id } = await params;
  const { blocked } = await searchParams;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [assessment] = await withTenant(institution.id, (tx) =>
    tx.select().from(assessments).where(eq(assessments.id, id)).limit(1),
  );
  if (!assessment || !assessment.published) notFound();
  // ST-07: a file-upload assignment has its own screen, so every existing
  // link to an assessment lands in the right place.
  if (assessment.kind === 'assignment') redirect(`/assignment/${id}`);

  const qs = await withTenant(institution.id, (tx) =>
    tx.select({ marks: questions.marks }).from(questions).where(eq(questions.assessmentId, id)),
  );

  const attempts = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.assessmentId, id), eq(submissions.userId, me.userId)))
      .orderBy(desc(submissions.attempt)),
  );

  const inProgress = attempts.find((a) => a.status === 'in_progress');
  const used = attempts.length;
  const exhausted = used >= assessment.attemptLimit && !inProgress;
  const closed = assessment.closesAt ? assessment.closesAt < new Date() : false;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">{assessment.title}</h1>

        {blocked ? (
          <div className="mt-6">
            <Banner tone="warning" title="You cannot start this">
              <p>
                {blocked === 'exhausted'
                  ? 'You have used every attempt on this assessment.'
                  : blocked === 'closed'
                    ? 'This assessment has closed.'
                    : 'This assessment is not available.'}
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-8">
          <Record title="Before you start" meta={`${qs.length} questions · ${qs.reduce((s, q) => s + q.marks, 0)} marks`}>
            <ul className="t-body-sm m-0 list-disc space-y-2 pl-5 text-ink-900">
              <li>
                {assessment.timeLimitMinutes
                  ? `You have ${assessment.timeLimitMinutes} minutes from the moment you start. The clock runs on our server, so closing the tab does not stop it.`
                  : 'There is no time limit.'}
              </li>
              <li>
                {assessment.attemptLimit === 1
                  ? 'One attempt only.'
                  : `${assessment.attemptLimit} attempts. You have used ${used}.`}
              </li>
              <li>The pass mark is {assessment.passMark}%.</li>
              <li>
                Your answers are sent when you submit. If your connection drops mid-attempt, reopen
                this page — an attempt in progress can be resumed.
              </li>
            </ul>
          </Record>
        </div>

        {assessment.instructions ? (
          <p className="t-body measure mt-8 whitespace-pre-line text-ink-900">
            {assessment.instructions}
          </p>
        ) : null}

        <div className="mt-16 flex flex-wrap items-center gap-4">
          {closed || exhausted ? (
            <>
              <Button disabled>Start the assessment</Button>
              <p className="t-body-sm m-0 text-ink-700">
                {closed ? 'This assessment closed on ' : 'No attempts remain. '}
                {closed ? assessment.closesAt?.toLocaleDateString('en-NG') : ''}
              </p>
            </>
          ) : (
            <form action={startAttempt}>
              <input type="hidden" name="assessmentId" value={id} />
              <Button type="submit">{inProgress ? 'Resume your attempt' : 'Start the assessment'}</Button>
            </form>
          )}
          {attempts.some((a) => a.status === 'graded') ? (
            <LinkButton href={`/assessment/${id}/result`} variant="secondary">
              See your result
            </LinkButton>
          ) : null}
        </div>

        <p className="t-body-sm mt-8">
          <Link href="/programme" className="text-ink-700 underline underline-offset-2">
            Back to the programme
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
