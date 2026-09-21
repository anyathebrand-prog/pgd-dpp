/**
 * RG-06 — the export has to be safe to open, not just parse.
 *
 * Every value in an applicant CSV was typed by an applicant. A spreadsheet
 * runs a cell starting with = + - or @ as a formula, so the escaping here is
 * the difference between a report and code executed on a registrar's machine.
 */
import { describe, expect, it } from 'vitest';
import { csvCell, csvFile, csvRow } from '@/lib/csv';

describe('quoting', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Adaeze Okonkwo')).toBe('Adaeze Okonkwo');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('Okonkwo, Adaeze')).toBe('"Okonkwo, Adaeze"');
  });

  it('doubles quotes inside a quoted value', () => {
    expect(csvCell('The "consent" question')).toBe('"The ""consent"" question"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('writes nothing for an absent value', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes a date as an unambiguous timestamp', () => {
    expect(csvCell(new Date('2026-09-01T09:00:00Z'))).toBe('2026-09-01T09:00:00.000Z');
  });
});

describe('formula injection', () => {
  it.each([
    ['=HYPERLINK("http://evil.example","Click")'],
    ['+2+3'],
    ['-2+3'],
    ['@SUM(A1:A2)'],
    ['\t=1+1'],
  ])('neutralises %s so the spreadsheet shows it rather than runs it', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
  });

  it('still quotes a neutralised value that contains a comma', () => {
    // Both jobs at once: the prefix goes inside the quotes.
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });

  it('does not touch a value that only contains those characters later', () => {
    // A hyphenated surname is not a formula.
    expect(csvCell('Adeyemi-Bello')).toBe('Adeyemi-Bello');
    expect(csvCell('a@example.ng')).toBe('a@example.ng');
  });
});

describe('the file', () => {
  it('joins cells with commas and rows with CRLF, with a byte order mark', () => {
    const file = csvFile(['name', 'email'], [['A', 'a@example.ng']]);
    expect(file.startsWith('﻿')).toBe(true);
    expect(file).toBe('﻿name,email\r\nA,a@example.ng\r\n');
  });

  it('escapes every cell in a row', () => {
    expect(csvRow(['=bad', 'ok, fine'])).toBe(`'=bad,"ok, fine"`);
  });
});
