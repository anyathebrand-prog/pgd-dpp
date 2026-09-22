import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, teachingApplications } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { signedUrl } from '@/lib/storage';
import { ActionForm } from '@/components/form';
import { Banner, EmptyState, Record } from '@/components/ui';
import { declineTeachingApplicant, inviteToFaculty } from '@/modules/admin/teaching-applications';

/**
 * The central faculty's applications (`/platform/faculty`).
 *
 * One faculty, run by Data Protection Hub in collaboration with ALDAPCON:
 * "Teach with us" applications land here, not with a university. Inviting
 * someone grants the facilitator role at the universities chosen below and
 * sends the activation link; declining deletes their CV and certificates.
 */
export default async function FacultyApplications({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; declined?: string }>;
}) {
  await requireRole('super_admin');
  const { invited, declined } = await searchParams;

  const waiting = await db
    .select()
    .from(teachingApplications)
    .where(eq(teachingApplications.status, 'received'))
    .orderBy(asc(teachingApplications.createdAt));
  const live = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .where(eq(institutions.status, 'live'))
    .orderBy(asc(institutions.name));

  return (
    <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
      <h1 className="t-h1 m-0 text-ink-900">Faculty applications</h1>
      <p className="t-body measure mt-3 text-ink-700">
        From the public &ldquo;Teach with us&rdquo; form. The faculty is central: when you invite
        someone, choose the universities they will teach at. They receive the facilitator role there
        and an activation link. Nothing is granted until you invite. See the{' '}
        <Link href="/faculty" className="text-ink-900 underline underline-offset-2">
          public Faculty page
        </Link>
        .
      </p>

      {invited || declined ? (
        <div className="mt-8">
          <Banner tone={invited ? 'verified' : 'info'} title={invited ? `${invited} invited to the faculty` : `${declined}'s application declined`}>
            <p>
              {invited
                ? 'They have the facilitator role at the universities you chose, and an activation link by email.'
                : 'Their CV and certificates have been deleted. Reply to them by email if you have not already.'}
            </p>
          </Banner>
        </div>
      ) : null}

      {waiting.length === 0 ? (
        <div className="mt-10">
          <EmptyState heading="No applications waiting">
            New &ldquo;Teach with us&rdquo; applications appear here, oldest first.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-10 grid list-none gap-6 p-0">
          {waiting.map((a) => (
            <Record
              as="li"
              key={a.id}
              title={a.fullName}
              meta={`${a.email}${a.phone ? ` · ${a.phone}` : ''} · applied ${a.createdAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            >
              <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
                <div>
                  <p className="t-caption m-0 text-ink-700">Qualifications and experience</p>
                  <p className="t-body-sm mt-1 mb-4 whitespace-pre-line text-ink-900">{a.qualifications}</p>
                  <p className="t-caption m-0 text-ink-700">Would like to teach</p>
                  <p className="t-body-sm mt-1 mb-4 whitespace-pre-line text-ink-900">{a.areas}</p>
                  <p className="t-caption m-0 text-ink-700">Documents</p>
                  <ul className="t-body-sm mt-1 mb-0 list-none space-y-1 p-0">
                    {a.cvObjectKey ? (
                      <li>
                        <a href={signedUrl(a.cvObjectKey)} className="text-ink-900 underline underline-offset-2">
                          CV{a.cvFilename ? `: ${a.cvFilename}` : ''}
                        </a>
                      </li>
                    ) : (
                      <li className="text-ink-700">No CV on file.</li>
                    )}
                    {(['academic', 'professional'] as const).map((kind) =>
                      a.certificates
                        .filter((c) => c.kind === kind)
                        .map((c, i) => (
                          <li key={c.key}>
                            <a href={signedUrl(c.key)} className="text-ink-900 underline underline-offset-2">
                              {kind === 'academic' ? 'Academic' : 'Professional'} certificate {i + 1}: {c.filename}
                            </a>
                          </li>
                        )),
                    )}
                  </ul>
                  <p className="t-caption mt-2 mb-0 text-ink-700">Links last five minutes; each opening is recorded.</p>
                </div>
                <div className="space-y-4">
                  <ActionForm action={inviteToFaculty} submitLabel="Invite to the faculty">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <fieldset className="m-0 mb-5 border-0 p-0">
                      <legend className="t-label mb-2 p-0 text-ink-900">Teaches at</legend>
                      {live.map((inst) => (
                        <label key={inst.id} className="t-body-sm mb-2 flex items-center gap-3 text-ink-900">
                          <input type="checkbox" name="institutionId" value={inst.id} className="h-5 w-5 accent-[#6da5f2]" />
                          {inst.name}
                        </label>
                      ))}
                    </fieldset>
                  </ActionForm>
                  <ActionForm action={declineTeachingApplicant} submitLabel="Decline">
                    <input type="hidden" name="applicationId" value={a.id} />
                  </ActionForm>
                </div>
              </div>
            </Record>
          ))}
        </ul>
      )}
    </main>
  );
}
