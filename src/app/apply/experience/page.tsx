import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { getOrCreateApplication } from '@/modules/admissions/application';
import { saveStep } from '@/modules/admissions/actions';
import { ApplyShell } from '@/components/apply-shell';
import { ActionForm } from '@/components/form';
import { Field, Input, Select, Textarea } from '@/components/ui';

/** AP-04. */
export default async function ExperiencePage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  const v = (app?.experience ?? {}) as Record<string, string>;

  return (
    <ApplyShell
      stepKey="experience"
      title="Work and sponsor"
      intro="None of this blocks a decision. It helps the registry place you and tells us who is paying."
    >
      <ActionForm action={saveStep} submitLabel="Save and continue">
        <input type="hidden" name="step" value="experience" />

        <Field label="Current employer" name="employer">
          <Input id="employer" name="employer" defaultValue={v.employer ?? ''} />
        </Field>

        <Field label="Current role" name="role">
          <Input id="role" name="role" defaultValue={v.role ?? ''} />
        </Field>

        <Field label="Years of relevant experience" name="years">
          <Input id="years" name="years" inputMode="numeric" defaultValue={v.years ?? ''} />
        </Field>

        <Field
          label="Why this programme"
          name="statement"
          helper="A few sentences. The registry reads this when a decision is close."
        >
          <Textarea id="statement" name="statement" defaultValue={v.statement ?? ''} rows={6} />
        </Field>

        <h2 className="t-h4 mt-10 mb-6 text-ink-900">Who is paying</h2>

        <Field label="Sponsor" name="sponsorType" required>
          <Select id="sponsorType" name="sponsorType" defaultValue={v.sponsorType ?? 'self'} required>
            <option value="self">I am paying for myself</option>
            <option value="employer">My employer</option>
            <option value="family">A family member</option>
            <option value="other">Another sponsor</option>
          </Select>
        </Field>

        <Field
          label="Sponsor name and contact"
          name="sponsorContact"
          helper="Leave blank if you are paying for yourself."
        >
          <Input id="sponsorContact" name="sponsorContact" defaultValue={v.sponsorContact ?? ''} />
        </Field>
      </ActionForm>
    </ApplyShell>
  );
}
