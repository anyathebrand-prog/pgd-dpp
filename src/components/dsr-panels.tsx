'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Panel, Textarea } from './ui';
import type { ActionState } from './form';
import {
  fulfilRequest,
  refuseRequest,
  routeToInstitution,
  verifyIdentity,
} from '@/modules/compliance/actions';

/**
 * DP-03 action panels.
 *
 * Ordered as the work is done: verify, route, then close. Fulfilment stays
 * disabled until identity is verified — §6.6 requires the check before
 * anything is released, and a disabled control with the reason beside it is
 * clearer than one that fails after the fact.
 */
function useNav(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);
}

export function DsrPanels({
  requestId,
  kind,
  closed,
  identityVerified,
  identityNote,
  hasInstitution,
  conflictCount,
  subjectEmail,
}: {
  requestId: string;
  kind: string;
  closed: boolean;
  identityVerified: boolean;
  identityNote: string | null;
  hasInstitution: boolean;
  conflictCount: number;
  subjectEmail: string;
}) {
  if (closed) {
    return (
      <Panel title="Closed">
        <p className="t-body-sm m-0 text-ink-700">
          This request has been answered. Reopening is not a thing you should do — if the subject
          comes back, log a new request so each has its own clock and its own record.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <IdentityPanel requestId={requestId} verified={identityVerified} note={identityNote} subjectEmail={subjectEmail} />
      {hasInstitution ? <RoutePanel requestId={requestId} /> : null}
      <ClosePanel
        requestId={requestId}
        kind={kind}
        identityVerified={identityVerified}
        conflictCount={conflictCount}
      />
    </>
  );
}

function IdentityPanel({
  requestId,
  verified,
  note,
  subjectEmail,
}: {
  requestId: string;
  verified: boolean;
  note: string | null;
  subjectEmail: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(verifyIdentity, undefined);
  useNav(state);

  if (verified) {
    return (
      <Panel title="Identity">
        <p className="t-body-sm m-0 font-semibold text-verified-text">Verified</p>
        <p className="t-body-sm mt-2 mb-0 text-ink-700">{note}</p>
      </Panel>
    );
  }

  return (
    <Panel title="Verify identity first">
      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />
        {state?.error ? (
          <div className="mb-4">
            <Banner tone="danger" title="Not recorded">
              <p>{state.error}</p>
            </Banner>
          </div>
        ) : null}

        <p className="t-body-sm mt-0 mb-4 text-ink-700">
          Confirm this is {subjectEmail}, without asking for identity data we do not already hold.
          A reply from the address on file, or a request made from inside the signed-in account, is
          enough. Do not ask for a passport to prove ownership of an email address.
        </p>

        <Field
          label="How identity was confirmed"
          name="note"
          inputId="identity-note"
          required
          helper="Kept as the evidence that the check happened."
        >
          <Textarea id="identity-note" name="note" rows={3} required />
        </Field>

        <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
          {pending ? 'Recording' : 'Record verification'}
        </Button>
      </form>
    </Panel>
  );
}

function RoutePanel({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(routeToInstitution, undefined);
  useNav(state);

  return (
    <Panel title="Route to the institution">
      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />
        {state?.error ? (
          <p className="t-body-sm mb-3 font-semibold text-danger">
            <span aria-hidden="true">▲ </span>
            {state.error}
          </p>
        ) : null}
        {state?.notice ? <p className="t-body-sm mb-3 text-verified-text">{state.notice}</p> : null}

        <p className="t-body-sm mt-0 mb-4 text-ink-700">
          For data the institution controls — admissions decisions, academic records. They fulfil
          it with our assistance. The clock does not restart, and the requester is not asked to
          write to anyone else.
        </p>

        <Field label="Note for the registry" name="note" inputId="route-note">
          <Textarea id="route-note" name="note" rows={2} />
        </Field>

        <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
          {pending ? 'Routing' : 'Route to registry'}
        </Button>
      </form>
    </Panel>
  );
}

function ClosePanel({
  requestId,
  kind,
  identityVerified,
  conflictCount,
}: {
  requestId: string;
  kind: string;
  identityVerified: boolean;
  conflictCount: number;
}) {
  const [outcome, setOutcome] = useState<'fulfil' | 'refuse'>(
    kind === 'erasure' && conflictCount > 0 ? 'refuse' : 'fulfil',
  );
  const action = outcome === 'fulfil' ? fulfilRequest : refuseRequest;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  useNav(state);

  return (
    <Panel title="Close the request">
      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />

        {state?.error ? (
          <div className="mb-4">
            <Banner tone="danger" title="Not closed">
              <p>{state.error}</p>
            </Banner>
          </div>
        ) : null}

        <fieldset className="m-0 mb-4 border-0 p-0">
          <legend className="t-label mb-2 p-0 text-ink-900">Outcome</legend>
          {(['fulfil', 'refuse'] as const).map((o) => (
            <label key={o} className="t-body-sm mb-2 flex items-center gap-3 text-ink-900">
              <input
                type="radio"
                name="outcome"
                value={o}
                checked={outcome === o}
                onChange={() => setOutcome(o)}
                className="h-5 w-5 accent-[#6B2436]"
              />
              {o === 'fulfil' ? 'Fulfilled' : 'Refused, with reason'}
            </label>
          ))}
        </fieldset>

        <Field
          label={outcome === 'fulfil' ? 'What was done' : 'Why it is refused'}
          name="note"
          inputId="close-note"
          required
          helper={
            outcome === 'fulfil'
              ? 'What was sent, corrected or deleted. The subject is emailed this.'
              : 'Name the records retained and the basis. The subject is emailed this, and may escalate to the Commission on it.'
          }
        >
          <Textarea id="close-note" name="note" rows={4} required />
        </Field>

        {!identityVerified ? (
          <div className="mb-4">
            <Banner tone="warning" title="Identity not verified">
              <p>Nothing is released until the requester has been confirmed.</p>
            </Banner>
          </div>
        ) : null}

        <Button
          type="submit"
          size="dense"
          variant={outcome === 'refuse' ? 'danger' : 'primary'}
          disabled={pending || (outcome === 'fulfil' && !identityVerified)}
          aria-busy={pending}
        >
          {pending ? 'Recording' : outcome === 'fulfil' ? 'Mark fulfilled' : 'Refuse with reason'}
        </Button>
      </form>
    </Panel>
  );
}
