import Link from 'next/link';
import { TopBar, Footer } from '@/components/shell';
import { Banner, DataString, Panel } from '@/components/ui';

/**
 * PB-09 SSO integration guide (SSO-05).
 *
 * Written for a university IT team, which is a different reader from anyone
 * else this product has: they are not evaluating the programme, they have a
 * bespoke PHP portal and a ticket, and they want the payload shape and the
 * failure list.
 *
 * §5.4 is explicit that Tier 1 is an assumption to validate rather than a
 * plan, so this leads with Tier 3 — which needs nothing at all — and treats
 * Tier 2 as the realistic integration. A page that opened with SAML would
 * lose most of the people reading it on the first line.
 */
export default async function Integrations() {
  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-12">
        <h1 className="t-h1 m-0 text-ink-900">Connecting your portal</h1>
        <p className="t-body measure mt-3 text-ink-700">
          For university IT teams. There are three ways for a student to arrive here from your
          portal, and the first one needs nothing from you at all.
        </p>

        <section className="mt-12">
          <h2 className="t-h2 m-0 text-ink-900">Tier 3 — a link</h2>
          <p className="t-body measure mt-2 text-ink-700">
            Put a tile on your portal pointing at your institution&apos;s subdomain. The student
            logs in here with their own password. No integration, no key exchange, nothing to
            maintain — and it is what every institution starts on.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="t-h2 m-0 text-ink-900">Tier 2 — a signed link</h2>
          <p className="t-body measure mt-2 text-ink-700">
            Your portal signs a small payload with a shared secret and redirects the student to it.
            They arrive already signed in. This is the tier most portals can build in an afternoon,
            because it needs no identity provider — just an HMAC.
          </p>

          <div className="mt-6">
            <Panel title="The payload">
              <pre className="t-data m-0 overflow-x-auto whitespace-pre text-ink-900">{`{
  "email": "student@university.edu.ng",   // the address we hold for them
  "nonce": "8f3c1d...",                   // unique per link, 8+ characters
  "iat":   1789312345,                    // issued at, seconds
  "exp":   1789312465                     // at most 120 seconds after iat
}`}</pre>
              <p className="t-body-sm mt-4 mb-0 text-ink-700">
                Signed HS256 with the shared secret, then sent as{' '}
                <DataString value="/sso/handoff?token=…" label="Handoff URL" /> on your
                institution&apos;s subdomain.
              </p>
            </Panel>
          </div>

          <div className="mt-6">
            <Banner tone="warning" title="Four rules, and why each one exists">
              <ul className="m-0 list-disc pl-5">
                <li>
                  <strong>HS256 only.</strong> Tokens claiming any other algorithm are rejected
                  before the signature is read, which is what stops an{' '}
                  <code>alg: none</code> downgrade.
                </li>
                <li className="mt-2">
                  <strong>120 seconds.</strong> A handoff URL is a bearer credential while it
                  lives, and it will end up in a browser history. We allow 60 seconds of clock
                  tolerance and log every time we use it — a drifting portal clock is the most
                  common real failure, and we would rather warn you than lock your students out.
                </li>
                <li className="mt-2">
                  <strong>One nonce, once.</strong> A replayed link is refused even inside its
                  window.
                </li>
                <li className="mt-2">
                  <strong>No auto-provisioning.</strong> A token for someone with no account here
                  is an error, never a new student. Your portal asserting that someone is enrolled
                  is not the same as this institution having admitted them.
                </li>
              </ul>
            </Banner>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="t-h2 m-0 text-ink-900">Tier 1 — SAML or OIDC</h2>
          <p className="t-body measure mt-2 text-ink-700">
            If your institution runs an identity provider — including Microsoft 365 or Google
            Workspace for Education — full federated sign-in is on the roadmap rather than in the
            product. Tell us you have one; it moves up the list when institutions actually have
            them, not before.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="t-h2 m-0 text-ink-900">Getting a key</h2>
          <p className="t-body measure mt-2 text-ink-700">
            Shared secrets are issued during institutional onboarding and are never sent by email.
            Write to <a href="mailto:dpo@example.ng" className="text-ink-900 underline underline-offset-2">dpo@example.ng</a>{' '}
            from an address on your institution&apos;s domain and ask for sandbox credentials; we
            will arrange the exchange and give you a test endpoint to sign against.
          </p>
        </section>

        <p className="t-body-sm mt-16">
          <Link href="/trust" className="text-ink-700 underline underline-offset-2">
            What we do with the data behind all of this
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
