import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { assembleEvidence } from '@/modules/compliance/evidence';

/**
 * DP-08 / CMP-16 — the download itself.
 *
 * A route handler rather than a server action, because the output is a file
 * and because the access check has to run on the request that produces the
 * bytes, not on the page that offered the button.
 *
 * `requireRole` redirects a caller who lacks the role, which is the right
 * behaviour for a link a browser followed: an unauthorised fetch of this URL
 * lands on /no-access rather than downloading a differently-shaped file.
 */
export async function GET(request: NextRequest) {
  const me = await requireRole('dpo', 'super_admin');

  const params = request.nextUrl.searchParams;
  const to = parseDate(params.get('to')) ?? new Date();
  // Twelve months, because AUTH-09 retains the audit log for twelve months
  // and a default window longer than the data would imply gaps that are not
  // gaps.
  const from = parseDate(params.get('from')) ?? new Date(to.getTime() - 365 * 86_400_000);

  const bundle = await assembleEvidence(from, to);

  // Exporting the audit log is itself an event the audit log should carry.
  // An investigation asks who produced the bundle it is reading.
  await audit({
    action: 'compliance.evidence_exported',
    actorId: me.userId,
    actorRole: 'dpo',
    entity: 'audit_log',
    detail: { from: from.toISOString(), to: to.toISOString(), counts: bundle.counts },
  });

  const filename = `compliance-evidence-${to.toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
