import { requireRole } from '@/lib/auth';
import { TopBar, Footer } from '@/components/shell';
import { ActionForm } from '@/components/form';
import { Banner, Panel } from '@/components/ui';
import {
  PASS_MARK,
  QUESTIONS,
  SECTIONS,
  TRAINING_VERSION,
  VALID_DAYS,
} from '@/modules/compliance/training';
import { submitTraining } from '@/modules/compliance/training-actions';
import { trainingFor } from '@/modules/compliance/training-status';

/**
 * CMP-17 — annual data protection training, `/security/training`.
 *
 * Four short sections and five situations. The questions are scenarios a
 * registrar or facilitator actually meets, because the point is the decision
 * in the moment, not the recall of a statute. The answer key never reaches
 * the browser: options are rendered, and grading happens on the server.
 */
export default async function Training({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; score?: string; missed?: string }>;
}) {
  const me = await requireRole(
    'registry',
    'institution_admin',
    'facilitator',
    'curator',
    'dpo',
    'super_admin',
  );
  const { result, score, missed } = await searchParams;
  const status = (await trainingFor([me.userId])).get(me.userId)!;
  const missedIds = new Set((missed ?? '').split(',').filter(Boolean));

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Data protection training</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          Once a year, for everyone who works on other people&apos;s records here. Ten minutes:
          four short sections, then five situations. Pass with {PASS_MARK} of {QUESTIONS.length}.
        </p>

        {result === 'passed' ? (
          <div className="mb-8">
            <Banner tone="verified" title="Passed">
              <p>
                {score} of {QUESTIONS.length}. You are trained for the next {VALID_DAYS} days, and
                it is on record.
              </p>
            </Banner>
          </div>
        ) : result === 'failed' ? (
          <div className="mb-8">
            <Banner tone="danger" title="Not passed this time">
              <p>
                {score} of {QUESTIONS.length}. The situations you missed are marked below. Reread
                the section they come from and try again; every attempt is kept on record.
              </p>
            </Banner>
          </div>
        ) : status.status === 'valid' ? (
          <div className="mb-8">
            <Banner tone="verified" title="You are up to date">
              <p>
                Valid until{' '}
                {status.expiresAt?.toLocaleDateString('en-NG', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                . You can take it again at any time.
              </p>
            </Banner>
          </div>
        ) : status.status === 'due_soon' ? (
          <div className="mb-8">
            <Banner tone="warning" title="Due within the month">
              <p>
                Your training expires on{' '}
                {status.expiresAt?.toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}.
              </p>
            </Banner>
          </div>
        ) : (
          <div className="mb-8">
            <Banner tone="warning" title={status.status === 'never' ? 'Not yet taken' : 'Needs renewing'}>
              <p>
                {status.status === 'outdated'
                  ? 'The training has changed since you last passed it, so that pass no longer counts.'
                  : status.status === 'expired'
                    ? 'Your last pass is more than a year old.'
                    : 'You have not taken it yet.'}
              </p>
            </Banner>
          </div>
        )}

        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <Panel key={section.title} title={section.title}>
              <p className="t-body-sm measure m-0 text-ink-700">{section.body}</p>
            </Panel>
          ))}
        </div>

        <h2 className="t-h2 mt-12 mb-6 text-ink-900">Five situations</h2>
        <ActionForm action={submitTraining} submitLabel="Submit my answers">
          <ol className="m-0 grid list-none gap-8 p-0">
            {QUESTIONS.map((q, i) => (
              <li key={q.id}>
                <fieldset className="m-0 border-0 p-0">
                  <legend className="t-body m-0 mb-3 font-semibold text-ink-900">
                    {i + 1}. {q.prompt}
                  </legend>
                  {missedIds.has(q.id) ? (
                    <p className="t-body-sm mt-0 mb-3 font-semibold text-danger">
                      <span aria-hidden="true">▲ </span>
                      Missed last time.
                    </p>
                  ) : null}
                  <div className="grid gap-2">
                    {q.options.map((option, value) => (
                      <label
                        key={value}
                        htmlFor={`${q.id}-${value}`}
                        className="t-body-sm flex items-start gap-3 text-ink-900"
                      >
                        <input
                          id={`${q.id}-${value}`}
                          type="radio"
                          name={q.id}
                          value={value}
                          required
                          className="mt-1 h-4 w-4 shrink-0"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
        </ActionForm>

        <p className="t-caption mt-8 mb-0 text-ink-700">Training version {TRAINING_VERSION}.</p>
      </main>
      <Footer />
    </>
  );
}
