import Link from 'next/link';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { assessments, lessons, memberships, modules, programmes, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { DEFAULT_BANDS, sortBands } from '@/lib/grading';
import { Banner, EmptyState, Panel, Record, cx } from '@/components/ui';
import {
  AddModuleForm,
  GradingSchemeForm,
  ModuleRow,
  ProgrammeForm,
} from '@/components/programme-panels';

/**
 * IA-02 programme & module setup — `{school}./admin/programme` (LRN-01).
 *
 * The last dangling link on IA-01's checklist, and the instruction SA-01
 * leaves an institution with: configure your own programme. Until now nothing
 * in the application could create a module — the seed made them, and a real
 * university had no way to.
 *
 * Publishing is absent on purpose and said so on the page. A module goes live
 * when the person teaching it says there is something in it (FC-02), not when
 * an administrator ticks a box on a structure screen.
 */
export default async function Programme({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    added?: string;
    updated?: string;
    removed?: string;
    reordered?: string;
  }>;
}) {
  const institution = await requireInstitution();
  await requireRole('institution_admin');
  const { saved, added, updated, removed } = await searchParams;

  const [programme] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(programmes)
      .where(eq(programmes.institutionId, institution.id))
      .limit(1),
  );

  const rows = programme
    ? await withTenant(institution.id, (tx) =>
        tx
          .select({
            id: modules.id,
            code: modules.code,
            title: modules.title,
            summary: modules.summary,
            semester: modules.semester,
            position: modules.position,
            published: modules.published,
            facilitatorId: modules.facilitatorId,
            lessons: sql<number>`(SELECT count(*) FROM ${lessons} WHERE ${lessons.moduleId} = ${modules.id})::int`,
            assessments: sql<number>`(SELECT count(*) FROM ${assessments} WHERE ${assessments.moduleId} = ${modules.id})::int`,
          })
          .from(modules)
          .where(eq(modules.programmeId, programme.id))
          .orderBy(asc(modules.semester), asc(modules.position), asc(modules.code)),
      )
    : [];

  /*
   * Who can be given a module. `memberships` is shared, so this is a plain
   * read scoped by institution — and it is scoped to facilitators, because
   * assigning a module to a registrar would give them a teaching console they
   * were never meant to have.
   */
  const facilitators = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institution.id),
        inArray(memberships.role, ['facilitator', 'institution_admin']),
      ),
    )
    .orderBy(asc(users.fullName));

  const semesters = [...new Set(rows.map((m) => m.semester))].sort((a, b) => a - b);
  const bands = sortBands(
    programme?.gradingBands?.length ? programme.gradingBands : DEFAULT_BANDS,
  );
  const unassigned = rows.filter((m) => !m.facilitatorId);
  const empty = rows.filter((m) => m.lessons === 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">The programme</h1>
        <p className="t-caption m-0 text-ink-700">
          {rows.length} {rows.length === 1 ? 'module' : 'modules'} across{' '}
          {semesters.length || 0} {semesters.length === 1 ? 'semester' : 'semesters'}
        </p>
      </div>

      {saved === 'programme' ? (
        <div className="mb-8">
          <Banner tone="verified" title="Saved">
            <p>
              Your programme page and the public listing now show this. Candidates read it before
              paying an application fee.
            </p>
          </Banner>
        </div>
      ) : null}

      {saved === 'grading' ? (
        <div className="mb-8">
          <Banner tone="verified" title="Grading scheme saved">
            <p>
              Results are read through these bands wherever a percentage is shown. It changes how a
              score is described, never what the score was, and it awards nothing on its own.
            </p>
          </Banner>
        </div>
      ) : null}

      {added ? (
        <div className="mb-8">
          <Banner tone="verified" title={`${added} added`}>
            <p>
              It is not visible to students yet. Its facilitator publishes it once there is a
              lesson in it.
            </p>
          </Banner>
        </div>
      ) : null}

      {updated ? (
        <div className="mb-8">
          <Banner tone="verified" title={`${updated} updated`}>
            <p>The change is live for anyone already working in that module.</p>
          </Banner>
        </div>
      ) : null}

      {removed ? (
        <div className="mb-8">
          <Banner tone="info" title={`${removed} removed`}>
            <p>It had nothing in it, so nothing was lost with it.</p>
          </Banner>
        </div>
      ) : null}

      {!programme ? (
        <Banner tone="danger" title="This institution has no programme record">
          <p>
            That should not be possible — provisioning creates one. Nothing on this page will work
            until it exists.
          </p>
        </Banner>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
          <div>
            <h2 className="t-h2 mt-0 mb-4 text-ink-900">Structure</h2>

            {rows.length === 0 ? (
              <EmptyState heading="No modules yet">
                LRN-01 is Programme → Semester → Module. Add the first semester&apos;s modules and
                assign somebody to teach each one.
              </EmptyState>
            ) : (
              semesters.map((semester) => {
                const inSemester = rows.filter((m) => m.semester === semester);
                return (
                  <section key={semester} className="mb-10">
                    <h3 className="t-h3 mt-0 mb-1 text-ink-900">Semester {semester}</h3>
                    <p className="t-caption mt-0 mb-4 text-ink-700">
                      {inSemester.length} {inSemester.length === 1 ? 'module' : 'modules'} ·{' '}
                      {inSemester.filter((m) => m.published).length} published
                    </p>
                    <ul className="m-0 grid list-none gap-6 p-0">
                      {inSemester.map((module, i) => (
                        <Record
                          as="li"
                          key={module.id}
                          title={`${module.code} — ${module.title}`}
                          meta={
                            module.published
                              ? 'Published'
                              : module.lessons > 0
                                ? 'Ready to publish'
                                : 'Empty'
                          }
                        >
                          <ModuleRow
                            module={{
                              id: module.id,
                              code: module.code,
                              title: module.title,
                              summary: module.summary,
                              semester: module.semester,
                              published: module.published,
                              facilitatorId: module.facilitatorId,
                              lessons: module.lessons,
                              assessments: module.assessments,
                            }}
                            facilitators={facilitators}
                            first={i === 0}
                            last={i === inSemester.length - 1}
                          />
                        </Record>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}

            <div className="mt-10">
              <Panel title="Add a module">
                <AddModuleForm facilitators={facilitators} semesters={semesters} />
              </Panel>
            </div>
          </div>

          <aside className="space-y-6">
            <Panel title="What candidates read">
              <ProgrammeForm
                programme={{
                  title: programme.title,
                  summary: programme.summary,
                  entryRequirements: programme.entryRequirements,
                  durationMonths: programme.durationMonths,
                }}
              />
            </Panel>

            <Panel title="Grading scheme">
              <p className="t-body-sm mt-0 mb-4 text-ink-700">
                How a percentage is described. The pass mark for a piece of work is set on the
                assessment itself, and graduation stays a decision your registry makes — these
                bands interpret a result, they do not award one.
              </p>
              <GradingSchemeForm bands={bands} />
            </Panel>

            <Panel title="Who publishes">
              {/* Stated where an administrator would go looking for the
                  missing button, rather than left as an absence. */}
              <p className="t-body-sm mt-0 mb-3 text-ink-700">
                Modules are published from the teaching console by the person assigned to them,
                once there is a lesson inside. An administrator publishing an empty module would
                put it on every student&apos;s list with nothing behind it.
              </p>
              {empty.length > 0 ? (
                <p className="t-body-sm m-0 text-ink-700">
                  {empty.length} {empty.length === 1 ? 'module has' : 'modules have'} no lessons
                  yet: {empty.map((m) => m.code).join(', ')}.
                </p>
              ) : null}
            </Panel>

            {unassigned.length > 0 ? (
              <Panel title="Nobody is teaching these">
                <p className="t-body-sm mt-0 mb-0 text-ink-700">
                  {unassigned.map((m) => m.code).join(', ')}{' '}
                  {unassigned.length === 1 ? 'has' : 'have'} no facilitator, so nobody can add
                  lessons or mark work in {unassigned.length === 1 ? 'it' : 'them'}.{' '}
                  <Link href="/admin/staff" className="text-ink-900 underline underline-offset-2">
                    Appoint a facilitator
                  </Link>{' '}
                  if the person you need is not on the list.
                </p>
              </Panel>
            ) : null}
          </aside>
        </div>
      )}

      <p className={cx('t-body-sm mt-10')}>
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
