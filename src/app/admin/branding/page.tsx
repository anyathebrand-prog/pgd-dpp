import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { BrandingEditor } from '@/components/admin-panels';
import { Banner, Panel } from '@/components/ui';

/**
 * IA-06 branding (§2.5, conflict C-04).
 *
 * One colour, four places. Everything semantic stays fixed: primary actions
 * remain Oxblood at every institution, Signal still means verified, Manila
 * still means "this is a record". A registry officer who works across two
 * universities must not have to relearn what a colour means.
 */
export default async function Branding() {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Branding</h1>
      <p className="t-body measure mt-2 mb-8 text-ink-700">
        Your colour appears in exactly four places: the mark beside your name in the header, the
        header band, the letterhead on admission letters and certificates, and your card on the
        platform listing.
      </p>

      <div className="grid gap-8 lg:grid-cols-[480px_1fr]">
        <Panel title="Your colour">
          <BrandingEditor
            brandColour={institution.brandColour}
            logoUrl={institution.logoUrl}
            institutionName={institution.name}
          />
        </Panel>

        <aside className="space-y-6">
          <Banner tone="info" title="What you cannot change, and why">
            <p>
              Buttons, status colours and the record surface are fixed across every institution on
              the platform. That is not a limitation of the tool — it is what lets one registry
              officer work across two universities without relearning the interface, and it is what
              keeps the accessibility guarantees true regardless of who configures what.
            </p>
          </Banner>

          <Panel title="Why a colour can be refused">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Your colour has to reach 4.5:1 against the page background to be readable as text.
              Below that it fails for anyone with low vision, and for everyone else on a phone
              outdoors.
            </p>
            <p className="t-body-sm m-0 text-ink-700">
              If yours falls short we suggest the nearest colour that passes — usually a slightly
              deeper version of the same hue, not a different colour.
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
