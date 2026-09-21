import { NextResponse, type NextRequest } from 'next/server';
import { createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { requireInstitution, requestOrigin } from '@/lib/tenant';
import { homeFor } from '@/modules/auth/affiliations';
import { redeemSwitch } from '@/modules/auth/switch';

/**
 * AU-10, the receiving end. Redeems a switch token minted by another host
 * into a session on this one, then lands on the role home here.
 *
 * The second factor carries over: the token records whether the session that
 * asked for it had cleared TOTP, and it can only have been minted by that
 * session a minute ago. A staff member moving between two schools is not
 * asked for a code twice; one who had not cleared it still has to.
 */
export async function GET(request: NextRequest) {
  const institution = await requireInstitution();
  const origin = requestOrigin(request);
  const token = request.nextUrl.searchParams.get('token') ?? '';

  const redeemed = token ? await redeemSwitch(token, institution.id) : null;
  if (!redeemed) {
    return NextResponse.redirect(new URL('/choose-institution?failed=1', origin));
  }

  await createSession(redeemed.userId, {
    institutionId: institution.id,
    remember: false,
    mfaSatisfied: redeemed.mfaSatisfied,
  });
  await audit({
    action: 'auth.institution_switched',
    institutionId: institution.id,
    actorId: redeemed.userId,
    subjectId: redeemed.userId,
  });

  return NextResponse.redirect(new URL(homeFor(redeemed.roles), origin));
}
