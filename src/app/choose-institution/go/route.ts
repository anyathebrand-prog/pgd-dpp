import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { currentPrincipal } from '@/lib/auth';
import { currentInstitution, requestOrigin, tenantUrl } from '@/lib/tenant';
import { affiliationsOf, homeFor } from '@/modules/auth/affiliations';
import { issueSwitch } from '@/modules/auth/switch';

/**
 * AU-10 *Continue*. A route handler because the answer is a redirect to
 * another host, and a plain form post keeps it working without JavaScript.
 *
 * The cookie is SameSite=Lax, so a cross-site form cannot post here with a
 * session; the Origin check makes that explicit rather than incidental.
 */
export async function POST(request: NextRequest) {
  const origin = requestOrigin(request);
  const claimed = request.headers.get('origin');
  if (claimed && claimed !== origin) return new NextResponse('Cross-origin request refused.', { status: 403 });

  const me = await currentPrincipal();
  if (!me) return NextResponse.redirect(new URL('/login', origin), 303);

  const form = await request.formData();
  const institutionId = String(form.get('institutionId') ?? '');
  const affiliation = affiliationsOf(me.allMemberships).find((a) => a.institutionId === institutionId);
  if (!affiliation) return NextResponse.redirect(new URL('/choose-institution', origin), 303);

  const here = await currentInstitution();
  if (here?.id === institutionId) {
    return NextResponse.redirect(new URL(homeFor(affiliation.roles), origin), 303);
  }

  const [target] = await db
    .select({ slug: institutions.slug })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1);
  const token = await issueSwitch(me.userId, institutionId, me.mfaSatisfied);
  return NextResponse.redirect(tenantUrl(target.slug, `/switch?token=${token}`), 303);
}
