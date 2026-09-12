'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Select, Textarea } from './ui';
import type { ActionState } from './form';
import { issueDecision, raiseDocumentQuery } from '@/modules/admissions/registry-actions';
import { REQUIRED_DOCUMENTS } from '@/modules/admissions/constants';

/** RG-03. */
export function QueryPanel({ applicationId }: { applicationId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    raiseDocumentQuery,
    undefined,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />

      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not sent">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-4">
          <Banner tone="info">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Which document" name="documentKind" required>
        <Select id="documentKind" name="documentKind" required>
          {REQUIRED_DOCUMENTS.map((d) => (
            <option key={d.kind} value={d.kind}>
              {d.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="What is wrong with it"
        name="note"
        required
        helper="The candidate sees this word for word, so say what to do — not just what is wrong."
      >
        <Textarea id="note" name="note" required rows={4} />
      </Field>

      <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending' : 'Send query to candidate'}
      </Button>
    </form>
  );
}

/**
 * RG-04.
 *
 * §5.6: modals are for irreversible decisions, with the consequence stated in
 * the body and the verb repeated on the button. Issuing a decision is
 * irreversible from the candidate's side — they are emailed the moment it is
 * recorded — so the confirmation step is not optional politeness.
 */
export function DecisionPanel({
  applicationId,
  seatsRemaining,
}: {
  applicationId: string;
  seatsRemaining: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    issueDecision,
    undefined,
  );
  const router = useRouter();
  const [decision, setDecision] = useState('admitted');

  // Same reason as ActionForm: an action driven by useActionState cannot
  // redirect server-side, so it hands back a destination instead.
  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);
  const [confirming, setConfirming] = useState(false);

  const consequence = {
    admitted:
      'The candidate is emailed an offer, a seat is held for them, and the offer countdown starts. A held seat is unavailable to anyone else until it lapses.',
    rejected:
      'The candidate is emailed the decision and your reason. Their uploaded documents are scheduled for deletion 180 days from now.',
    waitlisted:
      'The candidate is told they are on the waiting list. No seat is held and no countdown starts.',
  }[decision];

  return (
    <form action={formAction}>
      <input type="hidden" name="applicationId" value={applicationId} />

      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not recorded">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Decision" name="decision" required>
        <Select
          id="decision"
          name="decision"
          required
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value);
            setConfirming(false);
          }}
        >
          <option value="admitted" disabled={seatsRemaining <= 0}>
            Admit{seatsRemaining <= 0 ? ' — cohort is full' : ''}
          </option>
          <option value="waitlisted">Waitlist</option>
          <option value="rejected">Reject</option>
        </Select>
      </Field>

      <Field
        label="Note on the record"
        name="note"
        required={decision === 'rejected'}
        helper={
          decision === 'rejected'
            ? 'Required. The candidate is shown this, and an appeal will ask for it.'
            : 'Optional. Kept on the application, not shown to the candidate unless you reject.'
        }
      >
        <Textarea id="note" name="note" rows={3} required={decision === 'rejected'} />
      </Field>

      {confirming ? (
        <>
          <div className="mb-4">
            <Banner tone="warning" title="This cannot be undone from here">
              <p>{consequence}</p>
            </Banner>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              size="dense"
              variant={decision === 'rejected' ? 'danger' : 'primary'}
              disabled={pending}
              aria-busy={pending}
            >
              {pending
                ? 'Recording'
                : decision === 'admitted'
                  ? 'Admit this candidate'
                  : decision === 'rejected'
                    ? 'Reject this application'
                    : 'Waitlist this candidate'}
            </Button>
            <Button type="button" size="dense" variant="tertiary" onClick={() => setConfirming(false)}>
              Go back
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" size="dense" onClick={() => setConfirming(true)}>
          Review this decision
        </Button>
      )}
    </form>
  );
}
