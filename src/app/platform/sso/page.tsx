import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { tenantUrl } from '@/lib/tenant';
import { ActionForm } from '@/components/form';
import { Banner, DataString, Field, Input, Record } from '@/components/ui';
import { disableOidc, saveOidcSettings } from '@/modules/admin/sso-settings';

/**
 * SSO-03 — university sign-in, per institution (`app./platform/sso`).
 *
 * Tier 1 of §5.4. Each university's OpenID Connect provider, or the BoxyHQ
 * Jackson connection standing in front of its SAML IdP, is registered here
 * with the three things any OIDC provider issues: an issuer URL, a client id
 * and a secret. The redirect address to give the university's IT team is
 * shown beside each form, because it is the first thing they ask for.
 */
export default async function SsoSettings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; off?: string }>;
}) {
  await requireRole('super_admin');
  const { saved, off } = await searchParams;
  const rows = await db.select().from(institutions).orderBy(asc(institutions.name));

  return (
    <div>
      <main id="main" className="mx-auto max-w-[1120px] px-4 py-10 md:px-8">
        <h1 className="t-h1 m-0 text-ink-900">University sign-in</h1>
        <p className="t-body measure mt-3 text-ink-700">
          Tier 1: students sign in with their university account. For a university on Microsoft
          365 or Google Workspace, register it as an OpenID provider directly. For one with a SAML
          IdP, register the Jackson connection. Staff never sign in this way; they keep their
          password and second factor.
        </p>

        {saved || off ? (
          <div className="mt-8">
            <Banner tone="verified" title={saved ? 'Saved and checked' : 'Turned off'}>
              <p>
                {saved
                  ? `${saved.toUpperCase()}’s provider answered its discovery document. Students there now see the university sign-in on the login page.`
                  : `${off!.toUpperCase()} is back to email and password only. Accounts already linked keep their passwords.`}
              </p>
            </Banner>
          </div>
        ) : null}

        <ul className="mt-10 grid list-none gap-8 p-0">
          {rows.map((inst) => {
            const on = Boolean(inst.oidcIssuer && inst.oidcClientId && inst.oidcClientSecret);
            return (
              <Record
                as="li"
                key={inst.id}
                title={inst.name}
                meta={on ? 'University sign-in on' : 'Email and password only'}
              >
                <p className="t-body-sm mt-0 mb-6 text-ink-700">
                  Redirect address for their IT team:{' '}
                  <DataString value={tenantUrl(inst.slug, '/sso/oidc/callback')} label="Redirect URI" />
                </p>
                <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
                  <ActionForm action={saveOidcSettings} submitLabel={on ? 'Check and save' : 'Check and turn on'}>
                    <input type="hidden" name="institutionId" value={inst.id} />
                    <Field label="Issuer" name="issuer" inputId={`issuer-${inst.slug}`} required>
                      <Input
                        id={`issuer-${inst.slug}`}
                        name="issuer"
                        type="url"
                        defaultValue={inst.oidcIssuer ?? ''}
                        placeholder="https://login.microsoftonline.com/…/v2.0"
                        required
                      />
                    </Field>
                    <Field label="Client id" name="clientId" inputId={`client-${inst.slug}`} required>
                      <Input id={`client-${inst.slug}`} name="clientId" defaultValue={inst.oidcClientId ?? ''} required />
                    </Field>
                    <Field
                      label="Client secret"
                      name="clientSecret"
                      inputId={`secret-${inst.slug}`}
                      required={!inst.oidcClientSecret}
                      helper={inst.oidcClientSecret ? 'A secret is on file. Leave this empty to keep it.' : undefined}
                    >
                      <Input
                        id={`secret-${inst.slug}`}
                        name="clientSecret"
                        type="password"
                        autoComplete="off"
                        required={!inst.oidcClientSecret}
                      />
                    </Field>
                    <Field
                      label="Email domains it may vouch for"
                      name="domains"
                      inputId={`domains-${inst.slug}`}
                      required
                      helper="Comma-separated. Subdomains are included, so unilag.edu.ng covers students.unilag.edu.ng."
                    >
                      <Input
                        id={`domains-${inst.slug}`}
                        name="domains"
                        defaultValue={(inst.oidcEmailDomains ?? []).join(', ')}
                        required
                      />
                    </Field>
                  </ActionForm>

                  {on ? (
                    <div>
                      <p className="t-body-sm mt-0 mb-4 text-ink-700">
                        Turning it off removes the button from the login page. Nobody loses access:
                        every account can still sign in with email and password.
                      </p>
                      <ActionForm action={disableOidc} submitLabel="Turn off university sign-in">
                        <input type="hidden" name="institutionId" value={inst.id} />
                      </ActionForm>
                    </div>
                  ) : null}
                </div>
              </Record>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
