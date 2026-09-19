import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, lessons, modules, questions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { publishBlockers } from '@/modules/teaching/actions';
import { LessonEditor, ModulePublish } from '@/components/teach-panels';
import { LessonVideo } from '@/components/lesson-video';
import { AssessmentForm } from '@/components/assessment-panels';
import { Banner, EmptyState, Panel, Record, cx } from '@/components/ui';

/**
 * FC-02 content authoring (LRN-01, LRN-02).
 *
 * States the flow names: draft, published, and publish blocked by missing
 * required fields. The block is stated rather than implied — a disabled
 * button with no explanation fails WCAG 3.3.1 and, more practically, leaves
 * a facilitator clicking at something that will not respond.
 *
 * Video transcode ("processing") is not represented: §7.2 puts video on
 * Cloudflare Stream and that integration is not built, so pretending to show
 * a transcode state would be pretending to have one.
 */
export default async function ModuleAuthoring({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: moduleId } = await params;
  const institution = await requireInstitution();
  const me = await requireRole('facilitator', 'institution_admin');

  const [module] = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!module) notFound();

  // Holding the facilitator role is not the same as teaching this module.
  if (module.facilitatorId !== me.userId && !me.roles.includes('institution_admin')) {
    notFound();
  }

  const content = await withTenant(institution.id, (tx) =>
    tx.select().from(lessons).where(eq(lessons.moduleId, moduleId)).orderBy(asc(lessons.position)),
  );

  const tests = await withTenant(institution.id, (tx) =>
    tx.select().from(assessments).where(eq(assessments.moduleId, moduleId)),
  );

  const questionCounts = await withTenant(institution.id, (tx) =>
    tx.select({ assessmentId: questions.assessmentId, id: questions.id }).from(questions),
  );

  const blockers = await publishBlockers(institution.id, moduleId);

  return (
    <>
      <p className="t-body-sm m-0">
        <Link href="/teach" className="text-ink-700 underline underline-offset-2">
          Back to my modules
        </Link>
      </p>

      <div className="mt-4 mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="t-h1 m-0 text-ink-900">
            {module.code} · {module.title}
          </h1>
          <p className="t-caption mt-2 mb-0 text-ink-700">
            Semester {module.semester} · {module.published ? 'published' : 'draft'}
          </p>
        </div>
        <ModulePublish moduleId={moduleId} published={module.published} blockers={blockers} />
      </div>

      {!module.published && blockers.length > 0 ? (
        <div className="mb-6">
          <Banner tone="warning" title="Not ready to publish">
            <ul className="m-0 list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : null}

      {module.published ? (
        <div className="mb-6">
          <Banner tone="info" title="Students can see this now">
            <p>
              Edits go live immediately. Unpublish first if you are restructuring rather than
              correcting — a student halfway through a lesson that disappears has lost their place.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_460px]">
        <div>
          <h2 className="t-h2 m-0 mb-4 text-ink-900">Lessons</h2>
          {content.length === 0 ? (
            <EmptyState heading="No lessons yet">
              Add the first one. Students walk through them in the order set here.
            </EmptyState>
          ) : (
            <ol className="m-0 grid list-none gap-4 p-0">
              {content.map((l, i) => (
                <Record
                  as="li"
                  key={l.id}
                  title={`${i + 1}. ${l.title}`}
                  meta={`${l.body?.length ?? 0} characters${l.downloadable ? ' · downloadable' : ''}`}
                >
                  <p className={cx('t-body-sm mt-0 mb-4', l.body ? 'text-ink-700' : 'text-warning')}>
                    {l.body ? `${l.body.slice(0, 160)}${l.body.length > 160 ? '…' : ''}` : 'Empty — this blocks publishing.'}
                  </p>
                  <LessonEditor
                    moduleId={moduleId}
                    lesson={{
                      id: l.id,
                      title: l.title,
                      body: l.body ?? '',
                      downloadable: l.downloadable,
                    }}
                    canMoveUp={i > 0}
                    canMoveDown={i < content.length - 1}
                  />
                  {/* LRN-02. Optional by design: the written lesson is what
                      students are assessed on, and §8 budgets three seconds to
                      interactive on 3G. */}
                  <LessonVideo
                    lessonId={l.id}
                    hasVideo={Boolean(l.videoUid)}
                    durationSeconds={l.videoDurationSeconds}
                  />
                </Record>
              ))}
            </ol>
          )}

          {tests.length > 0 ? (
            <>
              <h2 className="t-h2 mt-12 mb-4 text-ink-900">Assessments</h2>
              <ul className="m-0 grid list-none gap-4 p-0">
                {tests.map((a) => (
                  <Record
                    as="li"
                    key={a.id}
                    title={a.title}
                    meta={`${questionCounts.filter((q) => q.assessmentId === a.id).length} questions · ${
                      a.timeLimitMinutes ? `${a.timeLimitMinutes} minutes · ` : ''
                    }${a.attemptLimit} attempt${a.attemptLimit === 1 ? '' : 's'} · pass ${a.passMark}%`}
                  >
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">
                      {a.published ? 'Visible to students.' : 'Draft.'} Extended time for individual
                      students is granted from the{' '}
                      <Link href="/teach/grading" className="text-ink-900 underline underline-offset-2">
                        grading queue
                      </Link>
                      .
                    </p>
                    <Link
                      href={`/teach/${moduleId}/assessment/${a.id}`}
                      className="t-body-sm font-semibold text-authority underline underline-offset-2"
                    >
                      Edit the questions
                    </Link>
                  </Record>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <aside>
          <Panel title="Add a lesson">
            <LessonEditor moduleId={moduleId} />
          </Panel>

          <div className="mt-6">
            <Panel title="Add an assessment">
              {/* LRN-04. Until this existed, assessments came only from the
                  seed — so the whole attempt → auto-mark → grade → release
                  path ran on data no facilitator could have made. */}
              <AssessmentForm moduleId={moduleId} locked={false} />
            </Panel>
          </div>
        </aside>
      </div>
    </>
  );
}
