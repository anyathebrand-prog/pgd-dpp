import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { assembleSubjectData } from '@/modules/compliance/dsr';

/**
 * ST-16 / CMP-07 — portability, self-served.
 *
 * §6.6 is explicit that most requests should never become tickets: a student
 * downloads their own data without asking anyone, and the DPO queue is left
 * for the cases that genuinely need a human.
 *
 * The export is still logged. A subject access request answered by the person
 * themselves is a processing event, and CMP-14 wants a record of it.
 */
export async function GET() {
  const me = await requireUser();
  const data = await assembleSubjectData(me.userId);
  if (!data) return NextResponse.json({ error: 'No account found.' }, { status: 404 });

  await audit({
    action: 'dsr.self_service_export',
    actorId: me.userId,
    actorRole: 'self',
    subjectId: me.userId,
    entity: 'users',
    entityId: me.userId,
  });

  const filename = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
