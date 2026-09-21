'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { discover } from '@/modules/auth/oidc';
import type { FormState } from '../auth/actions';

/**
 * SSO-03 settings, per institution, for the platform team (§5.9).
 *
 * Onboarding a university's identity provider is an exchange between two IT
 * teams, and the platform side of it happens here. The issuer is checked by
 * fetching its discovery document before anything is saved, so a typo is
 * found now rather than by the first student who tries.
 *
 * The client secret is write-only. Leaving the field empty keeps the one on
 * file; it is never rendered back and never written to the audit log.
 */

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function saveOidcSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');
  const institutionId = String(form.get('institutionId') ?? '');
  const issuer = String(form.get('issuer') ?? '').trim().replace(/\/+$/, '');
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  const domains = String(form.get('domains') ?? '')
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

  const [inst] = await db.select().from(institutions).where(eq(institutions.id, institutionId)).limit(1);
  if (!inst) return { error: 'That institution does not exist.' };

  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return { error: 'The issuer is a URL, such as https://login.microsoftonline.com/{tenant}/v2.0.' };
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production')) {
    return { error: 'The issuer must be https. Tokens fetched over plain http could be altered in transit.' };
  }
  if (clientId.length < 3) return { error: 'Enter the client id the university issued.' };
  if (!clientSecret && !inst.oidcClientSecret) return { error: 'Enter the client secret.' };
  if (domains.length === 0) {
    return { error: 'Name at least one email domain this provider may vouch for, such as unilag.edu.ng.' };
  }
  const bad = domains.find((d) => !DOMAIN.test(d));
  if (bad) return { error: `“${bad}” is not a domain. Enter domains only, such as unilag.edu.ng.` };
  const publicMail = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
  const shared = domains.find((d) => publicMail.includes(d));
  if (shared) {
    return {
      error: `${shared} belongs to everyone. A university provider may only vouch for the university’s own addresses.`,
    };
  }

  try {
    await discover(issuer);
  } catch (err) {
    return { error: `The issuer did not answer as an OpenID provider: ${(err as Error).message}.` };
  }

  await db
    .update(institutions)
    .set({
      oidcIssuer: issuer,
      oidcClientId: clientId,
      ...(clientSecret ? { oidcClientSecret: clientSecret } : {}),
      oidcEmailDomains: domains,
    })
    .where(eq(institutions.id, institutionId));

  await audit({
    action: 'sso.oidc_configured',
    institutionId,
    actorId: me.userId,
    actorRole: 'super_admin',
    detail: { issuer, clientId, domains, secretChanged: Boolean(clientSecret) },
  });

  return { redirectTo: `/platform/sso?saved=${inst.slug}` };
}

export async function disableOidc(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');
  const institutionId = String(form.get('institutionId') ?? '');
  const [inst] = await db.select().from(institutions).where(eq(institutions.id, institutionId)).limit(1);
  if (!inst) return { error: 'That institution does not exist.' };

  await db
    .update(institutions)
    .set({ oidcIssuer: null, oidcClientId: null, oidcClientSecret: null, oidcEmailDomains: [] })
    .where(eq(institutions.id, institutionId));

  await audit({
    action: 'sso.oidc_disabled',
    institutionId,
    actorId: me.userId,
    actorRole: 'super_admin',
  });

  return { redirectTo: `/platform/sso?off=${inst.slug}` };
}
