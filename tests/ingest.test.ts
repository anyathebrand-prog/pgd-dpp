/**
 * LIB-09 — reading a curator's sheet.
 *
 * The parser is worth testing directly because its failure mode is silent: a
 * comma inside a quoted citation shifts every column after it, so a licence
 * lands in the court field and an item is created with the wrong provenance.
 * Nobody would see that on screen; they would see it a year later.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, planIngest, subjectsOf } from '@/modules/library/ingest';

const LICENCES = ['NG-GOV', 'PUBLIC-RECORD', 'LINK-ONLY'];
const header = 'title,citation,court,year,url,source,licence';

describe('reading the CSV itself', () => {
  it('reads a plain sheet', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // A real Nigerian citation. A parser that split on every comma would put
    // "per Ojukwu J" into the next column.
    const [, row] = parseCsv(
      `title,citation\nNIMC case,"Incorporated Trustees v NIMC (2021) FHC/ABJ/CS/1145, per Ojukwu J"`,
    );
    expect(row[1]).toBe('Incorporated Trustees v NIMC (2021) FHC/ABJ/CS/1145, per Ojukwu J');
  });

  it('understands a doubled quote inside a quoted field', () => {
    const [, row] = parseCsv(`title\n"The ""consent"" question"`);
    expect(row[0]).toBe('The "consent" question');
  });

  it('keeps a newline inside a quoted field', () => {
    const rows = parseCsv(`title,abstract\nA case,"First line\nSecond line"`);
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('First line\nSecond line');
  });

  it('handles Windows line endings', () => {
    // What a curator's spreadsheet actually exports on the machines this is
    // built on.
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a final empty record from a trailing newline', () => {
    expect(parseCsv('a\n1\n')).toHaveLength(2);
  });
});

describe('planning what would be created', () => {
  it('accepts a well-formed row', () => {
    const plan = planIngest(
      `${header}\nNDPA 2023,Act No 37,,2023,https://ndpc.gov.ng/act,NDPC website,NG-GOV`,
      LICENCES,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].values).toMatchObject({
      title: 'NDPA 2023',
      citation: 'Act No 37',
      year: '2023',
      sourceAttribution: 'NDPC website',
      licence: 'NG-GOV',
    });
  });

  it('refuses the whole sheet when a required column is missing', () => {
    // Not row by row: a sheet with no licence column is the wrong sheet, and
    // reporting it a hundred times would bury the one thing to fix.
    const plan = planIngest('title,citation\nA case,Some citation', LICENCES);
    expect(plan.rows).toEqual([]);
    // One per missing column — this sheet has neither source nor licence, and
    // naming both is what tells the curator what to add.
    expect(plan.problems).toHaveLength(2);
    const said = plan.problems.map((p) => p.problem).join(' ');
    expect(said).toMatch(/no “source” column/);
    expect(said).toMatch(/no “licence” column/);
  });

  it('names the line of every row it refuses, and keeps the rest', () => {
    const csv = [
      header,
      'Good one,C1,,2023,,A source,NG-GOV',
      ',C2,,2023,,A source,NG-GOV',
      'No source,C3,,2023,,,NG-GOV',
      'Bad licence,C4,,2023,,A source,MADE-UP',
      'Another good,C5,,2024,,A source,PUBLIC-RECORD',
    ].join('\n');
    const plan = planIngest(csv, LICENCES);

    expect(plan.rows.map((r) => r.values.title)).toEqual(['Good one', 'Another good']);
    // Line numbers count the header as line 1, the way a curator reads it.
    expect(plan.problems.map((p) => p.line)).toEqual([3, 4, 5]);
    expect(plan.problems[1].problem).toMatch(/provenance is mandatory|no source/i);
    expect(plan.problems[2].problem).toMatch(/not a licence this platform holds/);
  });

  it('refuses a year that is not a year, and a URL with no scheme', () => {
    const csv = [
      header,
      'Bad year,C1,,twenty twenty three,,A source,NG-GOV',
      'Bad url,C2,,2023,ndpc.gov.ng,A source,NG-GOV',
    ].join('\n');
    const plan = planIngest(csv, LICENCES);
    expect(plan.rows).toEqual([]);
    expect(plan.problems[0].problem).toMatch(/four-digit year/);
    expect(plan.problems[1].problem).toMatch(/http/);
  });

  it('catches the same item pasted twice', () => {
    const csv = [
      header,
      'NDPA 2023,Act 37,,2023,,A source,NG-GOV',
      'NDPA 2023,Act 37,,2023,,A source,NG-GOV',
    ].join('\n');
    const plan = planIngest(csv, LICENCES);
    expect(plan.rows).toHaveLength(1);
    expect(plan.problems[0].problem).toMatch(/appears twice/);
  });

  it('accepts the column names a curator would actually type', () => {
    const plan = planIngest(
      'Title,Source Attribution,License,External URL\nA case,A source,NG-GOV,https://example.ng',
      LICENCES,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.rows[0].values.externalUrl).toBe('https://example.ng');
  });

  it('says which columns it is ignoring rather than dropping them quietly', () => {
    const plan = planIngest(
      `${header},shelfmark\nA case,C1,,2023,,A source,NG-GOV,XYZ`,
      LICENCES,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.problems[0].problem).toMatch(/shelfmark/);
  });

  it('skips blank lines without reporting them', () => {
    const plan = planIngest(`${header}\n\nA case,C1,,2023,,A source,NG-GOV\n\n`, LICENCES);
    expect(plan.rows).toHaveLength(1);
    expect(plan.problems).toEqual([]);
  });
});

describe('subject areas', () => {
  it('splits on semicolons, because commas are the delimiter', () => {
    expect(subjectsOf('consent; enforcement ;transfers')).toEqual([
      'consent',
      'enforcement',
      'transfers',
    ]);
  });

  it('is empty when absent', () => {
    expect(subjectsOf(undefined)).toEqual([]);
    expect(subjectsOf('')).toEqual([]);
  });
});
