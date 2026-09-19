import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { getOrCreateApplication } from '@/modules/admissions/application';
import { saveStep } from '@/modules/admissions/actions';
import { ApplyShell } from '@/components/apply-shell';
import { ActionForm } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';

/** AP-03. */
export default async function EducationPage() {
  const me = await requireUser();
  const institution = await requireInstitution();
  const app = await getOrCreateApplication(institution.id, me.userId);
  const v = (app?.education ?? {}) as Record<string, string>;

  return (
    <ApplyShell
      stepKey="education"
      title="Education history"
      intro="Your first degree is what the registry assesses. Add a second qualification only if it is relevant."
    >
      <ActionForm action={saveStep} submitLabel="Save and continue">
        <input type="hidden" name="step" value="education" />

        <Field label="Institution attended" name="institution" required>
          <Input id="institution" name="institution" defaultValue={v.institution ?? ''} required />
        </Field>

        <Field label="Degree awarded" name="degree" required helper="For example, LLB, BSc Computer Science.">
          <Input id="degree" name="degree" defaultValue={v.degree ?? ''} required />
        </Field>

        <Field label="Class of degree" name="classOfDegree" required>
          <Select id="classOfDegree" name="classOfDegree" defaultValue={v.classOfDegree ?? ''} required>
            <option value="">Choose one</option>
            <option value="first">First class</option>
            <option value="2:1">Second class upper</option>
            <option value="2:2">Second class lower</option>
            <option value="third">Third class</option>
            <option value="pass">Pass</option>
            <option value="hnd">HND</option>
          </Select>
        </Field>

        <Field label="Year of graduation" name="yearOfGraduation" required>
          <Input
            id="yearOfGraduation"
            name="yearOfGraduation"
            inputMode="numeric"
            pattern="[0-9]{4}"
            defaultValue={v.yearOfGraduation ?? ''}
            required
          />
        </Field>

        <h2 className="t-h4 mt-10 mb-6 text-ink-900">Further qualification (optional)</h2>

        <Field label="Institution" name="institution2">
          <Input id="institution2" name="institution2" defaultValue={v.institution2 ?? ''} />
        </Field>

        <Field label="Qualification" name="degree2">
          <Input id="degree2" name="degree2" defaultValue={v.degree2 ?? ''} />
        </Field>

        <Field label="Year" name="year2">
          <Input id="year2" name="year2" inputMode="numeric" pattern="[0-9]{4}" defaultValue={v.year2 ?? ''} />
        </Field>
      </ActionForm>
    </ApplyShell>
  );
}
