/**
 * The files on a faculty application: judged by their bytes, per role.
 */
import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES, fileProblem, sniffKind } from '@/modules/admin/faculty-files';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

describe('sniffing', () => {
  it('knows the four formats and nothing else', () => {
    expect([PDF, DOCX, JPG, PNG, EXE].map(sniffKind)).toEqual(['pdf', 'docx', 'jpg', 'png', null]);
  });
});

describe('a CV', () => {
  it('may be a PDF or a .docx', () => {
    expect(fileProblem({ name: 'cv.pdf', size: 100 }, PDF, 'cv')).toBeNull();
    expect(fileProblem({ name: 'cv.docx', size: 100 }, DOCX, 'cv')).toBeNull();
  });
  it('may not be a photograph', () => {
    expect(fileProblem({ name: 'cv.jpg', size: 100 }, JPG, 'cv')).toMatch(/PDF or a Word/);
  });
});

describe('a certificate', () => {
  it('may be a PDF, or a scan or photograph as JPG or PNG', () => {
    for (const head of [PDF, JPG, PNG]) {
      expect(fileProblem({ name: 'cert', size: 100 }, head, 'certificate')).toBeNull();
    }
  });
  it('may not be a Word file or a program', () => {
    expect(fileProblem({ name: 'cert.docx', size: 100 }, DOCX, 'certificate')).toMatch(/PDF, JPG or PNG/);
    expect(fileProblem({ name: 'cert.pdf', size: 100 }, EXE, 'certificate')).toMatch(/PDF, JPG or PNG/);
  });
});

describe('size', () => {
  it('refuses empty and oversized files, naming them', () => {
    expect(fileProblem({ name: 'blank.pdf', size: 0 }, PDF, 'cv')).toMatch(/blank\.pdf is empty/);
    expect(fileProblem({ name: 'huge.pdf', size: FILE_MAX_BYTES + 1 }, PDF, 'certificate')).toMatch(/huge\.pdf is 5\.0MB/);
  });
});
