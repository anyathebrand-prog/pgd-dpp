import { desc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { cohorts, enrollments, institutions, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';
import { TopBar, Footer } from '@/components/shell';
import { Banner, Button, EmptyState, Record } from '@/components/ui';
import { affiliationsOf, roleLabel } from '@/modules/auth/affiliations';

/**
 * AU-10 · Institution chooser — SSO-04.
 *
 * A card per affiliation: institution, role, status, cohort. *Continue* moves
 * the session to that institution's own address; *Set as default* skips this
 * screen next time.
 *
 * Gap G-07 asks how tenant context is shown once inside. The answer here is
 * that it never mixes: each institution is its own host with its own session,
 * so nothing from one can appear while signed in to the other. This screen is
 * the only place both are listed, and it lists only the person's own rows.
 */
export default async function ChooseInstitution({
  searchParams,
}: {
  searchParams: Promise<{ default?: string; failed?: string }>;
}) {
  const me = await requireUser();
  const here = await currentInstitution();
  const { default: defaultSet, failed } = await searchParams;

  const affiliations = affiliationsOf(me.allMemberships);
  const ids = affiliations.map((a) => a.institutionId);

  // `institutions` and `users` are shared tables.
  const insts = ids.length
    ? await db.select().from(institutions).where(inArray(institutions.id, ids))
    : [];
  const [mine] = await db
    .select({ defaultInstitutionId: users.defaultInstitutionId })
    .from(users)
    .where(eq(users.id, me.userId))
    .limit(1);

  // The person's own enrolment at each, read under that institution's tenant
  // context in turn: one withTenant per school, never a cross-tenant read.
  const enrolment = new Map<string, { status: string; cohort: string } | null>();
  for (const id of ids) {
    const [row] = await withTenant(id, (tx) =>
      tx
        .select({ status: enrollments.status, cohort: cohorts.name })
        .from(enrollments)
        .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
        .where(eq(enrollments.userId, me.userId))
        .orderBy(desc(enrollments.createdAt))
        .limit(1),
    );
    enrolment.set(id, row ?? null);
  }

  const cards = affiliations
    .map((a) => ({ ...a, inst: insts.find((i) => i.id === a.institutionId)! }))
    .filter((a) => a.inst)
    .sort((x, y) => x.inst.name.localeCompare(y.inst.name));

  const STATUS: Record<string, string> = {
    active: 'Enrolled',
    deferred: 'Deferred',
    withdrawn: 'Withdrawn',
    completed: 'Completed',
  };

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">Choose an institution</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          Your account is linked to more than one university. Each keeps its own records, and you
          work in one at a time. You can switch from the header whenever you like.
        </p>

        {defaultSet ? (
          <div className="mb-8">
            <Banner tone="verified" title={defaultSet === 'none' ? 'No default' : 'Default saved'}>
              <p>
                {defaultSet === 'none'
                  ? 'You will be asked each time you sign in.'
                  : 'You will go straight there when you sign in. This screen stays in the header.'}
              </p>
            </Banner>
          </div>
        ) : null}
        {failed ? (
          <div className="mb-8">
            <Banner tone="danger" title="That switch did not go through">
              <p>The link lasts a minute and works once. Choose the institution again.</p>
            </Banner>
          </div>
        ) : null}

        {cards.length === 0 ? (
          <EmptyState heading="No university affiliations">
            Your account holds platform roles only, which are not tied to one university.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-6 p-0">
            {cards.map(({ inst, roles, institutionId }) => {
              const e = enrolment.get(institutionId);
              const isHere = here?.id === institutionId;
              const isDefault = mine?.defaultInstitutionId === institutionId;
              return (
                <li key={institutionId}>
                  <Record
                    title={inst.name}
                    meta={[isHere ? 'You are here' : null, isDefault ? 'Default' : null]
                      .filter(Boolean)
                      .join(' · ') || undefined}
                  >
                    <dl className="m-0 mb-6 grid grid-cols-2 gap-x-6 gap-y-3">
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Role</dt>
                        <dd className="t-body-sm m-0 ml-0 text-ink-900">{roleLabel(roles)}</dd>
                      </div>
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Status</dt>
                        <dd className="t-body-sm m-0 ml-0 text-ink-900">
                          {e ? STATUS[e.status] ?? e.status : roles.includes('candidate') ? 'Applying' : 'No enrolment'}
                        </dd>
                      </div>
                      {e ? (
                        <div>
                          <dt className="t-caption m-0 text-ink-700">Cohort</dt>
                          <dd className="t-body-sm m-0 ml-0 text-ink-900">{e.cohort}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap items-center gap-4">
                      <form action="/choose-institution/go" method="post">
                        <input type="hidden" name="institutionId" value={institutionId} />
                        <Button type="submit" aria-label={`Continue to ${inst.name}`}>
                          Continue
                        </Button>
                      </form>
                      <form action="/choose-institution/default" method="post">
                        <input type="hidden" name="institutionId" value={isDefault ? 'none' : institutionId} />
                        <button
                          type="submit"
                          className="t-body-sm text-ink-700 underline underline-offset-2"
                          aria-label={isDefault ? `Stop using ${inst.name} as default` : `Set ${inst.name} as default`}
                        >
                          {isDefault ? 'Stop using as default' : 'Set as default'}
                        </button>
                      </form>
                    </div>
                  </Record>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}
