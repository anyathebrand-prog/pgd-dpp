import { desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { privacyNotices } from '@/db/schema';
import { Footer, TopBar } from '@/components/shell';
import { Banner } from '@/components/ui';

/**
 * PB-06 privacy notice, versioned (CMP-05).
 *
 * Old versions stay readable at their own URL forever, because a consent
 * record points at a version number and that pointer is worthless if the text
 * it names has been edited underneath it.
 *
 * §3.1: a reading surface, so Literata at `read` in the 720px container.
 */
export default async function PrivacyNotice({
  params,
}: {
  params: Promise<{ version?: string[] }>;
}) {
  const { version } = await params;
  const requested = version?.[0]?.replace(/^v/, '');

  const [notice] = requested
    ? await db.select().from(privacyNotices).where(eq(privacyNotices.version, Number(requested))).limit(1)
    : await db.select().from(privacyNotices).orderBy(desc(privacyNotices.version)).limit(1);

  if (!notice) notFound();

  const [latest] = await db
    .select({ version: privacyNotices.version })
    .from(privacyNotices)
    .orderBy(desc(privacyNotices.version))
    .limit(1);

  const superseded = notice.version < (latest?.version ?? notice.version);

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-12">
        <p className="t-label m-0 text-ink-700">Version {notice.version}</p>
        <h1 className="t-read-h mt-3 text-ink-900">Privacy notice</h1>
        <p className="t-caption mt-2 text-ink-700">
          In force from{' '}
          {notice.effectiveFrom.toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>

        {superseded ? (
          <div className="mt-8">
            <Banner tone="info" title="This version has been superseded">
              <p>
                It is kept because consents recorded while it was in force point at it. Version{' '}
                {latest?.version} is the current one.
              </p>
            </Banner>
          </div>
        ) : null}

        <article className="t-read measure-read mt-10 whitespace-pre-line text-ink-900">
          {notice.body}
        </article>
      </main>
      <Footer />
    </>
  );
}
