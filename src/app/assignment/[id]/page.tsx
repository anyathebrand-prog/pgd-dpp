import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, assignmentFiles, grades, modules, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { signedUrl } from '@/lib/storage';
import { ActionForm } from '@/components/form';
import { TopBar, Footer, BottomTabs } from '@/components/shell';
import { Banner, Field, Input, LinkButton, Panel, Record } from '@/components/ui';
import { myPlan } from '@/modules/payments/plan';
import { ASSIGNMENT_FORMATS, assignmentState, canChange } from '@/modules/learning/assignment';
import { saveAssignmentDraft, submitAssignment } from '@/modules/learning/assignment-actions';

/**
 * ST-07 · Assignment submission — `{school}./assignment/{id}` (LRN-04).
 *
 * Brief, deadline, accepted formats and submission history, in that order,
 * because a student needs to know what is being asked and by when before the
 * upload control means anything.
 *
 * States: not started · draft · submitted · late (flagged) · returned for
 * revision · graded.
 */

const STATE_LABEL = {
  not_started: 'Not started',
  draft: 'Draft, not yet submitted',
  submitted: 'Submitted',
  late: 'Submitted late',
  returned: 'Returned for revision',
  graded: 'Graded',
} as const;

const dateTime = (d: Date) =>
  d.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; submitted?: string }>;
}) {
  const { id } = await params;
  const { saved, submitted } = await searchParams;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [found] = await withTenant(institution.id, (tx) =>
    tx
      .select({ assessment: assessments, moduleTitle: modules.title, moduleCode: modules.code, modulePublished: modules.published })
      .from(assessments)
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(and(eq(assessments.id, id), eq(assessments.kind, 'assignment')))
      .limit(1),
  );
  if (!found || !found.assessment.published || !found.modulePublished) notFound();
  const { assessment } = found;

  // PAY-09: the same pause as lessons, and it says the same thing.
  const plan = await myPlan(institution.id, me.userId);
  if (plan.gated && plan.next) {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
          <h1 className="t-h1 m-0 text-ink-900">Coursework is paused</h1>
          <p className="t-body mt-4 text-ink-700">
            Part {plan.next.installmentNumber} of your tuition is overdue. Coursework resumes the
            moment it settles. Anything you have already attached or submitted is kept.
          </p>
          <div className="mt-8">
            <LinkButton href="/pay/plan">Pay part {plan.next.installmentNumber}</LinkButton>
          </div>
        </main>
        <BottomTabs />
        <Footer />
      </>
    );
  }

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.assessmentId, id), eq(submissions.userId, me.userId)))
      .orderBy(desc(submissions.attempt))
      .limit(1),
  );
  const state = assignmentState(row ?? null);

  const history = row
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(assignmentFiles)
          .where(eq(assignmentFiles.submissionId, row.id))
          .orderBy(desc(assignmentFiles.createdAt)),
      )
    : [];
  const current = history.find((f) => f.objectKey === row?.fileObjectKey) ?? null;

  const [grade] = row
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(grades)
          .where(inArray(grades.submissionId, [row.id]))
          .orderBy(desc(grades.gradedAt))
          .limit(1),
      )
    : [];

  const closed = assessment.closesAt ? assessment.closesAt < new Date() : false;
  const formats = ASSIGNMENT_FORMATS.map((f) => f.label).join(' or ');

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
        <p className="t-caption m-0 text-ink-700">
          {found.moduleCode} · {found.moduleTitle}
        </p>
        <h1 className="t-h1 mt-2 mb-0 text-ink-900">{assessment.title}</h1>

        {submitted ? (
          <div className="mt-6">
            <Banner tone="verified" title="Submitted">
              <p>
                Your facilitator has it. You will see the mark and their feedback here once it is
                graded.
                {state === 'late' ? ' It arrived after the deadline and is marked as late.' : ''}
              </p>
            </Banner>
          </div>
        ) : saved ? (
          <div className="mt-6">
            <Banner tone="info" title="File attached, not yet submitted">
              <p>Check it is the right file, then submit it below. Until then your facilitator cannot see it.</p>
            </Banner>
          </div>
        ) : null}

        {state === 'returned' && row?.returnedNote ? (
          <div className="mt-6">
            <Banner tone="warning" title="Returned for revision">
              <p className="whitespace-pre-line">{row.returnedNote}</p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-8">
          <Record
            title="The brief"
            meta={
              assessment.closesAt
                ? `Due ${dateTime(assessment.closesAt)}`
                : 'No deadline set'
            }
          >
            {assessment.instructions ? (
              <p className="t-body measure m-0 whitespace-pre-line text-ink-900">{assessment.instructions}</p>
            ) : (
              <p className="t-body-sm m-0 text-ink-700">Your facilitator has not added written instructions.</p>
            )}
            <dl className="mt-6 mb-0 grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="t-caption m-0 text-ink-700">Accepted</dt>
                <dd className="t-body-sm m-0 ml-0 text-ink-900">{formats}, up to 5MB</dd>
              </div>
              <div>
                <dt className="t-caption m-0 text-ink-700">Status</dt>
                <dd className="t-body-sm m-0 ml-0 font-semibold text-ink-900">{STATE_LABEL[state]}</dd>
              </div>
            </dl>
          </Record>
        </div>

        {state === 'graded' && grade ? (
          <div className="mt-8">
            <Panel title="Your mark">
              <p className="t-h2 m-0 text-ink-900">
                {grade.score} of {grade.maxScore}
              </p>
              {grade.feedback ? (
                <p className="t-body measure mt-4 mb-0 whitespace-pre-line text-ink-900">{grade.feedback}</p>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {canChange(state) ? (
          <section aria-labelledby="attach" className="mt-10">
            <h2 id="attach" className="t-h2 m-0 mb-4 text-ink-900">
              {current ? 'Replace the file' : 'Attach your work'}
            </h2>
            {closed ? (
              <p className="t-body-sm mt-0 mb-4 text-warning">
                The deadline has passed. You can still submit, and it will be marked as late.
              </p>
            ) : null}
            <ActionForm action={saveAssignmentDraft} submitLabel={current ? 'Attach this file instead' : 'Attach file'}>
              <input type="hidden" name="assessmentId" value={id} />
              <Field
                label="Your file"
                name="file"
                inputId="file"
                required
                helper={`${formats}, up to 5MB. Attaching does not submit it.`}
              >
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept={ASSIGNMENT_FORMATS.map((f) => `.${f.ext},${f.type}`).join(',')}
                  required
                />
              </Field>
            </ActionForm>

            {current ? (
              <div className="mt-10">
                <Record title="Ready to submit" meta={current.filename}>
                  <p className="t-body-sm mt-0 mb-4 text-ink-700">
                    <a
                      href={signedUrl(current.objectKey)}
                      className="text-ink-900 underline underline-offset-2"
                    >
                      Open what you attached
                    </a>{' '}
                    to check it before sending. Once submitted it cannot be changed unless your
                    facilitator returns it.
                  </p>
                  <ActionForm action={submitAssignment} submitLabel={state === 'returned' ? 'Resubmit to my facilitator' : 'Submit to my facilitator'}>
                    <input type="hidden" name="assessmentId" value={id} />
                  </ActionForm>
                </Record>
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="history" className="mt-12">
          <h2 id="history" className="t-h2 m-0 mb-4 text-ink-900">
            Submission history
          </h2>
          {history.length === 0 ? (
            <p className="t-body-sm m-0 text-ink-700">Nothing attached yet.</p>
          ) : (
            <ol className="m-0 list-none space-y-3 p-0">
              {history.map((f) => (
                <li key={f.id} className="t-body-sm border-b border-ink-700/20 pb-3">
                  <span className="text-ink-900">{f.filename}</span>
                  <span className="t-caption block text-ink-700">
                    Attached {dateTime(f.createdAt)}
                    {f.submittedAt ? ` · submitted ${dateTime(f.submittedAt)}` : ' · not submitted'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="t-body-sm mt-12">
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
