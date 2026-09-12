import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { readAcrossTenants } from '@/db';
import { certificates, institutions } from '@/db/schema';
import { Banner, DataString, Redacted, Seal } from '@/components/ui';

/**
 * PB-07 certificate verification (LRN-08).
 *
 * Public and unauthenticated, which makes data minimisation the design
 * constraint rather than an afterthought. A verifier needs to know that a named
 * person holds a valid credential from a named institution. They do not need
 * the holder's email, their matriculation number, their grades or their cohort
 * mates, so none of that is loaded or rendered — the redaction bars here are
 * functional, marking what is deliberately withheld rather than decorating.
 */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Cross-tenant by design: a verifier holds a code and nothing else, and
  // which institution issued it is part of the answer they came for.
  const [row] = await readAcrossTenants('certificate-verification', (tx) =>
    tx
      .select({
      holderName: certificates.holderName,
      programmeTitle: certificates.programmeTitle,
      kind: certificates.kind,
      issuedAt: certificates.issuedAt,
      revokedAt: certificates.revokedAt,
      verificationCode: certificates.verificationCode,
      institutionName: institutions.name,
    })
      .from(certificates)
      .innerJoin(institutions, eq(institutions.id, certificates.institutionId))
      .where(eq(certificates.verificationCode, code.toUpperCase()))
      .limit(1),
  );

  const valid = Boolean(row) && !row.revokedAt;

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <p className="t-label m-0 text-ink-700">Certificate verification</p>

      {valid ? (
        <>
          <div className="mt-6 flex items-start gap-6">
            <Seal label="Valid certificate" />
            <div>
              <h1 className="t-h1 m-0 text-ink-900">This certificate is valid</h1>
              <p className="t-body mt-3 text-ink-700">
                Issued by {row.institutionName} on{' '}
                {row.issuedAt.toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                .
              </p>
            </div>
          </div>

          <dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-6 gap-y-4">
            <dt className="t-body-sm text-ink-700">Holder</dt>
            <dd className="t-body m-0 text-ink-900">{row.holderName}</dd>

            <dt className="t-body-sm text-ink-700">Award</dt>
            <dd className="t-body m-0 text-ink-900">
              {row.kind === 'admission_letter' ? 'Offer of admission' : row.programmeTitle}
            </dd>

            <dt className="t-body-sm text-ink-700">Institution</dt>
            <dd className="t-body m-0 text-ink-900">{row.institutionName}</dd>

            <dt className="t-body-sm text-ink-700">Code</dt>
            <dd className="m-0">
              <DataString value={row.verificationCode} size="lg" label="Verification code" />
            </dd>

            <dt className="t-body-sm text-ink-700">Not shown</dt>
            <dd className="m-0">
              <Redacted label="Contact details, matriculation number and grades — held, not published" />
            </dd>
          </dl>

          <p className="t-caption mt-12 text-ink-700">
            This page confirms the existence and status of a credential. It deliberately shows
            nothing else about the holder.
          </p>
        </>
      ) : (
        <>
          <h1 className="t-h1 mt-6 text-ink-900">
            {row ? 'This certificate has been revoked' : 'No certificate matches that code'}
          </h1>
          <div className="mt-8">
            <Banner tone={row ? 'warning' : 'danger'} title={row ? 'Revoked' : 'Not found'}>
              <p>
                {row
                  ? `${row.institutionName} revoked this certificate on ${row.revokedAt?.toLocaleDateString('en-NG')}. Contact the institution before relying on a copy of it.`
                  : 'Check the code for transcription errors — the character set excludes O, 0, I and 1 to avoid exactly that. If it still does not match, treat the document as unverified.'}
              </p>
            </Banner>
          </div>
        </>
      )}

      <p className="t-body-sm mt-12">
        <Link href="/verify" className="text-ink-900 underline underline-offset-2">
          Check another code
        </Link>
      </p>
    </main>
  );
}
