import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, memberships, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, EmptyState, Panel, Record, cx } from '@/components/ui';
import { GRANTABLE, ROLE_COPY, type GrantableRole } from '@/modules/admin/staff-roles';
import { AttestForm, InviteForm, RevokeRole } from '@/components/staff-panels';
import { trainingFor } from '@/modules/compliance/training-status';

/**
 * IA-05 staff & roles — `{school}./admin/staff` (CMP-14, CMP-17).
 *
 * The screen answers one question an assessor will ask directly: who at this
 * institution can read a candidate's identity documents, and who decided they
 * could. So the roster leads with the role and the second factor, not with
 * names, and every row carries the way to take the access away.
 *
 * Second factor is shown even though AUTH-08 already enforces it, because
 * "enforced" and "enrolled" are different facts. A registrar who has never
 * completed setup cannot open the console at all — which looks to their
 * administrator like the account is broken rather than unfinished.
 */
/** CMP-17, as the roster says it. */
const TRAINING_LABEL: Record<string, string> = {
  valid: 'Trained',
  due_soon: 'Due within the month',
  expired: 'Expired',
  outdated: 'Needs retaking',
  never: 'Not yet taken',
};

export default async function Staff({
  searchParams,
}: {
  searchParams: Promise<{
    granted?: string;
    revoked?: string;
    role?: string;
    invited?: string;
    attested?: string;
  }>;
}) {
  const institution = await requireInstitution();
  await requireRole('institution_admin');
  const { granted, revoked, role: affectedRole, invited, attested } = await searchParams;


  const [current] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institution.id))
    .limit(1);

  /*
   * `memberships` and `users` are shared tables — a person is one account
   * across the platform (SSO-04) — so this is a plain read filtered to this
   * institution rather than a `withTenant` one. Policing them with RLS would
   * mean no session ever resolves.
   */
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.fullName,
      status: users.status,
      activated: users.passwordHash,
      totpConfirmedAt: users.totpConfirmedAt,
      lastLoginAt: users.lastLoginAt,
      role: memberships.role,
      grantedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institution.id),
        inArray(memberships.role, [...GRANTABLE]),
      ),
    )
    .orderBy(asc(users.email));

  // One card per person, however many roles they hold — the question is what
  // a human can do here, and that is the union of their roles.
  const people = [...new Map(rows.map((r) => [r.userId, r])).values()].map((r) => ({
    ...r,
    roles: rows.filter((x) => x.userId === r.userId).map((x) => x.role as GrantableRole),
  }));

  const admins = people.filter((p) => p.roles.includes('institution_admin'));

  // CMP-17: annual training, read the same way the DPO console reads it.
  const training = await trainingFor(people.map((p) => p.userId));
  const untrained = people.filter((p) => {
    const t = training.get(p.userId)?.status;
    return t !== 'valid' && t !== 'due_soon';
  });
  const needsMfa = people.filter(
    (p) => p.roles.some((r) => ROLE_COPY[r].mfa) && !p.totpConfirmedAt,
  );
  const neverSignedIn = people.filter((p) => !p.activated);

  // CMP-17: quarterly, so overdue at 90 days. Never attested counts as
  // overdue rather than as "not applicable" — an institution that has never
  // reviewed its access list is the case the control is for.
  const reviewedAt = current?.accessReviewedAt ?? null;
  const daysSince = reviewedAt
    ? Math.floor((Date.now() - reviewedAt.getTime()) / 86_400_000)
    : null;
  const overdue = daysSince === null || daysSince >= 90;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Staff and roles</h1>
        <p className="t-caption m-0 text-ink-700">
          {people.length} {people.length === 1 ? 'person' : 'people'} with access
        </p>
      </div>

      {granted ? (
        <div className="mb-8">
          <Banner tone="verified" title={`${granted} can now work here`}>
            <p>
              They hold {ROLE_COPY[affectedRole as GrantableRole]?.label ?? affectedRole} at{' '}
              {institution.shortName}.{' '}
              {invited
                ? 'An activation link is in their inbox — they set their own password, and nobody here ever knows it.'
                : 'They already had an account on this platform, so they keep the password they have.'}
            </p>
          </Banner>
        </div>
      ) : null}

      {revoked ? (
        <div className="mb-8">
          <Banner tone="info" title={`${revoked} no longer holds that role`}>
            <p>
              {ROLE_COPY[affectedRole as GrantableRole]?.label ?? affectedRole} was removed and any
              session they had open against {institution.shortName} was ended. It took effect
              immediately, not at their next sign-in.
            </p>
          </Banner>
        </div>
      ) : null}

      {attested ? (
        <div className="mb-8">
          <Banner tone="verified" title="Access reviewed">
            <p>
              The list as it stands today is recorded in the audit log, with your name against it.
              The next review is due in 90 days.
            </p>
          </Banner>
        </div>
      ) : null}

      {overdue ? (
        <div className="mb-8">
          <Banner tone="warning" title="Access has not been reviewed this quarter">
            <p>
              {reviewedAt
                ? `The last review was ${daysSince} days ago.`
                : 'Nobody has ever reviewed who can work here.'}{' '}
              CMP-17 asks for a quarterly re-attestation: someone reads the list and confirms that
              every person on it still needs what they hold. Accounts outlive the jobs that
              justified them, and this is the control that catches it.
            </p>
          </Banner>
        </div>
      ) : null}

      {untrained.length > 0 ? (
        <div className="mb-8">
          <Banner tone="warning" title="Not everyone here has current training">
            <p>
              {untrained.map((p) => p.name ?? p.email).join(', ')}{' '}
              {untrained.length === 1 ? 'has' : 'have'} not passed this year&apos;s data protection
              training (CMP-17). It takes ten minutes, at{' '}
              <Link href="/security/training" className="text-ink-900 underline underline-offset-2">
                Data protection training
              </Link>
              .
            </p>
          </Banner>
        </div>
      ) : null}

      {needsMfa.length > 0 ? (
        <div className="mb-8">
          <Banner tone="warning" title="Second factor not yet set up">
            <p>
              {needsMfa.map((p) => p.name ?? p.email).join(', ')}{' '}
              {needsMfa.length === 1 ? 'holds a role that requires' : 'hold roles that require'} an
              authenticator app and{' '}
              {needsMfa.length === 1 ? 'has not enrolled' : 'have not enrolled'} one. They will be
              sent to set it up the first time they try to open the console — not turned away, but
              they cannot work until they finish it.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        <div>
          {people.length === 0 ? (
            <EmptyState heading="Nobody but you">
              Invite the people who will review applications and teach. Until then every task here
              is yours.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-6 p-0">
              {people.map((person) => {
                const mfaRequired = person.roles.some((r) => ROLE_COPY[r].mfa);
                const mfaOk = Boolean(person.totpConfirmedAt);

                return (
                  <Record
                    as="li"
                    key={person.userId}
                    title={person.name ?? person.email}
                    meta={person.email}
                  >
                    <dl className="m-0 mb-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Second factor</dt>
                        <dd
                          className={cx(
                            't-body-sm m-0 ml-0',
                            mfaOk
                              ? 'text-verified-text'
                              : mfaRequired
                                ? 'text-warning'
                                : 'text-ink-700',
                          )}
                        >
                          {mfaOk
                            ? 'Enrolled'
                            : mfaRequired
                              ? 'Required, not set up'
                              : 'Not required'}
                        </dd>
                      </div>
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Last signed in</dt>
                        <dd className="t-body-sm m-0 ml-0 text-ink-900">
                          {person.lastLoginAt
                            ? person.lastLoginAt.toLocaleDateString('en-NG', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })
                            : person.activated
                              ? 'Never'
                              : 'Invitation not yet accepted'}
                        </dd>
                      </div>
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Training</dt>
                        <dd
                          className={cx(
                            't-body-sm m-0 ml-0',
                            training.get(person.userId)?.status === 'valid'
                              ? 'text-verified-text'
                              : training.get(person.userId)?.status === 'due_soon'
                                ? 'text-ink-900'
                                : 'text-warning',
                          )}
                        >
                          {TRAINING_LABEL[training.get(person.userId)?.status ?? 'never']}
                        </dd>
                      </div>
                      <div>
                        <dt className="t-caption m-0 text-ink-700">Access since</dt>
                        <dd className="t-body-sm m-0 ml-0 text-ink-900">
                          {person.grantedAt.toLocaleDateString('en-NG', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </dd>
                      </div>
                    </dl>

                    <ul className="m-0 grid list-none gap-4 p-0">
                      {person.roles.map((r) => (
                        <li
                          key={r}
                          className="flex flex-wrap items-start justify-between gap-3 border-t border-ink-300 pt-4"
                        >
                          <div className="min-w-[200px] flex-1">
                            <p className="t-label m-0 text-ink-900">{ROLE_COPY[r].label}</p>
                            <p className="t-body-sm measure mt-1 mb-0 text-ink-700">
                              {ROLE_COPY[r].scope}
                            </p>
                          </div>
                          <RevokeRole
                            userId={person.userId}
                            role={r}
                            name={person.name ?? person.email}
                            roleLabel={ROLE_COPY[r].label}
                            lastAdmin={r === 'institution_admin' && admins.length <= 1}
                          />
                        </li>
                      ))}
                    </ul>
                  </Record>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="space-y-6">
          <Panel title="Give somebody access">
            <InviteForm institutionName={institution.name} />
          </Panel>

          <Panel title={overdue ? 'Review is due' : 'Access review'}>
            <p className="t-body-sm mt-0 mb-4 text-ink-700">
              {reviewedAt
                ? `Last reviewed ${reviewedAt.toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}, ${daysSince} days ago.`
                : 'This list has never been reviewed.'}{' '}
              Reviewing it records who held what today, in a log nobody here can edit.
            </p>
            <AttestForm count={people.length} />
          </Panel>

          <Panel title="What this console cannot grant">
            {/* CMP-14 stated where somebody would go looking for the missing
                option, rather than left as an absence they read as a bug. */}
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Platform roles — super administrator, data protection officer, library curator — are
              not grantable from inside an institution. One university being able to appoint a
              super administrator would make the boundary between universities a convention rather
              than a control.
            </p>
            <p className="t-body-sm m-0 text-ink-700">
              Student and alumni access is not granted here either. Those come from an admission
              and an enrolment, so that a student record always has an application and a payment
              behind it.
            </p>
          </Panel>

          {neverSignedIn.length > 0 ? (
            <Panel title="Invitations outstanding">
              <p className="t-body-sm mt-0 mb-0 text-ink-700">
                {neverSignedIn.map((p) => p.name ?? p.email).join(', ')} have not used their
                activation link yet. Links expire, and an unused one is an account that cannot be
                signed into — revoke the role and invite again rather than leaving it open.
              </p>
            </Panel>
          ) : null}
        </aside>
      </div>

      <p className="t-body-sm mt-10">
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
