/**
 * RG-06 — writing a CSV that is safe to open.
 *
 * Two jobs. The ordinary one is quoting: a comma, a quote or a newline inside
 * a value has to survive the round trip. The one that matters is formula
 * injection. Every value in an applicant export was typed by an applicant,
 * and a spreadsheet treats a cell beginning with `=`, `+`, `-` or `@` as a
 * formula — so a candidate who enters `=HYPERLINK("http://…","Click")` as
 * their name gets code run on the registrar's machine the moment the export
 * is opened. Prefixing those cells with a single quote makes the spreadsheet
 * show the text instead of executing it (OWASP's CSV injection guidance).
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);

  if (FORMULA_START.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/**
 * A whole file. CRLF line endings and a UTF-8 byte order mark, because the
 * people opening this use Excel on Windows, and without the mark Excel reads
 * "Ọ̀ṣun" as mojibake.
 */
export function csvFile(header: string[], rows: unknown[][]): string {
  return '﻿' + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
