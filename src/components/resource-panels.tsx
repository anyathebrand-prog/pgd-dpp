'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Textarea } from './ui';
import type { ActionState } from './form';
import { decideSubmission, submitPaper, toggleBookmark } from '@/modules/library/reader-actions';

/** RES-06 — one reader's reading list, one item at a time. */
export function BookmarkButton({ itemId, saved }: { itemId: string; saved: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    toggleBookmark,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : saved ? 'Remove from reading list' : 'Save to reading list'}
      </Button>
      {state?.error ? (
        <p className="t-body-sm mt-2 mb-0 font-semibold text-danger">{state.error}</p>
      ) : null}
    </form>
  );
}

/**
 * RES-05 — the citation, in the three forms a Nigerian postgraduate is
 * actually asked for.
 *
 * Rendered rather than generated on demand: the text is already correct on
 * the server, and a copy button that produced something different from what
 * is on screen would be worse than no button. The textarea is selectable and
 * readable, which is what someone pasting into a dissertation needs.
 */
export function CitationBlock({
  citations,
}: {
  citations: { apa: string; harvard: string; bibtex: string };
}) {
  const [style, setStyle] = useState<keyof typeof citations>('apa');
  const [copied, setCopied] = useState(false);

  const labels = { apa: 'APA', harvard: 'Harvard', bibtex: 'BibTeX' } as const;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
          <Button
            key={key}
            type="button"
            size="dense"
            variant={style === key ? 'primary' : 'tertiary'}
            onClick={() => {
              setStyle(key);
              setCopied(false);
            }}
            aria-pressed={style === key}
          >
            {labels[key]}
          </Button>
        ))}
      </div>

      <label htmlFor="citation-text" className="sr-only">
        {labels[style]} citation
      </label>
      <textarea
        id="citation-text"
        readOnly
        value={citations[style]}
        rows={style === 'bibtex' ? 8 : 3}
        className="t-data block w-full rounded-sm border border-ink-300 bg-record p-3 text-ink-900"
      />

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="dense"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(citations[style]);
              setCopied(true);
            } catch {
              // Clipboard access can be refused, and a button that lies about
              // having copied is worse than one that admits it did not.
              setCopied(false);
            }
          }}
        >
          Copy
        </Button>
        <span className="t-caption text-ink-700" role="status" aria-live="polite">
          {copied ? 'Copied.' : 'Select the text if your browser blocks copying.'}
        </span>
      </div>
    </div>
  );
}

/** CU-03 — the curator's decision on a contributed paper. */
export function SubmissionDecision({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    decideSubmission,
    undefined,
  );

  /*
   * The outcome goes into the URL, not into this component.
   *
   * Either decision removes the paper from the queue, so a banner rendered
   * here unmounts with the row it was confirming and the curator sees
   * nothing happen at all. The page above renders it instead, and it
   * survives a reload — which is what someone does when they are unsure
   * whether a decision landed.
   */
  useEffect(() => {
    // A code, not the message: text taken from a query string and rendered
    // back into the page is a habit worth not having, and the page can say
    // it better than a string passed through a URL anyway. The action has
    // already revalidated, so the navigation brings fresh data with it.
    if (!state?.notice) return;
    const code = /Accepted/i.test(state.notice) ? 'accepted' : 'rejected';
    router.replace(`/curate/submissions?decided=${code}`);
  }, [state?.notice, router]);

  return (
    <div>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not recorded">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <form action={formAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="decision" value="accept" />
          <p className="t-body-sm mt-0 mb-3 text-ink-700">
            Accepting moves it into the curation queue as a draft. It is not published until its
            licence and provenance are recorded.
          </p>
          <Button type="submit" size="dense" disabled={pending}>
            Accept for curation
          </Button>
        </form>

        <form action={formAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="decision" value="reject" />
          <Field
            label="Or say why it is not right for the collection"
            name="reason"
            inputId={`reject-${itemId}`}
            helper="The contributor is told verbatim."
          >
            <Textarea id={`reject-${itemId}`} name="reason" rows={3} />
          </Field>
          <Button type="submit" size="dense" variant="secondary" disabled={pending}>
            Reject
          </Button>
        </form>
      </div>
    </div>
  );
}

/** RC-03 — the submission form, with the contributor licence that makes it lawful. */
export function SubmitPaperForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    submitPaper,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-6">
          <Banner tone="danger" title="Not submitted">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Title" name="title" inputId="paper-title" required>
        <Input id="paper-title" name="title" required />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-[2fr_1fr]">
        <Field
          label="Authors"
          name="authors"
          inputId="paper-authors"
          required
          helper="In the order they appear on the paper."
        >
          <Input id="paper-authors" name="authors" required />
        </Field>
        <Field label="Year" name="year" inputId="paper-year">
          <Input id="paper-year" name="year" inputMode="numeric" />
        </Field>
      </div>

      <Field
        label="Abstract"
        name="abstract"
        inputId="paper-abstract"
        required
        helper="A curator decides from this, and so does every reader afterwards."
      >
        <Textarea id="paper-abstract" name="abstract" rows={6} required />
      </Field>

      <Field
        label="The paper"
        name="file"
        inputId="paper-file"
        helper="PDF, up to 5MB. If it is published elsewhere and you cannot share the file, give the link instead."
      >
        <Input id="paper-file" name="file" type="file" accept="application/pdf" />
      </Field>

      <Field label="Or a link to it" name="externalUrl" inputId="paper-url">
        <Input id="paper-url" name="externalUrl" placeholder="https://doi.org/…" />
      </Field>

      {/*
        §5.7 permits faculty-authored works "with author licence". This is
        that licence, and it is why the form exists in this shape: without it
        there is no lawful basis for hosting the paper at all.
      */}
      <div className="mt-8 mb-6 rounded-md bg-record p-5">
        <h2 className="t-h4 m-0 mb-3 text-ink-900">Contributor licence</h2>
        <p className="t-body-sm mt-0 mb-4 text-ink-700">
          You keep the copyright. You are granting this platform a non-exclusive right to host the
          paper and make it available to students and alumni of the participating universities,
          with your name on it. You can withdraw it at any time, and it comes down.
        </p>
        <label className="t-body-sm flex items-start gap-3 text-ink-900">
          <input
            type="checkbox"
            name="declaration"
            className="mt-0.5 h-6 w-6 shrink-0 accent-[#6B2436]"
          />
          <span>
            I am an author of this paper, or authorised by the authors, and I grant that licence.
          </span>
        </label>
      </div>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Submitting' : 'Submit for review'}
      </Button>
    </form>
  );
}
