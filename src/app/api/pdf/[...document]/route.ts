import { type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { currentInstitution, requestOrigin } from '@/lib/tenant';
import { pdfUnavailable, renderPagePdf } from '@/lib/pdf';

/**
 * PAY-07, APP-10, LRN-08 — the three documents this platform issues, as PDFs.
 *
 * Each is rendered from its own page by a headless browser (§7.2), as the
 * person asking, with their session cookie. That matters twice over: the
 * document cannot disagree with the page it came from, and the renderer
 * cannot fetch something the reader is not allowed to see. The page's own
 * access check is the access check.
 *
 * One route rather than three, because the difference between them is a path
 * and a filename.
 */

const DOCUMENTS: Record<string, { path: (id: string) => string; filename: (id: string) => string }> =
  {
    receipt: {
      path: (ref) => `/billing/receipt/${encodeURIComponent(ref)}`,
      filename: (ref) => `receipt-${ref}.pdf`,
    },
    letter: {
      path: () => '/apply/letter',
      filename: () => 'admission-letter.pdf',
    },
    certificate: {
      path: (code) => `/certificates/${encodeURIComponent(code)}`,
      filename: (code) => `certificate-${code}.pdf`,
    },
  };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ document: string[] }> },
) {
  const me = await requireUser();
  const institution = await currentInstitution();
  const [kind, id = ''] = (await params).document;

  const document = DOCUMENTS[kind];
  if (!document) return new Response('Not found', { status: 404 });

  // Host header, not nextUrl.origin — see requestOrigin. Rendering against
  // the internal origin produced a receipt PDF containing the marketing page.
  const origin = requestOrigin(request);
  const pdf = await renderPagePdf({
    path: document.path(id),
    origin,
    cookieHeader: request.headers.get('cookie'),
  });

  if (!pdf) return pdfUnavailable();

  // CMP-14. Issuing a document about a person is a processing event, and the
  // one question afterwards is always when a copy was produced and by whom.
  await audit({
    action: 'document.pdf_rendered',
    institutionId: institution?.id ?? null,
    actorId: me.userId,
    actorRole: 'self',
    subjectId: me.userId,
    entity: kind,
    entityId: id || undefined,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${document.filename(id)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
