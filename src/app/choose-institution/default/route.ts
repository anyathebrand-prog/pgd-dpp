import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { requestOrigin } from '@/lib/tenant';
import { affiliationsOf } from '@/modules/auth/affiliations';

/** AU-10 *Set as default*, or `none` to be asked each time. */
export async function POST(request: NextRequest) {
  const origin = requestOrigin(request);
  const claimed = request.headers.get('origin');
  if (claimed && claimed !== origin) return new NextResponse('Cross-origin request refused.', { status: 403 });

  const me = await currentPrincipal();
  if (!me) return NextResponse.redirect(new URL('/login', origin), 303);

  const form = await request.formData();
  const institutionId = String(form.get('institutionId') ?? '');
  const clearing = institutionId === 'none';
  if (!clearing && !affiliationsOf(me.allMemberships).some((a) => a.institutionId === institutionId)) {
    return NextResponse.redirect(new URL('/choose-institution', origin), 303);
  }

  await db
    .update(users)
    .set({ defaultInstitutionId: clearing ? null : institutionId })
    .where(eq(users.id, me.userId));

  return NextResponse.redirect(
    new URL(`/choose-institution?default=${clearing ? 'none' : 'set'}`, origin),
    303,
  );
}
