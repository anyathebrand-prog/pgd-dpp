import 'server-only';

/**
 * LIB-09 — bulk ingestion for the initial corpus.
 *
 * §5.7 is explicit that the target is 300–500 curated items rather than
 * 50,000 scraped files, so this is a way to get a catalogue *in*, not a
 * crawler. It produces drafts and nothing else: CU-02 makes licence and
 * provenance blocking for publication, and a bulk path that could publish
 * would be a way around the one rule the library has.
 *
 * Hand-rolled CSV, for the usual reason — the format is small and the
 * alternative is a dependency that parses attacker-supplied text. What it
 * must get right is quoting: a Nigerian case citation contains commas
 * ("Incorporated Trustees v NIMC (2021) FHC/ABJ/CS/1145, per Ojukwu J"), and
 * a parser that splits on every comma silently shifts every column after it.
 */

export type Row = Record<string, string>;

export type IngestProblem = { line: number; problem: string };

export type IngestPlan = {
  rows: { line: number; values: Row }[];
  problems: IngestProblem[];
};

/**
 * A CSV reader that understands quoted fields, doubled quotes inside them,
 * and newlines inside them.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline is not an empty final record.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r') {
      // Windows line endings: the \n that follows does the work.
      continue;
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
      started = true;
    }
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Column names as a curator would type them, mapped to what the code uses. */
const COLUMNS: Record<string, string> = {
  title: 'title',
  citation: 'citation',
  authors: 'authors',
  jurisdiction: 'jurisdiction',
  type: 'instrumentType',
  'instrument type': 'instrumentType',
  instrumenttype: 'instrumentType',
  court: 'court',
  year: 'year',
  abstract: 'abstract',
  url: 'externalUrl',
  'external url': 'externalUrl',
  externalurl: 'externalUrl',
  source: 'sourceAttribution',
  'source attribution': 'sourceAttribution',
  sourceattribution: 'sourceAttribution',
  licence: 'licence',
  license: 'licence',
  subjects: 'subjectAreas',
  'subject areas': 'subjectAreas',
};

export const REQUIRED_COLUMNS = ['title', 'source', 'licence'];

/**
 * Turn a pasted sheet into rows to create and problems to show, with the line
 * number against each.
 *
 * Nothing is written from here. A curator sees what would happen, including
 * every row that would be refused and why, before anything is created — which
 * matters more for a hundred rows at once than for one item at a time.
 */
export function planIngest(csv: string, licenceCodes: string[]): IngestPlan {
  const table = parseCsv(csv.trim());
  if (table.length === 0) {
    return { rows: [], problems: [{ line: 0, problem: 'There is nothing to read here.' }] };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const mapped = header.map((h) => COLUMNS[h] ?? null);

  const problems: IngestProblem[] = [];

  for (const required of REQUIRED_COLUMNS) {
    const key = COLUMNS[required];
    if (!mapped.includes(key)) {
      problems.push({
        line: 1,
        problem: `The sheet has no “${required}” column. Every item needs a title, a source and a licence — those three are what makes it publishable at all.`,
      });
    }
  }
  if (problems.length > 0) return { rows: [], problems };

  const unknown = header.filter((h) => !COLUMNS[h] && h !== '');
  if (unknown.length > 0) {
    problems.push({
      line: 1,
      problem: `Ignoring ${unknown.length === 1 ? 'a column' : 'columns'} this catalogue has no field for: ${unknown.join(', ')}.`,
    });
  }

  const rows: { line: number; values: Row }[] = [];
  const seenTitles = new Set<string>();

  for (let i = 1; i < table.length; i++) {
    // +1 because a curator counts the header as line 1.
    const line = i + 1;
    const cells = table[i];

    if (cells.every((c) => c.trim() === '')) continue;

    const values: Row = {};
    mapped.forEach((key, column) => {
      if (key) values[key] = (cells[column] ?? '').trim();
    });

    if (!values.title) {
      problems.push({ line, problem: 'No title.' });
      continue;
    }
    if (!values.sourceAttribution) {
      problems.push({
        line: line,
        problem: `“${values.title}” has no source. §5.7 makes provenance mandatory, so it cannot be brought in without one.`,
      });
      continue;
    }
    if (!values.licence) {
      problems.push({ line, problem: `“${values.title}” has no licence.` });
      continue;
    }
    if (!licenceCodes.includes(values.licence.toUpperCase())) {
      problems.push({
        line,
        problem: `“${values.licence}” is not a licence this platform holds. Use one of: ${licenceCodes.join(', ')}.`,
      });
      continue;
    }
    if (values.year && !/^\d{4}$/.test(values.year)) {
      problems.push({ line, problem: `“${values.year}” is not a four-digit year.` });
      continue;
    }
    if (values.externalUrl && !/^https?:\/\//i.test(values.externalUrl)) {
      problems.push({
        line,
        problem: `The URL for “${values.title}” has to start with http:// or https://.`,
      });
      continue;
    }

    // Within the sheet itself. A duplicate against the catalogue is the
    // curator's to judge, but the same title twice in one paste is a mistake
    // in the paste.
    const fingerprint = `${values.title.toLowerCase()}|${(values.citation ?? '').toLowerCase()}`;
    if (seenTitles.has(fingerprint)) {
      problems.push({ line, problem: `“${values.title}” appears twice in this sheet.` });
      continue;
    }
    seenTitles.add(fingerprint);

    rows.push({ line, values });
  }

  return { rows, problems };
}

/** Subject areas arrive as a semicolon list, since commas are the delimiter. */
export function subjectsOf(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
