import Link from 'next/link';

/**
 * The PB-01 footer.
 *
 * The product's Footer is four links and the DPO's address, which is right for
 * a page someone is working in. A landing page is also where an institution's
 * procurement officer and a data subject arrive, and both of them are looking
 * for a specific column rather than a row of links.
 */
const COLUMNS: { heading: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    heading: 'The programme',
    links: [
      { href: '/programmes', label: 'Institutions and intakes' },
      { href: '/#study', label: 'What you study' },
      { href: '/#how', label: 'How it works' },
      { href: '/#faq', label: 'Questions and answers' },
    ],
  },
  {
    heading: 'Verification',
    links: [
      { href: '/verify', label: 'Verify a certificate' },
      { href: '/login', label: 'Log in' },
      { href: '/integrations', label: 'Connect a portal' },
    ],
  },
  {
    heading: 'Data protection',
    links: [
      { href: '/privacy', label: 'Privacy notice' },
      { href: '/trust', label: 'Trust and compliance' },
      { href: '/library/takedown', label: 'Report content' },
      { href: 'https://ndpc.gov.ng/', label: 'ndpc.gov.ng', external: true },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-ink-300 bg-[#050f2b] text-ink-900">
      <div className="mx-auto max-w-marketing px-4 py-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.3fr_repeat(3,1fr)]">
          <div>
            <span className="inline-flex rounded-md bg-ink-900 p-3">
              <img
                src="/brand/dph-logo-1200.png"
                alt="Data Protection Hub Limited: data privacy, risk management, compliance, training, advisory"
                width={1200}
                height={461}
                loading="lazy"
                className="h-auto w-full max-w-[280px]"
              />
            </span>
            <p className="t-body-sm measure mt-3 mb-0 text-ink-700">
              A Post Graduate Diploma in Data Protection &amp; Privacy, run by accredited Nigerian
              universities on one platform. Each university admits, teaches and awards; the platform
              handles admissions, payments, the library and verification.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="t-label m-0 mb-3">{column.heading}</h2>
              <ul className="m-0 list-none space-y-2 p-0">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        rel="noopener"
                        className="t-body-sm text-ink-700 underline underline-offset-2 hover:text-ink-900"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="t-body-sm text-ink-700 underline underline-offset-2 hover:text-ink-900"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-ink-300 pt-6">
          <p className="t-caption m-0 text-ink-700">
            Data Protection Officer: dpo@example.ng · Registered with the Nigeria Data Protection
            Commission · Personal data is processed under the Nigeria Data Protection Act 2023.
          </p>
        </div>
      </div>
    </footer>
  );
}
