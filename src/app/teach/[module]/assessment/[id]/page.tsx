import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, modules, questions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, EmptyState, Panel, Record } from '@/components/ui';
import {
  AddQuestion,
  AssessmentForm,
  AssessmentPublish,
  QuestionEditor,
} from '@/components/assessment-panels';
import { assessmentBlockers, attemptCount } from '@/modules/teaching/assessment-queries';

/**
 * FC-02, building a quiz (LRN-04).
 *
 * A separate screen from the module because a paper is a thing in itself: it
 * has its own settings, its own publish state, and its own point of no return.
 *
 * That point is the whole design. The moment a student answers, the questions
 * freeze — a submission stores answers keyed by question id and a grade is a
 * mark out of a total derived from these marks, so editing afterwards
 * rewrites what every existing grade meant, silently. The screen says so
 * plainly rather than hiding the controls, because a facilitator who cannot
 * see why will assume the product is broken and ask someone to fix it.
 */
export default async function AssessmentAuthoring({
  params,
}: {
  params: Promise<{ module: string; id: string }>;
}) {
  const { module: moduleId, id } = await params;
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select({ assessment: assessments, module: modules })
      .from(assessments)
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(eq(assessments.id, id))
      .limit(1),
  );
  if (!row || row.assessment.moduleId !== moduleId) notFound();

  // Holding the facilitator role is not the same as teaching this module.
  if (row.module.facilitatorId !== me.userId && !me.roles.includes('institution_admin')) {
    notFound();
  }

  const items = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, id))
      .orderBy(asc(questions.position)),
  );

  const attempts = await attemptCount(institution.id, id);
  const blockers = await assessmentBlockers(institution.id, id);
  const locked = attempts > 0;
  const totalMarks = items.reduce((sum, q) => sum + q.marks, 0);

  return (
    <>
      <p className="t-body-sm m-0">
        <Link
          href={`/teach/${moduleId}`}
          className="text-ink-700 underline underline-offset-2"
        >
          Back to {row.module.code}
        </Link>
      </p>

      <div className="mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">{row.assessment.title}</h1>
        <p className="t-caption m-0 text-ink-700">
          {items.length} question{items.length === 1 ? '' : 's'} · {totalMarks} mark
          {totalMarks === 1 ? '' : 's'} ·{' '}
          {row.assessment.published ? 'visible to students' : 'draft'}
        </p>
      </div>

      {locked ? (
        <div className="mb-8">
          <Banner tone="warning" title={`${attempts} attempt${attempts === 1 ? '' : 's'} already submitted`}>
            <p>
              The questions are fixed now. Every grade already given is a mark out of them, so a
              change here would quietly alter what those marks were out of. If a question is wrong,
              build a new assessment and unpublish this one — the attempts and grades stay where
              they are.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="t-h2 m-0 mb-4 text-ink-900">Questions</h2>

          {items.length === 0 ? (
            <EmptyState heading="No questions yet">
              A quiz cannot be published without at least one. Multiple choice and true/false are
              marked the moment a student submits; short answers come to your grading queue.
            </EmptyState>
          ) : (
            <ol className="m-0 grid list-none gap-4 p-0">
              {items.map((q, i) => (
                <Record
                  as="li"
                  key={q.id}
                  title={`${i + 1}. ${q.prompt}`}
                  meta={`${LABELS[q.kind]} · ${q.marks} mark${q.marks === 1 ? '' : 's'}`}
                >
                  {q.kind === 'mcq' ? (
                    <ul className="t-body-sm m-0 mb-4 list-none space-y-1 p-0">
                      {q.options.map((o) => (
                        <li
                          key={o.key}
                          className={
                            o.key === q.correctAnswer
                              ? 'font-semibold text-verified-text'
                              : 'text-ink-700'
                          }
                        >
                          {o.key.toUpperCase()}. {o.text}
                          {o.key === q.correctAnswer ? ' — correct' : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {q.kind === 'true_false' ? (
                    <p className="t-body-sm mt-0 mb-4 font-semibold text-verified-text">
                      Correct answer: {q.correctAnswer}
                    </p>
                  ) : null}

                  {q.kind === 'short_answer' ? (
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">
                      Marked by you, in the grading queue.
                    </p>
                  ) : null}

                  <QuestionEditor
                    assessmentId={id}
                    question={{
                      id: q.id,
                      kind: q.kind,
                      prompt: q.prompt,
                      options: q.options,
                      correctAnswer: q.correctAnswer,
                      marks: q.marks,
                    }}
                    locked={locked}
                  />
                </Record>
              ))}
            </ol>
          )}

          <div className="mt-8">
            <AddQuestion assessmentId={id} locked={locked} />
          </div>
        </div>

        <aside className="space-y-6">
          <Panel title="Publish">
            <AssessmentPublish
              assessmentId={id}
              published={row.assessment.published}
              blockers={blockers}
            />
            <p className="t-caption mt-4 mb-0 text-ink-700">
              Extended time for an individual student is granted from the{' '}
              <Link href="/teach/grading" className="text-ink-900 underline underline-offset-2">
                grading queue
              </Link>
              , not here — it is an accommodation for a person, not a property of the paper.
            </p>
          </Panel>

          <Panel title="Settings">
            <AssessmentForm
              moduleId={moduleId}
              assessment={{
                id,
                title: row.assessment.title,
                kind: row.assessment.kind,
                instructions: row.assessment.instructions ?? '',
                timeLimitMinutes: row.assessment.timeLimitMinutes,
                attemptLimit: row.assessment.attemptLimit,
                passMark: row.assessment.passMark,
              }}
              locked={locked}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}

const LABELS: Record<string, string> = {
  mcq: 'Multiple choice',
  true_false: 'True or false',
  short_answer: 'Short answer',
};
