import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { readAcrossTenants } from '@/db';
import { applications, documents } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getObject, signatureValid } from '@/lib/storage';

/**
 * CMP-13 / CMP-14 — the only way a stored document is ever read.
 *
 * Three independent checks, all of which must pass:
 *
 *   1. the URL signature is valid and unexpired (five minutes),
 *   2. the caller has a session,
 *   3. the caller either owns the document or holds a staff role at the
 *      institution that owns it.
 *
 * The signature alone is not treated as authorisation. A signed URL can be
 * forwarded, and "whoever holds the link" is not an access control model for
 * someone's degree certificate.
 *
 * Every successful read is logged against the data subject, which is what makes
 * "who has seen this person's documents" answerable (CMP-09).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') ?? '';
  const expires = url.searchParams.get('expires') ?? '';
  const sig = url.searchParams.get('sig') ?? '';

  if (!signatureValid(key, expires, sig)) {
    return NextResponse.json({ error: 'This link has expired.' }, { status: 403 });
  }

  const me = await currentPrincipal();
  if (!me) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // `documents` is tenant-scoped, but this lookup needs to find the row before
  // it knows the tenant. The object key itself carries the institution id, and
  // the ownership check below is what actually authorises the read.
  const [doc] = await readAcrossTenants('signed-document-access', (tx) =>
    tx.select().from(documents).where(eq(documents.objectKey, key)).limit(1),
  );
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const staffHere = me.allMemberships.some(
    (m) =>
      m.institutionId === doc.institutionId &&
      ['registry', 'institution_admin', 'facilitator', 'dpo', 'super_admin'].includes(m.role),
  );

  const [app] = await readAcrossTenants('signed-document-access', (tx) =>
    tx
      .select({ userId: applications.userId })
      .from(applications)
      .where(eq(applications.id, doc.applicationId))
      .limit(1),
  );
  const owns = app?.userId === me.userId;

  if (!staffHere && !owns) {
    return NextResponse.json({ error: 'Not yours to open.' }, { status: 403 });
  }

  // A file that has not cleared the virus scan is not served to anyone.
  if (doc.scanStatus === 'infected') {
    return NextResponse.json({ error: 'This file was rejected by the virus scan.' }, { status: 409 });
  }
  if (doc.purgedAt) {
    return NextResponse.json({ error: 'This file has been deleted under the retention schedule.' }, { status: 410 });
  }

  await audit({
    action: 'document.opened',
    institutionId: doc.institutionId,
    actorId: me.userId,
    actorRole: staffHere ? 'staff' : 'self',
    entity: 'documents',
    entityId: doc.id,
    subjectId: owns ? me.userId : null,
    detail: { kind: doc.kind },
  });

  const body = await getObject(key);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': doc.contentType,
      // inline so registry can read it without a download step; nosniff and the
      // CSP below stop a crafted upload being treated as a document to execute.
      'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
