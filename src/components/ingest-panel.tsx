'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Textarea } from './ui';
import type { ActionState } from './form';
import { checkIngest, runIngest } from '@/modules/library/ingest-actions';

/**
 * LIB-09 — the bulk ingest panel on CU-01.
 *
 * Deliberately two buttons. "Check the sheet" writes nothing and reports what
 * would happen, line by line; "Bring them in" does it. For a hundred rows at
 * once that separation is the difference between a mistake you can read and a
 * mistake you have to undo — and the first is a habit worth making easy.
 */
export function IngestPanel() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [checked, checkAction, checking] = useActionState<ActionState, FormData>(
    checkIngest,
    undefined,
  );
  const [ran, runAction, running] = useActionState<ActionState, FormData>(runIngest, undefined);

  useEffect(() => {
    if (ran?.redirectTo) router.push(ran.redirectTo);
  }, [ran?.redirectTo, router]);

  return (
    <div>
      <p className="t-body-sm mt-0 mb-4 text-ink-700">
        A sheet with a header row. <strong>Title</strong>, <strong>source</strong> and{' '}
        <strong>licence</strong> are required on every row — the three things that decide whether
        an item can be published at all. Also read: citation, authors, jurisdiction, type, court,
        year, abstract, url, subjects.
      </p>
      <p className="t-caption mt-0 mb-4 text-ink-700">
        Licence is a code: NG-GOV, PUBLIC-RECORD or LINK-ONLY. Subjects are separated by
        semicolons, since commas separate the columns. Everything arrives as a draft.
      </p>

      {checked?.error || ran?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Nothing brought in">
            <p>{checked?.error ?? ran?.error}</p>
          </Banner>
        </div>
      ) : null}

      {checked?.notice ? (
        <div className="mb-4">
          <Banner tone="info" title="This is what would happen">
            {/* Line numbers and reasons, verbatim — a summary would hide the
                one row that matters. */}
            <p className="whitespace-pre-line">{checked.notice}</p>
          </Banner>
        </div>
      ) : null}

      <form>
        <label htmlFor="ingest-csv" className="t-label mb-2 block text-ink-900">
          Paste the sheet
        </label>
        <Textarea
          id="ingest-csv"
          name="csv"
          rows={10}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={'title,citation,year,url,source,licence\nNigeria Data Protection Act 2023,Act No 37,2023,https://ndpc.gov.ng/,NDPC website,NG-GOV'}
          className="font-mono text-sm"
        />

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="submit"
            size="dense"
            variant="secondary"
            formAction={checkAction}
            disabled={checking || running}
            aria-busy={checking}
          >
            {checking ? 'Checking' : 'Check the sheet'}
          </Button>
          <Button
            type="submit"
            size="dense"
            formAction={runAction}
            disabled={checking || running}
            aria-busy={running}
          >
            {running ? 'Bringing them in' : 'Bring them in as drafts'}
          </Button>
        </div>
      </form>
    </div>
  );
}
