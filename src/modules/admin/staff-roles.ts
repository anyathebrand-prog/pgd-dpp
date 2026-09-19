/**
 * The roles IA-05 may grant, and what each one can actually do.
 *
 * A plain module rather than part of `staff.ts`: a `'use server'` file may
 * export only async functions, and both the actions and the page need this.
 *
 * The set is the least-privilege boundary from CMP-14 written down. What is
 * absent matters more than what is present:
 *
 * - `super_admin`, `dpo`, `curator` are platform roles. An institution admin
 *   who could grant one of those could grant themselves authority over every
 *   other university on the platform, which would make the tenant boundary a
 *   convention rather than a control.
 * - `candidate`, `student`, `alumni` are outcomes of the admissions pipeline.
 *   Granting one by hand produces a student with no application, no payment
 *   and no cohort behind them — a record that every downstream screen has to
 *   defend itself against.
 */
export const GRANTABLE = ['institution_admin', 'registry', 'facilitator'] as const;

export type GrantableRole = (typeof GRANTABLE)[number];

export const ROLE_COPY: Record<
  GrantableRole,
  { label: string; scope: string; mfa: boolean }
> = {
  institution_admin: {
    label: 'Institution administrator',
    scope:
      'Everything in this console: fees, cohorts, branding, the payout account, and this page. Grant it sparingly — it includes the power to grant it again.',
    mfa: true,
  },
  registry: {
    label: 'Registry officer',
    scope:
      'Applications, admission decisions, offers, enrolment and graduation. Reads candidates’ documents and identity records, which is the most sensitive data here.',
    mfa: true,
  },
  facilitator: {
    label: 'Facilitator',
    scope:
      'Their own modules: lessons, assessments, grading, announcements and live sessions. No access to applications, payments or other people’s cohorts.',
    mfa: false,
  },
};
