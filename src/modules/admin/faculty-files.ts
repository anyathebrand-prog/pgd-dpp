/**
 * The files a faculty application carries: a CV, and academic and
 * professional certificates. The rules live here, apart from the action, so
 * they are tested alone.
 *
 * Everything is judged by its bytes, never by its name or the browser's
 * claimed type. A CV is a document (PDF or .docx); a certificate is often a
 * phone photograph or a scan, so it may also be a JPG or PNG.
 */

export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const CERTS_MAX_EACH_KIND = 5;
/** The whole submission; next.config's action body limit sits just above it. */
export const APPLICATION_MAX_BYTES = 24 * 1024 * 1024;

export type FileKind = 'pdf' | 'docx' | 'jpg' | 'png';

export function sniffKind(head: Uint8Array): FileKind | null {
  const b = (i: number) => head[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46 && b(4) === 0x2d) return 'pdf';
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return 'docx';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'png';
  return null;
}

export const CONTENT_TYPE: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const ALLOWED = {
  cv: ['pdf', 'docx'] as FileKind[],
  certificate: ['pdf', 'jpg', 'png'] as FileKind[],
};

/** The problem with one file, in words, or null. */
export function fileProblem(
  file: { name: string; size: number },
  head: Uint8Array,
  role: 'cv' | 'certificate',
): string | null {
  if (file.size === 0) return `${file.name || 'A file'} is empty. Choose it again.`;
  if (file.size > FILE_MAX_BYTES) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB; each file may be up to 5MB. Save it smaller, or scan at a lower resolution.`;
  }
  const kind = sniffKind(head);
  if (!kind || !ALLOWED[role].includes(kind)) {
    return role === 'cv'
      ? `${file.name}: attach your CV as a PDF or a Word (.docx) file.`
      : `${file.name}: certificates must be PDF, JPG or PNG.`;
  }
  return null;
}
