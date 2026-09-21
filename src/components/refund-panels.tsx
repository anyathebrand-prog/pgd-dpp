'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select, Textarea } from './ui';
import type { ActionState } from './form';
import { decideRefund, requestRefund } from '@/modules/payments/refunds';

function useNavigating(action: (prev: ActionState, form: FormData) => Promise<ActionState>) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);
  return { state, formAction, pending };
}

const REASONS = [
  { value: 'duplicate_payment', label: 'Paid twice' },
  { value: 'overpayment', label: 'Paid more than was owed' },
  { value: 'withdrawal', label: 'Student withdrew' },
  { value: 'cohort_cancelled', label: 'Intake cancelled' },
];

/** PAY-12 — asking for money to go back. The first of two people. */
export function RequestRefund({
  transactionId,
  paidNaira,
  channel,
  doublePaid,
}: {
  transactionId: string;
  paidNaira: number;
  channel: string;
  doublePaid: boolean;
}) {
  const { state, formAction, pending } = useNavigating(requestRefund);
  // The double-payment case defaults to the only method that is right for it.
  const [method, setMethod] = useState(
    doublePaid || channel !== 'paystack' ? 'manual_transfer' : 'paystack',
  );

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not requested">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <input type="hidden" name="transactionId" value={transactionId} />

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Why" name="reason" inputId="refund-reason" required>
          <Select id="refund-reason" name="reason" defaultValue={doublePaid ? 'duplicate_payment' : ''} required>
            <option value="" disabled>
              Choose a reason
            </option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Amount in naira"
          name="amount"
          inputId="refund-amount"
          required
          helper={`Up to ₦${paidNaira.toLocaleString('en-NG')}, less anything already refunded or pending.`}
        >
          <Input id="refund-amount" name="amount" inputMode="decimal" defaultValue={String(paidNaira)} required />
        </Field>
      </div>

      <Field label="How it goes back" name="method" inputId="refund-method" required>
        <Select
          id="refund-method"
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          required
        >
          <option value="paystack" disabled={channel !== 'paystack'}>
            Reverse the card payment through Paystack
          </option>
          <option value="manual_transfer">
            The institution transfers it back from its own account
          </option>
        </Select>
      </Field>

      {doublePaid ? (
        <p className="t-body-sm mt-0 mb-6 text-ink-700">
          <span aria-hidden="true">▲ </span>
          The duplicate here is the sponsor&apos;s bank transfer. The card payment is the one that
          counted, so it is returned by transfer rather than by reversing the card.
        </p>
      ) : null}

      <Field
        label="What happened"
        name="note"
        inputId="refund-note"
        required
        helper="The approver decides on this, and the student may ask to see it."
      >
        <Textarea id="refund-note" name="note" rows={3} required />
      </Field>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Requesting' : 'Request the refund'}
      </Button>
      <p className="t-caption mt-3 mb-0 text-ink-700">
        Nothing moves yet. A different administrator has to approve it.
      </p>
    </form>
  );
}

/** PAY-12 — the second person. */
export function DecideRefund({
  refundId,
  method,
}: {
  refundId: string;
  method: 'paystack' | 'manual_transfer';
}) {
  const { state, formAction, pending } = useNavigating(decideRefund);

  return (
    <form action={formAction}>
      {state?.error ? (
        <p className="t-body-sm mt-0 mb-3 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="refundId" value={refundId} />

      {method === 'manual_transfer' ? (
        <Field
          label="Your bank's reference for the transfer"
          name="bankReference"
          inputId={`bank-ref-${refundId}`}
          helper="Make the transfer first, then record it here. This is the only evidence it happened."
        >
          <Input id={`bank-ref-${refundId}`} name="bankReference" />
        </Field>
      ) : null}

      <Field
        label="Note on the decision"
        name="decisionNote"
        inputId={`decision-note-${refundId}`}
        helper="Required to reject. The person who asked will read it."
      >
        <Textarea id={`decision-note-${refundId}`} name="decisionNote" rows={2} />
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          size="dense"
          name="decision"
          value="approve"
          disabled={pending}
          aria-busy={pending}
        >
          {method === 'paystack' ? 'Approve and refund through Paystack' : 'Approve, transfer recorded'}
        </Button>
        <Button
          type="submit"
          size="dense"
          variant="secondary"
          name="decision"
          value="reject"
          disabled={pending}
        >
          Reject
        </Button>
      </div>
    </form>
  );
}
