/**
 * AU-10 — affiliations, landings, and the decision straight after sign-in.
 */
import { describe, expect, it } from 'vitest';
import { afterLogin, affiliationsOf, homeFor, roleLabel } from '@/modules/auth/affiliations';

const A = 'inst-a';
const B = 'inst-b';

describe('affiliations', () => {
  it('groups roles by institution', () => {
    expect(
      affiliationsOf([
        { institutionId: A, role: 'registry' },
        { institutionId: A, role: 'student' },
        { institutionId: B, role: 'candidate' },
      ]),
    ).toEqual([
      { institutionId: A, roles: ['registry', 'student'] },
      { institutionId: B, roles: ['candidate'] },
    ]);
  });

  it('does not count platform roles as belonging to a school', () => {
    expect(affiliationsOf([{ institutionId: A, role: 'dpo' }, { institutionId: B, role: 'curator' }])).toEqual([]);
  });
});

describe('landing', () => {
  it('sends the most senior role to its console', () => {
    expect(homeFor(['student', 'registry'])).toBe('/admin');
    expect(homeFor(['facilitator', 'student'])).toBe('/teach');
    expect(homeFor(['student'])).toBe('/dashboard');
    expect(homeFor(['alumni'])).toBe('/alumni');
    expect(homeFor(['candidate'])).toBe('/apply');
  });

  it('describes a card in the same order', () => {
    expect(roleLabel(['candidate', 'facilitator'])).toBe('Facilitator · Applicant');
  });
});

describe('after sign-in', () => {
  const two = [
    { institutionId: A, roles: ['student' as const] },
    { institutionId: B, roles: ['candidate' as const] },
  ];

  it('stays put with one affiliation or none', () => {
    expect(afterLogin([two[0]], null, A)).toEqual({ kind: 'stay' });
    expect(afterLogin([], null, A)).toEqual({ kind: 'stay' });
  });

  it('asks when there are two and no default', () => {
    expect(afterLogin(two, null, A)).toEqual({ kind: 'choose' });
  });

  it('follows the default, here or elsewhere', () => {
    expect(afterLogin(two, A, A)).toEqual({ kind: 'stay' });
    expect(afterLogin(two, B, A)).toEqual({ kind: 'switch', institutionId: B });
  });

  it('ignores a default the person no longer belongs to', () => {
    expect(afterLogin(two, 'inst-gone', A)).toEqual({ kind: 'choose' });
  });
});
