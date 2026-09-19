import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { certificates, enrollments } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution, platformUrl } from '@/lib/tenant';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { DataString, EmptyState, Record, Seal } from '@/components/ui';

/** ST-12 certificates (LRN-08). */
export default async function Certificates() {
  const me = await requireUser();
  const institution = await requireInstitution();

  const rows = await withTenant(institution.id, (tx) =>
    tx
      .select({ cert: certificates })
      .from(certificates)
      .innerJoin(enrollments, eq(enrollments.id, certificates.enrollmentId))
      .where(eq(enrollments.userId, me.userId)),
  );

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Certificates</h1>
        <p className="t-body mt-3 mb-8 text-ink-700">
          Each certificate carries a verification code. Anyone can check it without an account and
          without seeing anything else about you.
        </p>

        {rows.length === 0 ? (
          <EmptyState heading="No certificate yet">
            Your certificate of completion is issued by {institution.shortName} once you have
            completed the programme.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {rows.map(({ cert }) => (
              <Record
                as="li"
                key={cert.id}
                title={cert.programmeTitle}
                meta={`Issued ${cert.issuedAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`}
              >
                <div className="flex flex-wrap items-center gap-6">
                  <Seal label="Verified certificate" onPaper={false} />
                  <div>
                    <p className="t-caption m-0 text-ink-700">Verification code</p>
                    <p className="t-data-lg m-0 select-all text-ink-900">
                      <DataString value={cert.verificationCode} size="lg" label="Verification code" />
                    </p>
                    <p className="t-caption mt-2 mb-0 text-ink-700">
                      Check it at {platformUrl(`/verify/${cert.verificationCode}`)}
                    </p>
                    <p className="t-body-sm mt-3 mb-0">
                      <Link
                        href={`/certificates/${encodeURIComponent(cert.verificationCode)}`}
                        className="text-ink-900 underline underline-offset-2"
                      >
                        Open the certificate
                      </Link>
                    </p>
                  </div>
                </div>
              </Record>
            ))}
          </ul>
        )}
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
