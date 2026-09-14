import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { certificates, enrollments, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, DataString, EmptyState, Record } from '@/components/ui';
import { CertifyButton } from '@/components/graduation-panels';

/**
 * Graduation — the missing end of the funnel (ALM-01, LRN-08).
 *
 * The flow takes a candidate from discovery to enrolled and then stops. §5.8
 * needs a Student → Alumni transition "on programme completion", and §5.5
 * needs a certificate issued, but no screen in the app flow issues one — so
 * this builds the obvious place for it: the registry's own console, next to
 * the admissions queue where the same people work.
 *
 * The decision is deliberately manual. Certification is a university saying
 * someone has completed its programme, and inferring that from a grade
 * average would be this platform quietly awarding a qualification on an
 * institution's behalf.
 */
export default async function Graduation({
  searchParams,
}: {
  searchParams: Promise<{ certified?: string }>;
}) {
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');
  const { certified } = await searchParams;

  const active = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.institutionId, institution.id), eq(enrollments.status, 'active')))
      .orderBy(asc(enrollments.createdAt)),
  );

  const completed = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.institutionId, institution.id), eq(enrollments.status, 'completed')))
      .orderBy(asc(enrollments.completedAt)),
  );

  const ids = [...active, ...completed].map((e) => e.userId);
  const people = ids.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email, status: users.status })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const nameOf = (id: string) => {
    const person = people.find((p) => p.id === id);
    return person?.fullName ?? person?.email ?? 'Student';
  };

  const issued = completed.length
    ? await withTenant(institution.id, (tx) =>
        tx
          .select()
          .from(certificates)
          .where(
            inArray(
              certificates.enrollmentId,
              completed.map((e) => e.id),
            ),
          ),
      )
    : [];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Graduation</h1>
        <p className="t-caption m-0 text-ink-700">Longest enrolled first</p>
      </div>

      {certified ? (
        <div className="mb-6">
          <Banner tone="verified" title="Certified — they are now an alumnus">
            <p>
              The certificate is issued with a verification code, the enrolment is closed, and
              their library access continues for good. They are listed under Graduated below.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="mb-8">
        <Banner tone="warning" title="Certifying is not reversible from here">
          <p>
            It issues the certificate, closes the enrolment and makes the student an alumnus —
            which changes what they can see and gives them library access for good. Make sure the
            gradebook says what you think it says first.
          </p>
        </Banner>
      </div>

      <h2 className="t-h2 m-0 mb-4 text-ink-900">Still studying ({active.length})</h2>
      {active.length === 0 ? (
        <EmptyState heading="Nobody is currently enrolled">
          Students appear here once their tuition has settled and they have a matriculation number.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-5 p-0">
          {active.map((e) => (
            <Record
              as="li"
              key={e.id}
              title={nameOf(e.userId)}
              meta={`${e.matricNumber} · enrolled ${e.createdAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`}
            >
              <CertifyButton enrollmentId={e.id} name={nameOf(e.userId)} />
            </Record>
          ))}
        </ul>
      )}

      {completed.length > 0 ? (
        <>
          <h2 className="t-h2 mt-12 mb-4 text-ink-900">Graduated ({completed.length})</h2>
          <ul className="m-0 grid list-none gap-3 p-0">
            {completed.map((e) => {
              const cert = issued.find((c) => c.enrollmentId === e.id);
              return (
                <li key={e.id} className="border-b border-ink-300 pb-3">
                  <p className="t-body-sm m-0 font-semibold text-ink-900">{nameOf(e.userId)}</p>
                  <p className="t-caption m-0 text-ink-700">
                    {e.matricNumber} ·{' '}
                    {e.completedAt?.toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }) ?? 'recently'}
                    {cert ? ' · ' : ''}
                    {cert ? (
                      <DataString value={cert.verificationCode} label="Verification code" />
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <p className="t-body-sm mt-10">
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
