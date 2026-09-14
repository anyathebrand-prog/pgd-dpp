'use client';

import { useActionState } from 'react';
import { Banner, Button, Field, Input } from './ui';
import type { ActionState } from './form';
import { saveAlumniProfile } from '@/modules/alumni/actions';

/**
 * AL-03 — the profile, and the visibility of each field in it.
 *
 * The shape of this form is the argument. Every optional field sits beside
 * its own "show this" checkbox, unticked by default, so opting into the
 * directory is never a bargain where finding a classmate costs you your
 * employer's name. CMP-15 calls this privacy by default; in practice it is
 * the difference between a directory people use and one they avoid.
 */
export function AlumniProfileForm({
  profile,
  fields,
}: {
  profile: {
    currentRole: string;
    employer: string;
    specialisation: string;
    location: string;
    linkedinUrl: string;
    directoryVisible: boolean;
    visibleFields: string[];
  };
  fields: { key: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveAlumniProfile,
    undefined,
  );

  const values: Record<string, string> = {
    currentRole: profile.currentRole,
    employer: profile.employer,
    specialisation: profile.specialisation,
    location: profile.location,
    linkedinUrl: profile.linkedinUrl,
  };

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-6">
          <Banner tone="danger" title="Not saved">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-6">
          <Banner tone="verified" title="Saved">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <div className="mb-8 rounded-md bg-record p-5">
        <label className="t-body-sm flex items-start gap-3 text-ink-900">
          <input
            type="checkbox"
            name="directoryVisible"
            defaultChecked={profile.directoryVisible}
            className="mt-0.5 h-6 w-6 shrink-0 accent-[#6B2436]"
          />
          <span>
            <strong className="block">List me in the alumni directory</strong>
            Other alumni across every participating university can find you. Your name, institution
            and cohort year appear; everything else below appears only if you tick it. Turning this
            off removes you immediately.
          </span>
        </label>
      </div>

      {fields.map((field) => (
        <div key={field.key} className="mb-6 border-b border-ink-300 pb-6 last:border-0">
          <Field label={field.label} name={field.key} inputId={`alumni-${field.key}`}>
            <Input
              id={`alumni-${field.key}`}
              name={field.key}
              defaultValue={values[field.key] ?? ''}
              placeholder={field.key === 'linkedinUrl' ? 'https://www.linkedin.com/in/…' : undefined}
            />
          </Field>
          <label className="t-body-sm flex items-center gap-3 text-ink-900">
            <input
              type="checkbox"
              name={`show_${field.key}`}
              defaultChecked={profile.visibleFields.includes(field.key)}
              className="h-6 w-6 accent-[#6B2436]"
            />
            Show {field.label.toLowerCase()} to other alumni
          </label>
        </div>
      ))}

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : 'Save my profile'}
      </Button>
    </form>
  );
}
