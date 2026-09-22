import Link from 'next/link';
import { db } from '@/db';
import { retentionRules } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { retentionPicture } from '@/modules/compliance/dsr';
import { Banner, DataString, EmptyState, Panel, StaffBand, cx } from '@/components/ui';

/**
 * DP-07 retention and purge report (CMP-10).
 *
 * This is the control surface for the PRD's stated dominant risk: rejected
 * applicants' documents accumulating unpurged. They outnumber admitted
 * students and nobody remembers to delete them, so the report leads with what
 * has gone wrong rather than with a reassuring total.
 *
 * A failed purge and a purge that never ran are shown separately: the first
 * means the object store refused us, the second means the job is not running
 * at all. They need different responses.
 */
export default async function RetentionReport() {
  const me = await requireRole('dpo', 'super_admin');
  const picture = await retentionPicture();
  const rules = await db.select().from(retentionRules);

  const overdueCount = picture.failed.length + picture.neverAttempted.length;

  return (
    <div className="min-h-screen">
      <StaffBand institution="Platform" role="dpo" />

      <main id="main" className="mx-auto max-w-[1600px] px-8 py-8">
        <p className="t-body-sm m-0">
          <Link href="/dpo" className="text-ink-700 underline underline-offset-2">
            Back to the console
          </Link>
        </p>

        <h1 className="t-h1 mt-4 text-ink-900">Retention and purge</h1>
        <p className="t-body measure mt-2 mb-6 text-ink-700">
          Deletion is verified before it is recorded — the object store has to confirm the file is
          gone before the row is marked purged. A schedule that marks things deleted without
          checking produces confident evidence of something that did not happen.
        </p>

        {picture.failed.length > 0 ? (
          <div className="mb-4">
            <Banner tone="danger" title="Purge attempted and failed">
              <p>
                {picture.failed.length} {picture.failed.length === 1 ? 'file' : 'files'} could not
                be deleted. They are past their retention date and still exist. Fix the cause and
                re-run the purge job — failures are retried, not skipped.
              </p>
            </Banner>
          </div>
        ) : null}

        {picture.neverAttempted.length > 0 ? (
          <div className="mb-4">
            <Banner tone="danger" title="Overdue, with no purge attempted">
              <p>
                {picture.neverAttempted.length}{' '}
                {picture.neverAttempted.length === 1 ? 'file is' : 'files are'} past the deletion
                date and the job has not tried. That points at the scheduler rather than at
                storage — check the worker is running.
              </p>
            </Banner>
          </div>
        ) : null}

        {overdueCount === 0 ? (
          <div className="mb-4">
            <Banner tone="verified" title="Nothing overdue">
              <p>Every file past its retention date has been deleted, and each deletion confirmed.</p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Panel title="Deleted to date">
            <p className="t-h1 m-0 text-ink-900">{picture.purgedTotal}</p>
            <p className="t-body-sm mt-1 mb-0 text-ink-700">Files destroyed on schedule</p>
          </Panel>
          <Panel title="Scheduled">
            <p className="t-h1 m-0 text-ink-900">{picture.scheduledTotal}</p>
            <p className="t-body-sm mt-1 mb-0 text-ink-700">Held, with a deletion date set</p>
          </Panel>
          <Panel title="Overdue">
            <p className={cx('t-h1 m-0', overdueCount > 0 ? 'text-danger' : 'text-ink-500')}>
              {overdueCount}
            </p>
            <p className="t-body-sm mt-1 mb-0 text-ink-700">Past the date and still present</p>
          </Panel>
        </div>

        {overdueCount > 0 ? (
          <>
            <h2 className="t-h2 mt-12 mb-4 text-ink-900">What is overdue</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Documents past their deletion date</caption>
                <thead>
                  <tr className="border-b border-ink-500">
                    {['Institution', 'Document', 'Due', 'Attempted', 'Why it failed'].map((h) => (
                      <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...picture.failed, ...picture.neverAttempted].map((d, i) => (
                    <tr
                      key={d.id}
                      className={cx(
                        'border-b border-ink-300 border-l-[3px] border-l-danger',
                        i % 2 === 1 && 'bg-ink-100/40',
                      )}
                    >
                      <td className="t-body-sm px-3 py-3 text-ink-900">{d.institution}</td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">
                        {d.kind.replace(/_/g, ' ')}
                      </td>
                      <td className="t-data px-3 py-3 text-ink-900">
                        <DataString
                          value={d.purgeAfter?.toISOString().slice(0, 10) ?? '—'}
                          label="Due"
                        />
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-700">
                        {d.purgeAttemptedAt ? d.purgeAttemptedAt.toLocaleString('en-NG') : 'Never'}
                      </td>
                      <td className="t-body-sm px-3 py-3 text-ink-900">
                        {d.purgeError ?? 'The purge job has not run against this file.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <h2 className="t-h2 mt-12 mb-4 text-ink-900">The schedule</h2>
        {rules.length === 0 ? (
          <EmptyState heading="No retention rules are defined">
            Without rules nothing is ever scheduled for deletion, which is the failure mode CMP-10
            exists to prevent.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Retention rules and when each last ran</caption>
              <thead>
                <tr className="border-b border-ink-500">
                  {['Data class', 'Applies when', 'Retained', 'Basis', 'Last run', 'Deleted'].map(
                    (h) => (
                      <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id} className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}>
                    <td className="t-body-sm px-3 py-3 text-ink-900">{r.entity}</td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">{r.condition}</td>
                    <td className="t-data px-3 py-3 text-ink-900">{r.retainDays}d</td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">{r.basis}</td>
                    <td
                      className={cx(
                        't-body-sm px-3 py-3',
                        r.lastRunAt ? 'text-ink-700' : 'text-warning',
                      )}
                    >
                      {r.lastRunAt ? r.lastRunAt.toLocaleDateString('en-NG') : 'Never'}
                    </td>
                    <td className="t-data px-3 py-3 text-ink-900">{r.lastPurgedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="t-caption measure mt-8 text-ink-700">
          §6.8 also requires deletions to propagate to backups as those expire. Backups are kept 30
          days, so a deletion is only complete once that window has passed — a deletion that lives
          forever in a backup is not a deletion.
        </p>
      </main>
    </div>
  );
}
