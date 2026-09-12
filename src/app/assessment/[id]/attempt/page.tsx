import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, questions, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { submitAttempt } from '@/modules/learning/actions';
import { ActionForm } from '@/components/form';
import { Banner, Input, Textarea } from '@/components/ui';

/**
 * ST-05 assessment in progress.
 *
 * `correctAnswer` is selected out of the query rather than filtered in the
 * component. A Server Component that fetches the answer and merely declines to
 * render it still serialises it into the RSC payload, where anyone can read it
 * — so the answer never leaves the database on this path.
 */
export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [assessment] = await withTenant(institution.id, (tx) =>
    tx.select().from(assessments).where(eq(assessments.id, id)).limit(1),
  );
  if (!assessment) notFound();

  const [attempt] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.assessmentId, id),
          eq(submissions.userId, me.userId),
          eq(submissions.status, 'in_progress'),
        ),
      )
      .orderBy(desc(submissions.attempt))
      .limit(1),
  );
  if (!attempt) redirect(`/assessment/${id}`);

  const qs = await withTenant(institution.id, (tx) =>
    tx
      .select({
        id: questions.id,
        kind: questions.kind,
        prompt: questions.prompt,
        options: questions.options,
        marks: questions.marks,
        position: questions.position,
      })
      .from(questions)
      .where(eq(questions.assessmentId, id))
      .orderBy(questions.position),
  );

  const deadline = assessment.timeLimitMinutes
    ? new Date(attempt.startedAt.getTime() + assessment.timeLimitMinutes * 60_000)
    : null;

  return (
    <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
      <h1 className="t-h1 m-0 text-ink-900">{assessment.title}</h1>
      <p className="t-caption mt-2 text-ink-700">
        Attempt {attempt.attempt} of {assessment.attemptLimit}
        {deadline
          ? ` · submit by ${deadline.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`
          : ''}
      </p>

      {deadline ? (
        <div className="mt-6">
          <Banner tone="info" title="The clock is on our server">
            <p>
              Reloading this page does not reset it. There is a minute of grace on submission, so a
              slow connection will not cost you the attempt.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="mt-10">
        <ActionForm action={submitAttempt} submitLabel="Submit my answers">
          <input type="hidden" name="assessmentId" value={id} />

          <ol className="m-0 list-none space-y-10 p-0">
            {qs.map((q, i) => (
              <li key={q.id}>
                <fieldset className="m-0 border-0 p-0">
                  <legend className="t-h4 mb-4 p-0 text-ink-900">
                    {i + 1}. {q.prompt}
                    <span className="t-caption block font-normal text-ink-700">
                      {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                    </span>
                  </legend>

                  {q.kind === 'mcq' ? (
                    <div className="space-y-3">
                      {q.options.map((o) => (
                        <label key={o.key} className="t-body flex items-start gap-3 text-ink-900">
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            value={o.key}
                            className="mt-1 h-5 w-5 accent-[#6B2436]"
                          />
                          <span>{o.text}</span>
                        </label>
                      ))}
                    </div>
                  ) : q.kind === 'true_false' ? (
                    <div className="space-y-3">
                      {[
                        ['true', 'True'],
                        ['false', 'False'],
                      ].map(([value, label]) => (
                        <label key={value} className="t-body flex items-center gap-3 text-ink-900">
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            value={value}
                            className="h-5 w-5 accent-[#6B2436]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <Textarea
                        id={`q-${q.id}`}
                        name={`q-${q.id}`}
                        rows={5}
                        aria-label={`Answer to question ${i + 1}`}
                      />
                      <p className="t-body-sm mt-1.5 text-ink-500">
                        Marked by your facilitator, not automatically.
                      </p>
                    </>
                  )}
                </fieldset>
              </li>
            ))}
          </ol>

          {qs.length === 0 ? (
            <Input type="hidden" name="empty" value="1" readOnly aria-hidden="true" />
          ) : null}
        </ActionForm>
      </div>
    </main>
  );
}
