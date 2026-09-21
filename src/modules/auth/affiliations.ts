/**
 * AU-10 — one human, one account, possibly two institutions (SSO-04).
 *
 * The rules, apart from the routes: what counts as an affiliation, where each
 * one lands, and what happens straight after signing in.
 */

type Role =
  | 'candidate'
  | 'student'
  | 'alumni'
  | 'facilitator'
  | 'registry'
  | 'institution_admin'
  | 'curator'
  | 'super_admin'
  | 'dpo';

/**
 * Platform roles are not affiliations. The DPO and the curator work across
 * every institution by definition, so listing each tenant as a place they
 * "belong" would put the whole platform in their chooser.
 */
const PLATFORM_ONLY: Role[] = ['dpo', 'super_admin', 'curator'];

export type Affiliation = { institutionId: string; roles: Role[] };

export function affiliationsOf(memberships: { institutionId: string; role: string }[]): Affiliation[] {
  const byInstitution = new Map<string, Role[]>();
  for (const m of memberships) {
    if (PLATFORM_ONLY.includes(m.role as Role)) continue;
    const roles = byInstitution.get(m.institutionId) ?? [];
    if (!roles.includes(m.role as Role)) roles.push(m.role as Role);
    byInstitution.set(m.institutionId, roles);
  }
  return [...byInstitution.entries()].map(([institutionId, roles]) => ({ institutionId, roles }));
}

/**
 * Where an affiliation lands. The most senior role wins: a registrar who is
 * also doing the diploma at the same school is working when they sign in.
 */
export function homeFor(roles: string[]) {
  if (roles.includes('institution_admin') || roles.includes('registry')) return '/admin';
  if (roles.includes('facilitator')) return '/teach';
  if (roles.includes('student')) return '/dashboard';
  if (roles.includes('alumni')) return '/alumni';
  return '/apply';
}

/** How an affiliation is described on its card, in the order that matters. */
export function roleLabel(roles: string[]) {
  const labels: [string, string][] = [
    ['institution_admin', 'Administrator'],
    ['registry', 'Registry'],
    ['facilitator', 'Facilitator'],
    ['student', 'Student'],
    ['alumni', 'Alumnus'],
    ['candidate', 'Applicant'],
  ];
  return labels.filter(([r]) => roles.includes(r)).map(([, l]) => l).join(' · ');
}

export type AfterLogin =
  | { kind: 'stay' }
  | { kind: 'choose' }
  | { kind: 'switch'; institutionId: string };

/**
 * After a password sign-in at `hereId`.
 *
 * One affiliation, or none (a platform role signing in anywhere): stay. A
 * default that is still an affiliation: go there, which is here or a switch.
 * Otherwise ask. A default pointing at an institution the person no longer
 * belongs to is ignored rather than obeyed.
 */
export function afterLogin(
  affiliations: Affiliation[],
  defaultId: string | null,
  hereId: string,
): AfterLogin {
  if (affiliations.length <= 1) return { kind: 'stay' };
  if (defaultId && affiliations.some((a) => a.institutionId === defaultId)) {
    return defaultId === hereId ? { kind: 'stay' } : { kind: 'switch', institutionId: defaultId };
  }
  return { kind: 'choose' };
}
