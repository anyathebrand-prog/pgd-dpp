/**
 * ST-07 — file-upload assignments (LRN-04).
 *
 * The rules, kept apart from the page and the action so they can be tested
 * without a browser: what a file must be, and which of the six states the
 * flow names a student is in.
 */

/** Same ceiling as APP-04, and for the same reason: the server action body limit is 6MB. */
export const MAX_ASSIGNMENT_BYTES = 5 * 1024 * 1024;

export const ASSIGNMENT_FORMATS = [
  { label: 'PDF', type: 'application/pdf', ext: 'pdf' },
  {
    label: 'Word (.docx)',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
] as const;

/**
 * Checked against the bytes, not the browser's claimed type: a `.exe` renamed
 * `essay.pdf` arrives with `application/pdf` attached, and the facilitator is
 * the one who opens it. PDF starts `%PDF-`; a .docx is a zip, `PK\x03\x04`.
 */
export function sniffFormat(head: Uint8Array): 'pdf' | 'docx' | null {
  const b = (i: number) => head[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return 'pdf';
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return 'docx';
  return null;
}

export function assignmentFileProblem(file: { name: string; size: number }, head: Uint8Array) {
  if (file.size === 0) return 'That file is empty. Choose the file again.';
  if (file.size > MAX_ASSIGNMENT_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB. Save the PDF at a smaller size, or remove large images from the document.`;
  }
  const sniffed = sniffFormat(head);
  const ext = file.name.toLowerCase().split('.').pop();
  if (!sniffed || sniffed !== ext) {
    return 'Upload a PDF or a Word (.docx) file. Other formats, including older .doc files, cannot be accepted.';
  }
  return null;
}

export type AssignmentState = 'not_started' | 'draft' | 'submitted' | 'late' | 'returned' | 'graded';

/**
 * The state the flow names, read from the student's one submission row.
 *
 * A revision in progress stays `returned` until it is sent: the facilitator's
 * note is what the student is working to, and it should stay on screen until
 * they have answered it.
 */
export function assignmentState(
  row: { status: string; fileObjectKey: string | null; late: boolean } | null,
): AssignmentState {
  if (!row) return 'not_started';
  if (row.status === 'graded') return 'graded';
  if (row.status === 'returned') return 'returned';
  if (row.status === 'submitted') return row.late ? 'late' : 'submitted';
  return row.fileObjectKey ? 'draft' : 'not_started';
}

/** Late is decided once, at the moment of submission, so a deadline moved afterwards cannot rewrite it. */
export function isLate(closesAt: Date | null, at: Date) {
  return closesAt !== null && at.getTime() > closesAt.getTime();
}

export function canChange(state: AssignmentState) {
  return state === 'not_started' || state === 'draft' || state === 'returned';
}
