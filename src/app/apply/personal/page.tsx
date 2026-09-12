import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { getOrCreateApplication } from '@/modules/admissions/application';
import { saveStep } from '@/modules/admissions/actions';
import { ApplyShell } from '@/components/apply-shell';
import { ActionForm } from '@/components/form';
import { Field, Input, Select, Banner } from '@/components/ui';

/** AP-02. APP-02 field list. */
export default async function PersonalPage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  const v = (app?.personal ?? {}) as Record<string, string>;

  return (
    <ApplyShell
      stepKey="personal"
      title="Personal details"
      intro="This is saved as you go, so you can leave and come back. Nothing reaches the registry until you submit."
    >
      <ActionForm action={saveStep} submitLabel="Save and continue">
        <input type="hidden" name="step" value="personal" />

        <Field label="Full name" name="fullName" required helper="Exactly as it appears on your degree certificate.">
          <Input id="fullName" name="fullName" defaultValue={v.fullName ?? me.fullName ?? ''} required />
        </Field>

        <Field label="Date of birth" name="dob" required>
          <Input id="dob" name="dob" type="date" defaultValue={v.dob ?? ''} required />
        </Field>

        <Field label="Gender" name="gender" required>
          <Select id="gender" name="gender" defaultValue={v.gender ?? ''} required>
            <option value="">Choose one</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </Select>
        </Field>

        <Field label="Phone number" name="phone" required helper="Include the leading zero, for example 08012345678.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={v.phone ?? ''} required />
        </Field>

        <Field label="Residential address" name="address" required>
          <Input id="address" name="address" defaultValue={v.address ?? ''} required />
        </Field>

        <Field label="State of origin" name="stateOfOrigin" required>
          <Input id="stateOfOrigin" name="stateOfOrigin" defaultValue={v.stateOfOrigin ?? ''} required />
        </Field>

        <Field label="Nationality" name="nationality" required>
          <Input id="nationality" name="nationality" defaultValue={v.nationality ?? 'Nigerian'} required />
        </Field>

        <h2 className="t-h4 mt-10 mb-6 text-ink-900">Next of kin</h2>

        <Field label="Next of kin name" name="nokName" required>
          <Input id="nokName" name="nokName" defaultValue={v.nokName ?? ''} required />
        </Field>

        <Field label="Next of kin phone number" name="nokPhone" required>
          <Input id="nokPhone" name="nokPhone" type="tel" inputMode="tel" defaultValue={v.nokPhone ?? ''} required />
        </Field>

        {/*
          APP-02 raises NIN as a [DECISION]. It is high-risk data and nothing in
          the admissions process needs it, so it is not collected unless a
          specific university mandates it — at which point it becomes a
          tenant-configured field with its own lawful basis and its own line in
          the RoPA. Collecting it "in case" is precisely the habit this
          programme exists to correct.
        */}
        <Banner tone="info" title="We do not ask for your NIN">
          <p>
            Nothing in this application needs your National Identification Number, so we do not
            collect it. If your institution later requires it for registration, it will be asked for
            separately and you will be told why.
          </p>
        </Banner>
      </ActionForm>
    </ApplyShell>
  );
}
