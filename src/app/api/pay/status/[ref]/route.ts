import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactions } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';

/**
 * What PY-02 polls. It reports the status the webhook wrote; it never decides
 * one. Scoped to the caller's own transaction — a payment reference is
 * guessable enough that reading someone else's status must not be possible.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const me = await currentPrincipal();
  const institution = await currentInstitution();
  if (!me || !institution) return NextResponse.json({ status: 'unknown' }, { status: 401 });

  const [txn] = await withTenant(institution.id, (tx) =>
    tx
      .select({ status: transactions.status, context: transactions.context })
      .from(transactions)
      .where(and(eq(transactions.reference, ref), eq(transactions.userId, me.userId)))
      .limit(1),
  );

  if (!txn) return NextResponse.json({ status: 'unknown' }, { status: 404 });

  return NextResponse.json(
    {
      status: txn.status,
      next: txn.context === 'tuition' ? '/enrolled' : `/pay/success/${ref}`,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
