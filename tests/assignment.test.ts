/**
 * ST-07 — what an assignment file must be, and which state a student is in.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ASSIGNMENT_BYTES,
  assignmentFileProblem,
  assignmentState,
  canChange,
  isLate,
  sniffFormat,
} from '@/modules/learning/assignment';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

describe('file checks', () => {
  it('reads the format from the bytes', () => {
    expect(sniffFormat(PDF)).toBe('pdf');
    expect(sniffFormat(ZIP)).toBe('docx');
    expect(sniffFormat(EXE)).toBeNull();
  });

  it('accepts a PDF and a .docx', () => {
    expect(assignmentFileProblem({ name: 'Essay.PDF', size: 1000 }, PDF)).toBeNull();
    expect(assignmentFileProblem({ name: 'essay.docx', size: 1000 }, ZIP)).toBeNull();
  });

  it('refuses an executable renamed to .pdf', () => {
    expect(assignmentFileProblem({ name: 'essay.pdf', size: 1000 }, EXE)).toMatch(/PDF or a Word/);
  });

  it('refuses a mismatch between name and contents', () => {
    // A zip named .pdf is not a PDF, whatever the browser claims.
    expect(assignmentFileProblem({ name: 'essay.pdf', size: 1000 }, ZIP)).toMatch(/PDF or a Word/);
  });

  it('refuses empty and oversized files, in words', () => {
    expect(assignmentFileProblem({ name: 'a.pdf', size: 0 }, PDF)).toMatch(/empty/);
    expect(assignmentFileProblem({ name: 'a.pdf', size: MAX_ASSIGNMENT_BYTES + 1 }, PDF)).toMatch(/limit is 5MB/);
  });
});

describe('states', () => {
  const row = (status: string, fileObjectKey: string | null = null, late = false) => ({
    status,
    fileObjectKey,
    late,
  });

  it('names all six', () => {
    expect(assignmentState(null)).toBe('not_started');
    expect(assignmentState(row('in_progress'))).toBe('not_started');
    expect(assignmentState(row('in_progress', 'k'))).toBe('draft');
    expect(assignmentState(row('submitted', 'k'))).toBe('submitted');
    expect(assignmentState(row('submitted', 'k', true))).toBe('late');
    expect(assignmentState(row('returned', 'k'))).toBe('returned');
    expect(assignmentState(row('graded', 'k'))).toBe('graded');
  });

  it('allows changes only before submission or after a return', () => {
    expect(['not_started', 'draft', 'returned'].every((s) => canChange(s as never))).toBe(true);
    expect(['submitted', 'late', 'graded'].some((s) => canChange(s as never))).toBe(false);
  });

  it('decides lateness against the deadline at the moment of submission', () => {
    const due = new Date('2026-10-01T23:59:00Z');
    expect(isLate(due, new Date('2026-10-01T23:58:00Z'))).toBe(false);
    expect(isLate(due, new Date('2026-10-02T00:00:00Z'))).toBe(true);
    expect(isLate(null, new Date())).toBe(false);
  });
});
