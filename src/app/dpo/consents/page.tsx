import Link from 'next/link';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { consentRecords, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { EmptyState, Panel, StaffBand, cx } from '@/components/ui';

/**
 * DP-06 consent records — `app./dpo/consents` (CMP-06).
 *
 * Read-only, deliberately. A consent is the data subject's to give and to
 * withdraw, from their own account; a DPO able to edit one here would make
 * every record on this page worthless as evidence, because none of them could
 * be shown to be the person's own choice.
 *
 * What the page is for is the question an auditor asks: for this purpose,
 * who agreed, to what wording, under which notice, and when. So each row
 * carries the notice version and the exact text that was shown — stored
 * verbatim at the time, not re-derived from today's notice.
 */
const PURPOSES = {
  application_processing: 'Processing the application',
  post_programme_retention: 'Keeping records after the programme',
  alumni_directory: 'Listing in the alumni directory',
  marketing: 'Marketing',
} as const;

type Purpose = keyof typeof PURPOSES;

export default async function Consents({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string; granted?: string }>;
}) {
  const me = await requireRole('dpo', 'super_admin');
  const { purpose, granted } = await searchParams;

  const filterPurpose = purpose && purpose in PURPOSES ? (purpose as Purpose) : null;
  const filterGranted = granted === 'yes' ? true : granted === 'no' ? false : null;

  // The standing picture: for each purpose, how many people's most recent
  // decision is yes and how many is no. A withdrawal supersedes the grant
  // before it, so counting every row would count the same person twice.
  // Column references rather than names typed into the string: `recordedAt`
  // is stored as `created_at`, and a hand-written name here is exactly how
  // this query first failed.
  const standing = await db.execute<{ purpose: string; granted: boolean; n: number }>(sql`
    SELECT purpose, granted, count(*)::int AS n FROM (
      SELECT DISTINCT ON (${consentRecords.userId}, ${consentRecords.purpose})
        ${consentRecords.purpose} AS purpose, ${consentRecords.granted} AS granted
      FROM ${consentRecords}
      ORDER BY ${consentRecords.userId}, ${consentRecords.purpose}, ${consentRecords.recordedAt} DESC
    ) latest
    GROUP BY purpose, granted
  `);
  const tally = (p: string, g: boolean) =>
    Number(
      (standing as unknown as { purpose: string; granted: boolean; n: number }[]).find(
        (r) => r.purpose === p && r.granted === g,
      )?.n ?? 0,
    );

  const conditions = [];
  if (filterPurpose) conditions.push(eq(consentRecords.purpose, filterPurpose));
  if (filterGranted !== null) conditions.push(eq(consentRecords.granted, filterGranted));

  const rows = await db
    .select({ record: consentRecords, email: users.email })
    .from(consentRecords)
    .innerJoin(users, eq(users.id, consentRecords.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(consentRecords.recordedAt))
    .limit(200);

  const [{ total }] = await db.select({ total: count() }).from(consentRecords);

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform, Data Protection Officer" role={me.roles.join(', ')} />
      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-caption m-0">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Data protection
          </Link>
        </p>
        <h1 className="t-h1 mt-2 mb-2 text-ink-900">Consent records</h1>
        <p className="t-body measure mt-0 mb-8 text-ink-700">
          {total} decisions recorded. Each carries the notice version and the exact wording the
          person saw. Nothing here can be edited: a consent is the data subject&apos;s to give and
          to withdraw, and a record a DPO could change would prove nothing.
        </p>

        <div className="mb-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PURPOSES) as Purpose[]).map((p) => (
            <Panel key={p} title={PURPOSES[p]}>
              <dl className="m-0 grid grid-cols-2 gap-y-1">
                <dt className="t-caption m-0 text-ink-700">Agreed</dt>
                <dd className="t-data m-0 ml-0 text-right text-ink-900">{tally(p, true)}</dd>
                <dt className="t-caption m-0 text-ink-700">Declined or withdrawn</dt>
                <dd className="t-data m-0 ml-0 text-right text-ink-900">{tally(p, false)}</dd>
              </dl>
              <p className="t-caption mt-3 mb-0 text-ink-700">Each person&apos;s latest decision.</p>
            </Panel>
          ))}
        </div>

        <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="c-purpose" className="t-label mb-2 block text-ink-900">
              Purpose
            </label>
            <select
              id="c-purpose"
              name="purpose"
              defaultValue={filterPurpose ?? ''}
              className="h-10 rounded-sm border border-ink-500 bg-surface px-3 text-ink-900"
            >
              <option value="">All</option>
              {(Object.keys(PURPOSES) as Purpose[]).map((p) => (
                <option key={p} value={p}>
                  {PURPOSES[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="c-granted" className="t-label mb-2 block text-ink-900">
              Decision
            </label>
            <select
              id="c-granted"
              name="granted"
              defaultValue={granted ?? ''}
              className="h-10 rounded-sm border border-ink-500 bg-surface px-3 text-ink-900"
            >
              <option value="">Either</option>
              <option value="yes">Agreed</option>
              <option value="no">Declined or withdrawn</option>
            </select>
          </div>
          <button type="submit" className="t-body-sm h-10 text-ink-900 underline underline-offset-2">
            Filter
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState heading="No records match">Try a different purpose or decision.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Consent decisions, most recent first</caption>
              <thead>
                <tr className="border-b border-ink-500">
                  {['When', 'Person', 'Purpose', 'Decision', 'Notice', 'Wording shown'].map((h) => (
                    <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ record, email }, i) => (
                  <tr
                    key={record.id}
                    className={cx('border-b border-ink-300 align-top', i % 2 === 1 && 'bg-ink-100/40')}
                  >
                    <td className="t-data px-3 py-3 text-ink-700">
                      {record.recordedAt.toLocaleString('en-NG')}
                    </td>
                    <td className="t-body-sm px-3 py-3 text-ink-900">{email}</td>
                    <td className="t-body-sm px-3 py-3 text-ink-900">
                      {PURPOSES[record.purpose as Purpose] ?? record.purpose}
                    </td>
                    <td className="t-body-sm px-3 py-3 text-ink-900">
                      {record.granted ? 'Agreed' : 'Declined'}
                    </td>
                    <td className="t-data px-3 py-3 text-ink-700">v{record.noticeVersion}</td>
                    <td className="t-body-sm max-w-[40ch] px-3 py-3 text-ink-700">
                      {record.purposeTextShown}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
