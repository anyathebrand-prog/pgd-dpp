'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Textarea } from './ui';
import type { ActionState } from './form';
import { approveOfflinePayment, rejectOfflinePayment } from '@/modules/payments/offline';

/**
 * IA-09. Approve or reject, side by side, because they are two outcomes of one
 * decision rather than two features.
 *
 * Approval is not a single button: it takes a note saying what the money was
 * matched against. That is the difference between an institution that can
 * answer "on what basis was this enrolment created" and one that cannot.
 */
export function OfflineDecision({
  transactionId,
  reference,
}: {
  transactionId: string;
  reference: string;
}) {
  const router = useRouter();
  const [approveState, approveAction, approving] = useActionState<ActionState, FormData>(
    approveOfflinePayment,
    undefined,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<ActionState, FormData>(
    rejectOfflinePayment,
    undefined,
  );

  /*
   * Either outcome removes this row from the queue, which is where the
   * confirmation cannot live: the row unmounts and takes the message with it,
   * so the decision appears to have produced nothing at all.
   *
   * The outcome goes into the URL instead. The server page renders it above
   * the queue, it survives the refresh, and it is still there if the admin
   * reloads — which is exactly what someone does when they are unsure whether
   * a payment went through.
   */
  useEffect(() => {
    if (approveState?.notice) {
      router.replace(`/admin/payments/offline?approved=${encodeURIComponent(reference)}`);
      router.refresh();
    }
  }, [approveState?.notice, reference, router]);

  useEffect(() => {
    if (rejectState?.notice) {
      router.replace(`/admin/payments/offline?rejected=${encodeURIComponent(reference)}`);
      router.refresh();
    }
  }, [rejectState?.notice, reference, router]);

  const state = approveState ?? rejectState;

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
        <form action={approveAction}>
          <input type="hidden" name="transactionId" value={transactionId} />
          <Field
            label="What you matched it against"
            name="note"
            inputId={`${transactionId}-note`}
            required
            helper="The statement line, the teller reference, or who at the bursary confirmed it."
          >
            <Input id={`${transactionId}-note`} name="note" required />
          </Field>
          <Button type="submit" size="dense" disabled={approving} aria-busy={approving}>
            {approving ? 'Settling' : `Approve ${reference}`}
          </Button>
        </form>

        <form action={rejectAction}>
          <input type="hidden" name="transactionId" value={transactionId} />
          <Field
            label="Or say why it cannot be confirmed"
            name="reason"
            inputId={`${transactionId}-reason`}
            helper="Sent to the payer verbatim. The charge stays outstanding — they can try again or pay by card."
          >
            <Textarea id={`${transactionId}-reason`} name="reason" rows={3} />
          </Field>
          <Button
            type="submit"
            size="dense"
            variant="secondary"
            disabled={rejecting}
            aria-busy={rejecting}
          >
            {rejecting ? 'Recording' : 'Reject'}
          </Button>
        </form>
      </div>
    </div>
  );
}
