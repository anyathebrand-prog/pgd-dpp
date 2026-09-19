import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { enrollments } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { DataString, LinkButton, Record, Seal } from '@/components/ui';

/** PY-07. */
export default async function EnrolledPage() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const [enrollment] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.userId, me.userId))
      .orderBy(desc(enrollments.createdAt))
      .limit(1),
  );
  if (!enrollment) redirect('/apply');

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <div className="flex items-start gap-6">
        <Seal label="Enrolment confirmed" />
        <div>
          <h1 className="t-h1 m-0 text-ink-900">You are enrolled</h1>
          <p className="t-body mt-3 text-ink-700">
            {institution.name} has your payment and your place is confirmed.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <Record title="Your matriculation number" meta="Quote this in anything you send the registry">
          <p className="t-data-lg m-0 select-all text-ink-900">
            <DataString value={enrollment.matricNumber} size="lg" label="Matriculation number" />
          </p>
        </Record>
      </div>

      <div className="mt-16">
        <LinkButton href="/dashboard">Go to your dashboard</LinkButton>
      </div>
    </main>
  );
}
