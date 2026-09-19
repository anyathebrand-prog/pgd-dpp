import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { getOrCreateApplication, openQueries, REQUIRED_DOCUMENTS } from '@/modules/admissions/application';
import { uploadDocument } from '@/modules/admissions/actions';
import { ApplyShell } from '@/components/apply-shell';
import { DocumentSlot } from '@/components/document-slot';
import { Banner, LinkButton } from '@/components/ui';

/** AP-05. */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ photo?: string }>;
}) {
  const { photo } = await searchParams;
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  if (!app) return null;

  const rows = await withTenant(institution.id, (tx) =>
    tx.select().from(documents).where(eq(documents.applicationId, app.id)),
  );
  const current = new Map(
    rows.filter((r) => r.status !== 'rejected' && r.status !== 'purged').map((r) => [r.kind, r]),
  );

  const queries = await openQueries(app);
  const queryFor = new Map(queries.map((q) => [q.documentKind, q.note]));

  return (
    <ApplyShell
      stepKey="documents"
      title="Documents"
      intro="Five items. Photograph each page in good light if you do not have a scan — a readable photo is better than a dark scan."
    >
      {photo === 'saved' ? (
        <div className="mb-6">
          <Banner tone="verified" title="Your photograph is on your application">
            <p>
              Cropped to 35 by 45 and large enough to print. It is used for your ID card, exam
              identity and certificate — and not for facial recognition.
            </p>
          </Banner>
        </div>
      ) : null}

      <Banner tone="info" title="How these are stored">
        <p>
          Files are encrypted at rest and are never publicly addressable. Registry staff open them
          through links that expire in minutes, and every one of those openings is logged. If your
          application is unsuccessful, these files are deleted on the retention schedule.
        </p>
      </Banner>

      <ul className="mt-8 grid list-none gap-5 p-0">
        {REQUIRED_DOCUMENTS.map((d) => (
          <DocumentSlot
            key={d.kind}
            action={uploadDocument}
            kind={d.kind}
            label={d.label}
            hint={d.hint}
            existing={current.get(d.kind) ?? null}
            query={queryFor.get(d.kind) ?? null}
            cropHref={d.kind === 'passport_photo' ? '/apply/documents/photo' : undefined}
          />
        ))}
      </ul>

      <div className="mt-16 flex flex-wrap items-center gap-4">
        <LinkButton href="/apply/consent">Continue to consent</LinkButton>
        <Link href="/apply" className="t-body-sm text-ink-700 underline underline-offset-2">
          Save and come back later
        </Link>
      </div>
    </ApplyShell>
  );
}
