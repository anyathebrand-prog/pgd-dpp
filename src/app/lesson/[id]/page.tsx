import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, lessonProgress, lessons, modules } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { markLessonComplete } from '@/modules/learning/actions';
import { myPlan } from '@/modules/payments/plan';
import { TopBar, Footer, BottomTabs } from '@/components/shell';
import { Button, LinkButton, Panel } from '@/components/ui';

/**
 * ST-03 lesson player.
 *
 * §3.1: this is a reading surface, so the prose is Literata at `read` (19px /
 * 1.75) in the 720px reading container. The visible shift from Plex Sans chrome
 * to a serif body is doing real work — the student is reading someone else's
 * document, and it should not look like the interface around it.
 *
 * The video element is deliberately plain and `preload="none"`: §8 asks for a
 * quality selector and an audio-only option on a 3G budget, and the worst thing
 * this page could do is autoload a megabyte of video for someone who came to
 * read.
 */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select({
        lesson: lessons,
        moduleTitle: modules.title,
        moduleId: modules.id,
        published: modules.published,
      })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(lessons.id, id))
      .limit(1),
  );
  if (!row || !row.published) notFound();

  /*
   * PAY-09's access gate on the second part. Pausing, not removing: the
   * student's progress, submissions and grades are untouched, and the gate
   * lifts the moment the overdue part settles. The page says exactly what is
   * owed and links to paying it, rather than a bare "no access".
   */
  const plan = await myPlan(institution.id, me.userId);
  if (plan.gated && plan.next) {
    return (
      <>
        <TopBar />
        <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
          <h1 className="t-h1 m-0 text-ink-900">Lessons are paused</h1>
          <p className="t-body mt-4 text-ink-700">
            Part {plan.next.installmentNumber} of your tuition was due on{' '}
            {plan.next.dueAt?.toLocaleDateString('en-NG', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}{' '}
            and has not been paid. Lessons resume the moment it settles. Your progress,
            submissions and grades are all kept exactly as they are.
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

  const siblings = await withTenant(institution.id, (tx) =>
    tx
      .select({ id: lessons.id, title: lessons.title, position: lessons.position })
      .from(lessons)
      .where(eq(lessons.moduleId, row.moduleId))
      .orderBy(asc(lessons.position)),
  );
  const index = siblings.findIndex((s) => s.id === id);
  const next = siblings[index + 1];

  const [progress] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.lessonId, id), eq(lessonProgress.userId, me.userId)))
      .limit(1),
  );

  const moduleAssessments = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.moduleId, row.moduleId), eq(assessments.published, true))),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/programme" className="text-ink-700 underline underline-offset-2">
            {row.moduleTitle}
          </Link>
        </p>
        <h1 className="t-read-h mt-3 text-ink-900">{row.lesson.title}</h1>
        <p className="t-caption mt-2 text-ink-700">
          Lesson {index + 1} of {siblings.length}
          {progress?.completedAt ? ' · completed' : ''}
        </p>

        {row.lesson.videoUid ? (
          <div className="mt-8">
            <video
              controls
              preload="none"
              className="w-full bg-ink-900"
              aria-label={`Video for ${row.lesson.title}`}
            >
              <source src={`/api/video/${row.lesson.videoUid}`} />
              Your browser cannot play this video. The written lesson below covers the same material.
            </video>
            <p className="t-caption mt-2 text-ink-700">
              The written lesson below covers the same ground. If your connection is slow, read it
              instead — nothing in the assessment depends on the video.
            </p>
          </div>
        ) : null}

        {/* Literata, 66–78 characters, 1.75 line height. */}
        <article className="t-read measure-read mt-10 whitespace-pre-line text-ink-900">
          {row.lesson.body}
        </article>

        {moduleAssessments.length > 0 ? (
          <div className="mt-12">
            <Panel title="Assessment for this module">
              <ul className="m-0 list-none space-y-2 p-0">
                {moduleAssessments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/assessment/${a.id}`} className="t-body-sm text-ink-900 underline underline-offset-2">
                      {a.title}
                    </Link>
                    <span className="t-caption block text-ink-700">
                      {a.timeLimitMinutes ? `${a.timeLimitMinutes} minutes · ` : ''}
                      {a.attemptLimit} {a.attemptLimit === 1 ? 'attempt' : 'attempts'} · pass mark{' '}
                      {a.passMark}%
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        ) : null}

        <div className="mt-16 flex flex-wrap items-center gap-4">
          <form action={markLessonComplete}>
            <input type="hidden" name="lessonId" value={id} />
            <input type="hidden" name="next" value={next ? `/lesson/${next.id}` : '/programme'} />
            <Button type="submit">
              {progress?.completedAt
                ? next
                  ? 'Next lesson'
                  : 'Back to the programme'
                : next
                  ? 'Mark complete and continue'
                  : 'Mark complete'}
            </Button>
          </form>
          {row.lesson.downloadable ? (
            <LinkButton href={`/lesson/${id}/download`} variant="secondary">
              Download for offline reading
            </LinkButton>
          ) : null}
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
