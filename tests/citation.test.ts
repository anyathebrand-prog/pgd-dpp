/**
 * RES-05 — citation export.
 *
 * Worth a unit test rather than an E2E one: this is the piece of the product
 * a student pastes into work they are marked on, and it is pure. If the
 * formatting is wrong here it is wrong everywhere, and no amount of clicking
 * through the page would tell you which comma was in the wrong place.
 */
import { describe, expect, it } from 'vitest';
import { apa, bibtex, citations, harvard } from '@/modules/library/citation';

const paper = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  title: 'Consent under the NDPA 2023',
  authors: 'Okonkwo, A. and Bello, C.',
  year: 2025,
  citation: 'Nigerian Journal of Data Protection 4(2) 33',
  court: null,
  jurisdiction: 'Nigeria',
  instrumentType: 'article',
  externalUrl: 'https://doi.org/10.0000/njdp.2025.33',
};

const judgment = {
  id: 'b2c3d4e5-0000-0000-0000-000000000000',
  title: 'Incorporated Trustees of Laws and Rights v NIMC',
  authors: null,
  year: 2021,
  citation: 'FHC/ABJ/CS/1145/2021',
  court: 'Federal High Court, Abuja',
  jurisdiction: 'Nigeria',
  instrumentType: 'judgment',
  externalUrl: null,
};

describe('APA', () => {
  it('joins multiple authors with an ampersand, the way APA asks', () => {
    expect(apa(paper)).toBe(
      'Okonkwo, A., & Bello, C. (2025). Consent under the NDPA 2023. Nigerian Journal of Data Protection 4(2) 33. https://doi.org/10.0000/njdp.2025.33',
    );
  });

  it('falls back to the jurisdiction for an unauthored instrument', () => {
    // Legislation and judgments have no author, and "Anon." would be wrong
    // for a Federal High Court decision.
    expect(apa(judgment)).toContain('Nigeria (2021).');
    expect(apa(judgment)).toContain('Federal High Court, Abuja.');
  });

  it('says n.d. rather than inventing a year', () => {
    expect(apa({ ...paper, year: null })).toContain('(n.d.)');
  });
});

describe('Harvard', () => {
  it('keeps the authors as written and labels the link', () => {
    const out = harvard(paper);
    expect(out).toContain('Okonkwo, A. and Bello, C. (2025)');
    expect(out).toContain('Available at: https://doi.org/10.0000/njdp.2025.33');
  });

  it('prefers the court over the citation string for a judgment', () => {
    expect(harvard(judgment)).toContain('Federal High Court, Abuja.');
  });
});

describe('BibTeX', () => {
  it('builds a key a person can tell apart from another', () => {
    expect(bibtex(paper)).toMatch(/^@article\{okonkwo2025consent,/);
  });

  it('does not call a judgment an article', () => {
    // @article for a Federal High Court decision is the kind of thing a
    // marker notices immediately.
    expect(bibtex(judgment)).toMatch(/^@misc\{/);
  });

  it('does not call legislation an article either', () => {
    const act = { ...judgment, court: null, instrumentType: 'Act', title: 'Nigeria Data Protection Act' };
    expect(bibtex(act)).toMatch(/^@misc\{/);
  });

  it('strips braces that would break the entry', () => {
    const messy = { ...paper, title: 'Consent {and} the Act' };
    expect(bibtex(messy)).toContain('title = {Consent and the Act}');
  });

  it('omits fields it has nothing for rather than emitting empties', () => {
    const out = bibtex({ ...paper, externalUrl: null, citation: null, court: null });
    expect(out).not.toContain('url =');
    expect(out).not.toContain('note =');
  });
});

describe('all three together', () => {
  it('produces something for every style, for the sparsest possible item', () => {
    // A curator can publish an item with a title and a source and nothing
    // else. None of the three may throw on it.
    const bare = {
      id: 'c3d4e5f6-0000-0000-0000-000000000000',
      title: 'Untitled guidance note',
      authors: null,
      year: null,
      citation: null,
      court: null,
      jurisdiction: null,
      instrumentType: null,
      externalUrl: null,
    };
    const out = citations(bare);
    expect(out.apa).toContain('Untitled guidance note');
    expect(out.harvard).toContain('Anon.');
    expect(out.bibtex).toContain('Untitled guidance note');
  });
});
