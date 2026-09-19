import 'server-only';
import type { Browser } from 'playwright-core';

/**
 * PDF rendering — §7.2, for PAY-07 receipts, APP-10 admission letters and
 * LRN-08 certificates.
 *
 * These three documents already exist as pages, laid out print-first and
 * carrying no navigation of their own. Rendering the same markup to PDF is
 * therefore a screenshot of the truth rather than a second implementation of
 * it: there is no way for the PDF of a receipt to disagree with the receipt,
 * because they are the same file.
 *
 * The alternative — building each document again with a PDF library — means
 * every change to a letter has to be made twice, and the two copies diverge
 * the first time someone is in a hurry. A certificate that says something
 * different from the page it was printed from is a forgery we produced
 * ourselves.
 *
 * Degradation is deliberate and visible. If no browser is available the
 * caller gets `null` and shows the reader a page they can print with their
 * own browser, rather than a download button that fails silently.
 */

let browserPromise: Promise<Browser> | null = null;

/**
 * One browser for the process, launched on first use.
 *
 * Chromium takes a second or two to start and perhaps 100MB of memory, so
 * launching one per request would make a receipt download feel broken under
 * any load at all. Contexts are per-request and disposable; the browser is
 * not.
 */
async function browser(): Promise<Browser | null> {
  if (process.env.PDF_RENDERING === 'off') return null;

  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core');
      return chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    })();
    // A failed launch must not be cached as a permanent failure: a missing
    // browser on a container that is later fixed should start working without
    // a redeploy.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }

  try {
    const instance = await browserPromise;
    return instance.isConnected() ? instance : ((browserPromise = null), null);
  } catch (error) {
    console.error('[pdf] chromium unavailable', error);
    return null;
  }
}

/**
 * Renders one of our own pages to PDF, as the person requesting it.
 *
 * The session cookie is forwarded so the headless browser sees exactly what
 * the reader would see — including being refused. A renderer that fetched
 * pages with elevated rights would be a way to read anyone's admission letter
 * by knowing its URL.
 */
export async function renderPagePdf(params: {
  path: string;
  origin: string;
  cookieHeader: string | null;
}): Promise<Buffer | null> {
  const instance = await browser();
  if (!instance) return null;

  const context = await instance.newContext();
  try {
    if (params.cookieHeader) {
      const url = new URL(params.origin);
      const cookies = params.cookieHeader
        .split(';')
        .map((part) => part.trim().split('='))
        .filter((pair) => pair.length >= 2)
        .map(([name, ...rest]) => ({
          name,
          value: rest.join('='),
          domain: url.hostname,
          path: '/',
        }));
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    // Print media is the only mechanism: the documents already hide their
    // screen-only tails with `print:hidden`, which is also what a reader gets
    // from their own browser's print dialog. A second switch here would be a
    // second definition of the same thing, and the two would drift.
    await page.emulateMedia({ media: 'print' });

    const response = await page.goto(new URL(params.path, params.origin).toString(), {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });

    // A redirect to /login means the cookie did not carry. Returning the login
    // page as a PDF would be worse than returning nothing.
    /*
     * The page that answered must be the page that was asked for.
     *
     * Everything this product does to refuse a reader is a redirect —
     * `requireUser` to /login, `requireRole` to /no-access, and an
     * unresolved tenant to the platform landing. A renderer that only
     * checked the status code would happily return those as PDFs: a
     * download button that silently hands someone a copy of the marketing
     * page, or worse, looks like it produced a document when it did not.
     */
    const landed = new URL(page.url()).pathname;
    const wanted = new URL(params.path, params.origin).pathname;
    if (!response || response.status() >= 400 || landed !== wanted) {
      return null;
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return Buffer.from(pdf);
  } catch (error) {
    console.error('[pdf] render failed', error);
    return null;
  } finally {
    await context.close();
  }
}

/** The one place the "we could not render it" answer is written. */
export function pdfUnavailable() {
  return new Response(
    JSON.stringify({
      error:
        'This document could not be rendered to PDF just now. Open the page and print it with your browser — it is laid out for exactly that.',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
}
