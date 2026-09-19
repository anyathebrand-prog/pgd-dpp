/**
 * What a directory entry is made of.
 *
 * A plain module, not the actions one: a 'use server' file may export only
 * async functions, and a constant exported from one is a build-time error
 * that surfaces as a 500 at the first click.
 */

/** The three facts a directory entry cannot exist without. */
export const ALWAYS_SHOWN = ['Name', 'Institution', 'Cohort year'] as const;

/** Everything else is the alumnus's to grant, one field at a time (AL-03). */
export const OPTIONAL_FIELDS = [
  { key: 'currentRole', label: 'Current role' },
  { key: 'employer', label: 'Employer' },
  { key: 'specialisation', label: 'Specialisation' },
  { key: 'location', label: 'Location' },
  { key: 'linkedinUrl', label: 'LinkedIn' },
] as const;
