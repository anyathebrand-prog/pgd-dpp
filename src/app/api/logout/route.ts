import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, sessions } from '@/db/schema';
import { hashIp, sha256 } from '@/lib/crypto';
import { clientIp } from '@/lib/auth';

/**
 * Sign out. A plain form post, so it works without JavaScript.
 *
 * This is deliberately self-contained rather than calling the `logOut` server
 * action. A Route Handler and a Server Action are different execution
 * contexts, and calling an action that uses `redirect()` from inside a handler
 * produced ``headers` was called outside a request scope`` in a production
 * build — the action's redirect unwinds past the point the handler is still
 * expected to be running in.
 *
 * Signing out while already signed out is a no-op, not an error.
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get('pgd_session')?.value;

  if (token) {
    const [revoked] = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256(token)))
      .returning({ userId: sessions.userId, institutionId: sessions.institutionId });

    if (revoked) {
      const h = await headers();
      await db.insert(auditLog).values({
        institutionId: revoked.institutionId,
        actorId: revoked.userId,
        action: 'auth.logout',
        subjectId: revoked.userId,
        ipHash: hashIp(clientIp(h)),
      });
    }
  }

  const h = await headers();
  const proto = process.env.APP_PROTOCOL ?? 'http';
  const res = NextResponse.redirect(`${proto}://${h.get('host')}/login`, { status: 303 });
  res.cookies.delete('pgd_session');
  return res;
}
