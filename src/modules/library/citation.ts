/**
 * RES-05 — citation export.
 *
 * A pure function on the metadata, deliberately: this is the one piece of the
 * Resource Centre that a student will paste into something they are marked
 * on, and it has to be right whether it is rendered on a page, copied to a
 * clipboard, or exported in bulk later.
 *
 * It is also honest about its limits. These are formatted citations, not a
 * reference manager: APA and Harvard have edge cases for institutional
 * authors, multiple editions and unpublished work that this does not attempt.
 * What it produces is correct for the shapes this corpus actually holds —
 * legislation, guidance, judgments and papers — and a student who needs an
 * exotic form has the fields in front of them to fix it by hand.
 */

export type Citable = {
  title: string;
  authors?: string | null;
  year?: number | null;
  citation?: string | null;
  court?: string | null;
  jurisdiction?: string | null;
  instrumentType?: string | null;
  externalUrl?: string | null;
  id: string;
};

/**
 * "Okonkwo, A. and Bello, C." → "Okonkwo, A., & Bello, C."
 *
 * Split on "and", "&" and semicolons only — never on a bare comma. The comma
 * in "Okonkwo, A." separates a surname from an initial, and splitting there
 * turns two authors into four people with one-letter names. Which is exactly
 * what the first version of this did.
 */
function apaAuthors(authors: string | null | undefined) {
  if (!authors?.trim()) return null;
  const list = authors
    // Word boundaries matter: without them "Alexander" splits into "Alex"
    // and "er".
    .split(/\s*(?:;|\band\b|&)\s*/i)
    .map((name) => name.trim().replace(/,$/, ''))
    .filter(Boolean);
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`;
}

export function apa(item: Citable) {
  const parts: string[] = [];
  const authors = apaAuthors(item.authors);
  parts.push(authors ?? item.jurisdiction ?? 'Anon.');
  parts.push(`(${item.year ?? 'n.d.'}).`);
  parts.push(`${item.title}.`);
  if (item.court) parts.push(`${item.court}.`);
  else if (item.citation) parts.push(`${item.citation}.`);
  if (item.externalUrl) parts.push(item.externalUrl);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function harvard(item: Citable) {
  const parts: string[] = [];
  parts.push(item.authors?.trim() || item.jurisdiction || 'Anon.');
  parts.push(`(${item.year ?? 'n.d.'})`);
  parts.push(`${item.title}.`);
  if (item.court) parts.push(`${item.court}.`);
  else if (item.citation) parts.push(`${item.citation}.`);
  if (item.externalUrl) parts.push(`Available at: ${item.externalUrl}`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function bibtex(item: Citable) {
  // The key is derived from the data rather than from the row id: a student
  // pasting two of these into one document needs keys they can tell apart.
  const surname = (item.authors?.split(/[\s,;]+/)[0] || item.jurisdiction || 'anon')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const firstWord = item.title.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `${surname}${item.year ?? ''}${firstWord}`;

  // Legislation and judgments are not @article. Getting this wrong is the
  // thing a marker notices first.
  const type =
    item.instrumentType && /act|regulation|directive|guidance/i.test(item.instrumentType)
      ? 'misc'
      : item.court
        ? 'misc'
        : 'article';

  const fields: [string, string | null | undefined][] = [
    ['title', item.title],
    ['author', item.authors],
    ['year', item.year ? String(item.year) : null],
    ['note', item.citation ?? item.court],
    ['howpublished', item.jurisdiction],
    ['url', item.externalUrl],
  ];

  const body = fields
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `  ${name} = {${String(value).replace(/[{}]/g, '')}},`)
    .join('\n');

  return `@${type}{${key},\n${body}\n}`;
}

export function citations(item: Citable) {
  return { apa: apa(item), harvard: harvard(item), bibtex: bibtex(item) };
}
