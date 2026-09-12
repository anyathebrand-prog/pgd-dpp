import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { applications, cohorts, documentQueries, documents, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { signedUrl } from '@/lib/storage';
import { seatsRemaining } from '@/modules/payments/settle';
import { recordFileAccess } from '@/modules/admissions/registry-actions';
import { REQUIRED_DOCUMENTS } from '@/modules/admissions/application';
import { DecisionPanel, QueryPanel } from '@/components/registry-panels';
import { Banner, DataString, Panel, Record } from '@/components/ui';

/**
 * RG-02 application review.
 *
 * Every document link is a short-lived signed URL generated per render and
 * valid for five minutes (CMP-13). Nothing on this page is a durable link to
 * an object, so a URL pasted into a chat message is useless within the hour.
 */
export default async function ReviewApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');

  const [app] = await withTenant(institution.id, (tx) =>
    tx.select().from(applications).where(eq(applications.id, id)).limit(1),
  );
  // RLS means a wrong-tenant id returns nothing rather than someone else's
  // record. The 404 is the correct answer either way.
  if (!app) notFound();

  await recordFileAccess(app.id, app.userId);

  const [candidate] = await db.select().from(users).where(eq(users.id, app.userId)).limit(1);
  const [cohort] = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).where(eq(cohorts.id, app.cohortId)).limit(1),
  );

  const docs = await withTenant(institution.id, (tx) =>
    tx.select().from(documents).where(eq(documents.applicationId, app.id)),
  );
  const queries = await withTenant(institution.id, (tx) =>
    tx.select().from(documentQueries).where(eq(documentQueries.applicationId, app.id)),
  );
  const seats = await seatsRemaining(app.cohortId);

  const personal = app.personal as Record<string, string>;
  const education = app.education as Record<string, string>;
  const experience = app.experience as Record<string, string>;
  const live = new Map(docs.filter((d) => d.status !== 'rejected').map((d) => [d.kind, d]));

  return (
    <>
      <p className="t-body-sm m-0">
        <Link href="/admin/applications" className="text-ink-700 underline underline-offset-2">
          Back to the queue
        </Link>
      </p>

      <div className="mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="t-h1 m-0 text-ink-900">{personal.fullName ?? candidate?.email}</h1>
          <p className="t-caption mt-2 mb-0 text-ink-700">
            <DataString value={app.reference} label="Application reference" /> · {cohort?.name} ·{' '}
            {app.status.replace(/_/g, ' ')}
          </p>
        </div>
        <p className="t-body-sm m-0 text-ink-700">
          {seats > 0 ? `${seats} seats remaining in this cohort` : 'This cohort is full'}
        </p>
      </div>

      {queries.some((q) => !q.resolvedAt) ? (
        <div className="mb-8">
          <Banner tone="warning" title="Waiting on the candidate">
            <ul className="m-0 list-disc pl-5">
              {queries
                .filter((q) => !q.resolvedAt)
                .map((q) => (
                  <li key={q.id}>
                    {q.documentKind.replace(/_/g, ' ')} — raised{' '}
                    {q.createdAt.toLocaleDateString('en-NG')}: {q.note}
                  </li>
                ))}
            </ul>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Record title="Personal details">
            <dl className="t-body-sm m-0 grid grid-cols-[180px_1fr] gap-x-5 gap-y-2 text-ink-900">
              {[
                ['Email', candidate?.email],
                ['Phone', personal.phone],
                ['Date of birth', personal.dob],
                ['Gender', personal.gender],
                ['Address', personal.address],
                ['State of origin', personal.stateOfOrigin],
                ['Nationality', personal.nationality],
                ['Next of kin', `${personal.nokName ?? '—'} · ${personal.nokPhone ?? '—'}`],
              ].map(([k, v]) => (
                <div key={k as string} className="contents">
                  <dt className="text-ink-700">{k}</dt>
                  <dd className="m-0">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </Record>

          <Record title="Education">
            <dl className="t-body-sm m-0 grid grid-cols-[180px_1fr] gap-x-5 gap-y-2 text-ink-900">
              {[
                ['Institution', education.institution],
                ['Degree', education.degree],
                ['Class', education.classOfDegree],
                ['Graduated', education.yearOfGraduation],
                ['Further study', education.degree2 ? `${education.degree2}, ${education.institution2}` : '—'],
              ].map(([k, v]) => (
                <div key={k as string} className="contents">
                  <dt className="text-ink-700">{k}</dt>
                  <dd className="m-0">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </Record>

          <Record title="Work and sponsor">
            <dl className="t-body-sm m-0 grid grid-cols-[180px_1fr] gap-x-5 gap-y-2 text-ink-900">
              {[
                ['Employer', experience.employer],
                ['Role', experience.role],
                ['Experience', experience.years ? `${experience.years} years` : '—'],
                ['Sponsor', experience.sponsorType],
              ].map(([k, v]) => (
                <div key={k as string} className="contents">
                  <dt className="text-ink-700">{k}</dt>
                  <dd className="m-0">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            {experience.statement ? (
              <div className="mt-4 border-t border-ink-700/20 pt-4">
                <p className="t-caption m-0 mb-1 text-ink-700">Why this programme</p>
                <p className="t-body-sm m-0 whitespace-pre-line text-ink-900">{experience.statement}</p>
              </div>
            ) : null}
          </Record>

          <Record title="Documents" meta={`${live.size} of ${REQUIRED_DOCUMENTS.length} on file`}>
            <ul className="m-0 list-none space-y-3 p-0">
              {REQUIRED_DOCUMENTS.map((d) => {
                const doc = live.get(d.kind);
                return (
                  <li key={d.kind} className="t-body-sm flex flex-wrap items-baseline gap-x-3">
                    <span className="min-w-[200px] font-semibold text-ink-900">{d.label}</span>
                    {doc ? (
                      <>
                        <a
                          href={signedUrl(doc.objectKey)}
                          className="text-authority underline underline-offset-2"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {doc.filename}
                          <span className="sr-only"> — link expires in five minutes</span>
                        </a>
                        <span className="t-caption text-ink-700">
                          {(doc.sizeBytes / 1024).toFixed(0)}KB · scan {doc.scanStatus}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-700">Not uploaded</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="t-caption mt-4 mb-0 text-ink-700">
              These links expire five minutes after this page was rendered, and each opening is
              recorded against your account.
            </p>
          </Record>
        </div>

        <aside className="space-y-6">
          <Panel title="Query a document">
            <QueryPanel applicationId={app.id} />
          </Panel>

          <Panel title="Record a decision">
            <DecisionPanel applicationId={app.id} seatsRemaining={seats} />
          </Panel>

          <Panel title="Retention">
            <p className="t-body-sm m-0 text-ink-700">
              If this application is rejected, the uploaded documents are scheduled for automatic
              deletion 180 days after the decision. The schedule runs whether or not anyone
              remembers it.
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
