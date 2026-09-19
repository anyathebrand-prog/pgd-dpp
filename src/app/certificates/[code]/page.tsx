import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { certificates, enrollments } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution, platformUrl } from '@/lib/tenant';
import { Banner, DataString, LinkButton, Seal } from '@/components/ui';

/**
 * ST-12, the certificate itself (LRN-08).
 *
 * The list page shows that a certificate exists; this is the document. It is
 * what the PDF is rendered from, so it carries no navigation of its own and
 * everything screen-only is `print:hidden`.
 *
 * The verification code is the load-bearing element, not the seal. A printed
 * certificate is a claim; the code is what turns it into something an
 * employer can check in ten seconds without an account, which is the entire
 * argument for issuing it here rather than as an emailed PDF.
 */
export default async function CertificateDocument({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .select({ cert: certificates, enrolment: enrollments })
      .from(certificates)
      .innerJoin(enrollments, eq(enrollments.id, certificates.enrollmentId))
      .where(
        and(
          eq(certificates.verificationCode, decodeURIComponent(code)),
          // Scoped to the holder. The public route for anyone else is /verify,
          // which discloses only that the certificate is valid and who issued
          // it — never the document.
          eq(enrollments.userId, me.userId),
        ),
      )
      .limit(1),
  );
  if (!row) notFound();

  const { cert, enrolment } = row;

  return (
    <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
      <p className="t-body-sm m-0 print:hidden">
        <Link href="/certificates" className="text-ink-700 underline underline-offset-2">
          Back to your certificates
        </Link>
      </p>

      {cert.revokedAt ? (
        <div className="mt-6 print:hidden">
          <Banner tone="danger" title="This certificate has been revoked">
            <p>
              It was withdrawn on {cert.revokedAt.toLocaleDateString('en-NG')} and verification
              will show it as invalid. Contact {institution.shortName} if you believe that is an
              error.
            </p>
          </Banner>
        </div>
      ) : null}

      <article className="mt-6 rounded-md bg-record p-8">
        <div
          className="mb-6 h-1 w-24"
          style={{ background: 'var(--tenant-brand)' }}
          aria-hidden="true"
        />
        <p className="t-label m-0 text-ink-900">{institution.name}</p>
        <p className="t-caption mt-1 mb-10 text-ink-700">
          {institution.city ? `${institution.city}, Nigeria` : 'Nigeria'}
        </p>

        <h1 className="t-read-h m-0 text-ink-900">Certificate of completion</h1>

        <div className="t-read measure-read mt-8 text-ink-900">
          <p className="mt-0">This is to certify that</p>
          <p className="t-read-h my-4 text-ink-900">{cert.holderName}</p>
          <p>
            has completed the {cert.programmeTitle} at {institution.name}, under matriculation
            number {enrolment.matricNumber}.
          </p>
          <p className="mb-0">
            Issued{' '}
            {cert.issuedAt.toLocaleDateString('en-NG', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            .
          </p>
        </div>

        <div className="mt-10 border-t border-ink-700/25 pt-6">
          <div className="flex flex-wrap items-center gap-6">
            {/* Manila, so the seal takes no Signal ring — Signal on Manila is
                2.44:1 and fails even the non-text threshold (§2.4). */}
            <Seal label="Verified certificate" onPaper={false} />
            <div>
              <p className="t-caption m-0 text-ink-700">Verification code</p>
              <p className="t-data-lg m-0 select-all text-ink-900">
                <DataString value={cert.verificationCode} size="lg" label="Verification code" />
              </p>
              <p className="t-caption mt-2 mb-0 text-ink-700">
                Anyone can check this at {platformUrl(`/verify/${cert.verificationCode}`)} without
                an account, and will see only that it is valid and who issued it.
              </p>
            </div>
          </div>
        </div>
      </article>

      <div className="mt-10 flex flex-wrap items-center gap-4 print:hidden">
        <LinkButton href={`/api/pdf/certificate/${encodeURIComponent(cert.verificationCode)}`}>
          Download as PDF
        </LinkButton>
        <Link
          href={platformUrl(`/verify/${cert.verificationCode}`)}
          className="t-body-sm self-center text-ink-700 underline underline-offset-2"
        >
          See what an employer sees
        </Link>
      </div>
    </main>
  );
}
