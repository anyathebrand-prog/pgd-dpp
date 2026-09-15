'use server';

import { eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { institutions, memberships, programmes, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { checkBrandColour } from '@/lib/contrast';
import { issueActivationLink } from '../auth/actions';
import type { FormState } from '../auth/actions';

/**
 * SA-01 tenant provisioning (§4).
 *
 * Creating an institution is the one action on this platform that creates a
 * *controller* rather than a record — a new organisation with its own
 * students, its own money and its own obligations under the NDPA. So it does
 * three things together and none of them separately: the institution, its
 * programme, and a named human who can actually sign in and finish the setup.
 *
 * Provisioning without that last part is where multi-tenant platforms rot: a
 * tenant exists, nobody can open it, and someone at the platform ends up
 * doing an institution's configuration for them — which is exactly the
 * arrangement §6.3's controller/processor split says must not happen.
 */

const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'static', 'assets', 'platform'];

export async function provisionTenant(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');

  const name = String(form.get('name') ?? '').trim();
  const shortName = String(form.get('shortName') ?? '').trim().toUpperCase();
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const city = String(form.get('city') ?? '').trim();
  const brandColour = String(form.get('brandColour') ?? '#6B2436').trim();
  const adminEmail = String(form.get('adminEmail') ?? '').trim().toLowerCase();
  const adminName = String(form.get('adminName') ?? '').trim();

  if (name.length < 4) return { error: 'Give the institution its full legal name.' };
  if (shortName.length < 2 || shortName.length > 12) {
    return { error: 'The short name is what appears on a matriculation number — 2 to 12 letters.' };
  }
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) {
    return { error: 'The subdomain is lowercase letters, numbers and hyphens, starting with a letter.' };
  }
  if (RESERVED.includes(slug)) {
    return { error: `“${slug}” is reserved by the platform. Choose another subdomain.` };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    return { error: 'Give a working email for the first administrator.' };
  }
  if (adminName.length < 2) return { error: 'Name the first administrator.' };

  /*
   * §2.5 and the contrast rules: a tenant's brand colour is the one token an
   * institution may set, and it still has to be legible. Checking it here
   * rather than at first render means a university never sees its own
   * branding refused by a page after the fact.
   */
  const contrast = checkBrandColour(brandColour);
  if (!contrast.passes) {
    return {
      error: contrast.suggestion
        ? `${contrast.problem} The nearest colour that passes is ${contrast.suggestion}.`
        : (contrast.problem ?? 'That colour is not legible on Paper.'),
    };
  }

  const [existing] = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.slug, slug))
    .limit(1);
  if (existing) return { error: `There is already an institution on ${slug}.` };

  const [institution] = await db
    .insert(institutions)
    .values({
      slug,
      name,
      shortName,
      city: city || null,
      brandColour,
      // Provisioning, not live: PB-02 lists live institutions, and a tenant
      // with no fees, no cohort and no payout account is not ready to be
      // offered to a candidate.
      status: 'provisioning',
    })
    .returning();

  /*
   * LRN-01's top level. Everything else — modules, cohorts, fees — is the
   * institution's own work from IA-02 onwards.
   *
   * Through withTenant, because `programmes` is tenant-scoped: a plain insert
   * is refused by row-level security, which is the policy working rather than
   * an obstacle to route around. The tenant is the one created above.
   */
  await withTenant(institution.id, (tx) =>
    tx.insert(programmes).values({
      institutionId: institution.id,
      title: 'Post Graduate Diploma in Data Protection & Privacy',
    }),
  );

  // One human, one account (SSO-04): if this person already exists — an
  // administrator at a second institution — they are given the role rather
  // than a second account.
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  const admin =
    existingUser ??
    (
      await db
        .insert(users)
        .values({ email: adminEmail, fullName: adminName, status: 'staff' })
        .returning()
    )[0];

  await db
    .insert(memberships)
    .values({ userId: admin.id, institutionId: institution.id, role: 'institution_admin' })
    .onConflictDoNothing();

  // AUTH-01: an activation link, never a generated password. The person sets
  // their own, and the link is what proves they hold the address.
  const proto = process.env.APP_PROTOCOL ?? 'http';
  const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
  if (!existingUser?.passwordHash) {
    await issueActivationLink(admin.id, adminEmail, name, `${slug}.${root}`);
  }

  await audit({
    action: 'platform.tenant_provisioned',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'institutions',
    entityId: institution.id,
    detail: { slug, name, adminEmail, existingAdmin: Boolean(existingUser) },
  });

  return {
    redirectTo: `/platform/tenants?provisioned=${slug}&url=${encodeURIComponent(`${proto}://${slug}.${root}`)}`,
  };
}

/**
 * §4 lifecycle. "Exiting" is not a synonym for suspended: §6.3 attaches a
 * data export obligation to it, so it is a distinct state a platform admin
 * has to choose deliberately.
 */
export async function setTenantStatus(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');

  const institutionId = String(form.get('institutionId') ?? '');
  const status = String(form.get('status') ?? '') as 'provisioning' | 'live' | 'suspended';

  if (!['provisioning', 'live', 'suspended'].includes(status)) {
    return { error: 'Unknown status.' };
  }

  const [institution] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1);
  if (!institution) return { error: 'That institution does not exist.' };

  if (status === 'live') {
    // Going live without a payout account means the first candidate to reach
    // checkout is stopped there, having already filled in an application.
    if (!institution.paystackSubaccountCode || !institution.payoutVerifiedAt) {
      return {
        error: `${institution.shortName} has no verified payout account. Going live would let candidates apply and then be stopped at checkout, which is worse than not being listed.`,
      };
    }
  }

  await db
    .update(institutions)
    .set({ status, updatedAt: new Date() })
    .where(eq(institutions.id, institutionId));

  await audit({
    action: `platform.tenant_${status}`,
    institutionId,
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'institutions',
    entityId: institutionId,
  });

  return {
    notice:
      status === 'live'
        ? `${institution.shortName} is live and listed to candidates.`
        : status === 'suspended'
          ? `${institution.shortName} is suspended. Nobody there can sign in, and its programme is delisted.`
          : `${institution.shortName} is back in provisioning and no longer listed.`,
  };
}
