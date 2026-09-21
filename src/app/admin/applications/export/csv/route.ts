import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution, requestOrigin } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { csvFile } from '@/lib/csv';
import { statusFilter } from '@/modules/admissions/queue-filter';

/**
 * RG-06 — the file itself.
 *
 * A route handler rather than a server action because the answer is a
 * download. The same gates apply: the tenant from the host, the role, and
 * the second factor (requireRole enforces AUTH-08 here as everywhere).
 *
 * The audit entry is written before the response, so a download that fails
 * half way is still on record as attempted — the log is the evidence, and it
 * should err towards saying data may have left.
 */
const PURPOSES = ['registry_reporting', 'accreditation_return', 'sponsor_reconciliation', 'other'];

export async function POST(request: NextRequest) {
  const institution = await requireInstitution();
  const me = await requireRole('registry', 'institution_admin');
  const origin = requestOrigin(request);

  const form = await request.formData();
  const status = String(form.get('status') ?? '') || undefined;
  const purpose = String(form.get('purpose') ?? '');
  const note = String(form.get('note') ?? '').trim();

  const back = (error: string) =>
    NextResponse.redirect(
      new URL(
        `/admin/applications/export?${new URLSearchParams({ ...(status ? { status } : {}), error })}`,
        origin,
      ),
      303,
    );

  if (!PURPOSES.includes(purpose)) return back('Choose why you need the export.');
  if (note.length < 10) {
    return back('Say who it is for and what it will be used for. It goes into the audit log as written.');
  }

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({
        reference: applications.reference,
        status: applications.status,
        submittedAt: applications.submittedAt,
        decisionAt: applications.decisionAt,
        fullName: users.fullName,
        email: users.email,
        cohort: cohorts.name,
      })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .innerJoin(cohorts, eq(cohorts.id, applications.cohortId))
      .where(statusFilter(status))
      .orderBy(desc(applications.submittedAt)),
  );

  await audit({
    action: 'applications.exported',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: me.roles.includes('institution_admin') ? 'institution_admin' : 'registry',
    entity: 'applications',
    detail: { purpose, note, status: status ?? 'needs_action', rows: rows.length },
  });

  const body = csvFile(
    ['Reference', 'Name', 'Email', 'Intake', 'Status', 'Submitted', 'Decided'],
    rows.map((r) => [
      r.reference,
      r.fullName,
      r.email,
      r.cohort,
      r.status,
      r.submittedAt,
      r.decisionAt,
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${institution.slug}-applicants-${stamp}.csv"`,
      // A file of people's details should not sit in a shared cache.
      'Cache-Control': 'no-store',
    },
  });
}
