import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import {
  assessmentAccommodations,
  assessments,
  assignmentFiles,
  modules,
  questions,
  submissions,
  users,
} from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { signedUrl } from '@/lib/storage';
import { ExtraTimePanel, GradePanel } from '@/components/teach-panels';
import { Banner, DataString, EmptyState, Panel, Record, cx } from '@/components/ui';

/**
 * FC-03 grading queue (LRN-05).
 *
 * Oldest first, as the flow specifies — a queue ordered by arrival is the
 * only one that does not quietly punish whoever submitted first.
 *
 * Only short-answer and assignment work reaches here. MCQ and true/false are
 * marked on submission, so a queue full of things the machine could have
 * done would waste the one resource this screen is spending: a facilitator's
 * attention.
 */
export default async function GradingQueue() {
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const mine = await withTenant(institution.id, (tx) =>
    tx.select({ id: modules.id }).from(modules).where(eq(modules.facilitatorId, me.userId)),
  );
  const moduleIds = mine.map((m) => m.id);

  const queue = moduleIds.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select({
            submission: submissions,
            assessment: assessments,
            moduleCode: modules.code,
            moduleTitle: modules.title,
          })
          .from(submissions)
          .innerJoin(assessments, eq(assessments.id, submissions.assessmentId))
          .innerJoin(modules, eq(modules.id, assessments.moduleId))
          .where(
            and(
              inArray(assessments.moduleId, moduleIds),
              inArray(submissions.status, ['submitted', 'returned']),
            ),
          )
          .orderBy(asc(submissions.submittedAt)),
      )
    : [];

  // `users` is shared, so this needs no tenant context.
  const studentIds = [...new Set(queue.map((q) => q.submission.userId))];
  const students = studentIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, studentIds))
    : [];
  const nameOf = (id: string) =>
    students.find((s) => s.id === id)?.fullName ?? students.find((s) => s.id === id)?.email ?? 'Student';

  const assessmentIds = [...new Set(queue.map((q) => q.assessment.id))];
  const allQuestions = assessmentIds.length
    ? await withTenant(institution.id, (tx) =>
        tx.select().from(questions).where(inArray(questions.assessmentId, assessmentIds)),
      )
    : [];

  const accommodations = assessmentIds.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(assessmentAccommodations)
          .where(inArray(assessmentAccommodations.assessmentId, assessmentIds)),
      )
    : [];

  // ST-07: the file each assignment submission points at, for its name.
  const fileKeys = queue.map((q) => q.submission.fileObjectKey).filter((k): k is string => !!k);
  const files = fileKeys.length
    ? await withTenant(institution.id, (tx) =>
        tx.select().from(assignmentFiles).where(inArray(assignmentFiles.objectKey, fileKeys)),
      )
    : [];

  // CMP-14: opening a queue of named students' work is staff access to
  // student records, and is logged as such.
  if (queue.length > 0) {
    await audit({
      action: 'grading.queue_viewed',
      institutionId: institution.id,
      actorId: me.userId,
      actorRole: 'facilitator',
      entity: 'submissions',
      detail: { count: queue.length },
    });
  }

  const awaiting = queue.filter((q) => q.submission.status === 'submitted');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Grading</h1>
        <p className="t-caption m-0 text-ink-700">Oldest submission first</p>
      </div>

      {/*
        The empty state keys off the whole queue, not off what is unmarked.
        Work you returned is still yours to follow up, and a screen that says
        "nothing is waiting" while hiding it loses track of the student who is
        now waiting on you twice.
      */}
      {queue.length === 0 ? (
        <EmptyState heading="Nothing is waiting">
          Multiple choice and true/false are marked automatically. Short answers and assignments
          arrive here, oldest first.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6">
            <Banner tone={awaiting.length > 0 ? 'info' : 'verified'} title={
              awaiting.length > 0
                ? `${awaiting.length} waiting`
                : 'Everything is marked'
            }>
              <p>
                {awaiting.length > 0
                  ? 'A student cannot see their result until you have marked it. If a submission needs more than a mark, return it for revision with what has to change.'
                  : 'Nothing is unmarked. The submissions below were returned for revision and are still open until the student resubmits.'}
              </p>
            </Banner>
          </div>

          <ul className="grid list-none gap-6 p-0">
            {queue.map(({ submission, assessment, moduleCode, moduleTitle }) => {
              const qs = allQuestions
                .filter((q) => q.assessmentId === assessment.id)
                .sort((a, b) => a.position - b.position);
              const isAssignment = assessment.kind === 'assignment';
              // An assignment has no questions to sum; it is marked out of 100.
              const maxScore = isAssignment ? 100 : qs.reduce((sum, q) => sum + q.marks, 0);
              const file = files.find((f) => f.objectKey === submission.fileObjectKey) ?? null;
              const answers = submission.answers as Record<string, string>;
              const waitingDays = submission.submittedAt
                ? Math.floor((Date.now() - submission.submittedAt.getTime()) / 86_400_000)
                : 0;
              const accommodation =
                accommodations.find(
                  (a) => a.assessmentId === assessment.id && a.userId === submission.userId,
                ) ?? null;

              return (
                <li key={submission.id}>
                  <Record
                    title={`${nameOf(submission.userId)} — ${assessment.title}`}
                    meta={`${moduleCode} ${moduleTitle} · attempt ${submission.attempt} · submitted ${
                      submission.submittedAt?.toLocaleDateString('en-NG') ?? '—'
                    }${submission.late ? ' · late' : ''}${waitingDays >= 7 ? ` · waiting ${waitingDays} days` : ''}`}
                    className={cx(waitingDays >= 7 && 'border-l-[3px] border-l-warning')}
                  >
                    {submission.status === 'returned' ? (
                      <p className="t-body-sm mt-0 mb-4 text-warning">
                        Returned for revision: {submission.returnedNote}
                      </p>
                    ) : null}

                    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
                      {isAssignment ? (
                        <div>
                          {submission.late ? (
                            <p className="t-body-sm mt-0 mb-3 font-semibold text-warning">
                              <span aria-hidden="true">▲ </span>
                              Submitted after the deadline.
                            </p>
                          ) : null}
                          {file ? (
                            <p className="t-body-sm m-0">
                              <a
                                href={signedUrl(file.objectKey)}
                                className="text-ink-900 underline underline-offset-2"
                              >
                                Download {file.filename}
                              </a>
                              <span className="t-caption block text-ink-700">
                                {(file.sizeBytes / 1024).toFixed(0)}KB. The link lasts five minutes.
                              </span>
                            </p>
                          ) : (
                            <p className="t-body-sm m-0 text-ink-700">No file is attached.</p>
                          )}
                        </div>
                      ) : (
                      <div>
                        <p className="t-caption m-0 mb-3 text-ink-700">
                          Auto-marked so far: {submission.autoScore ?? 0} of{' '}
                          {qs.filter((q) => q.kind !== 'short_answer').reduce((s, q) => s + q.marks, 0)}
                        </p>

                        <ol className="m-0 list-none space-y-4 p-0">
                          {qs.map((q, i) => {
                            const given = answers[q.id] ?? '';
                            const auto = q.kind !== 'short_answer';
                            const right = auto && given === q.correctAnswer;
                            return (
                              <li key={q.id}>
                                <p className="t-body-sm m-0 font-semibold text-ink-900">
                                  {i + 1}. {q.prompt}
                                </p>
                                <p
                                  className={cx(
                                    't-body-sm mt-1 mb-0 whitespace-pre-line',
                                    auto ? (right ? 'text-verified-text' : 'text-ink-700') : 'text-ink-900',
                                  )}
                                >
                                  {given || '(no answer)'}
                                  {auto ? (right ? ' — correct' : ` — expected ${q.correctAnswer}`) : ''}
                                </p>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                      )}

                      <div className="space-y-5">
                        <Panel title="Mark it">
                          <GradePanel
                            submissionId={submission.id}
                            maxScore={maxScore}
                            studentName={nameOf(submission.userId)}
                          />
                        </Panel>

                        {assessment.timeLimitMinutes ? (
                          <Panel title="Extra time">
                            <ExtraTimePanel
                              assessmentId={assessment.id}
                              userId={submission.userId}
                              studentName={nameOf(submission.userId)}
                              existing={
                                accommodation
                                  ? {
                                      extraMinutes: accommodation.extraMinutes,
                                      reason: accommodation.reason,
                                    }
                                  : null
                              }
                            />
                          </Panel>
                        ) : null}
                      </div>
                    </div>

                    <p className="t-caption mt-5 mb-0 text-ink-700">
                      Submission <DataString value={submission.id.slice(0, 8)} label="Submission" />
                      {' · '}opening this is recorded against your account.
                    </p>
                  </Record>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="t-body-sm mt-10">
        <Link href="/teach" className="text-ink-700 underline underline-offset-2">
          Back to my modules
        </Link>
      </p>
    </>
  );
}
