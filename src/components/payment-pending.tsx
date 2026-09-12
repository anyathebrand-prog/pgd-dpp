'use client';

import { useEffect, useState } from 'react';

/**
 * PY-02 (§5.5 payment pending).
 *
 * The rules this screen has to obey, and why:
 *
 *  - An indeterminate bar in Oxblood, never a spinner. A spinner on a payment
 *    screen reads as an error to a lot of people.
 *  - This screen must NEVER show --danger while polling (flagged conflict
 *    C-07). Money has left the account; a red screen at that moment is the
 *    single worst thing this product could do to a candidate. When polling
 *    runs long, the copy stays calm and hands over a reference.
 *  - The reference is selectable Plex Mono, because the next thing that
 *    happens is someone reading it to a support agent over the phone.
 *  - aria-live="polite" announces the transition for screen reader users.
 *  - §9: under reduced motion the bar stops animating but is NOT removed —
 *    it becomes a static full-width bar, and this status line carries the
 *    state instead. Removing feedback is not an accessibility accommodation,
 *    least of all on the screen someone reaches straight after paying.
 */
export function PaymentPending({ reference }: { reference: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'pending' | 'success' | 'failed'>('pending');

  useEffect(() => {
    let cancelled = false;
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);

    async function poll() {
      try {
        const res = await fetch(`/api/pay/status/${reference}`, { cache: 'no-store' });
        const json = (await res.json()) as { status: string; next?: string };
        if (cancelled) return;
        if (json.status === 'success') {
          setStatus('success');
          window.location.href = json.next ?? `/pay/success/${reference}`;
        } else if (json.status === 'failed' || json.status === 'abandoned') {
          setStatus('failed');
          window.location.href = `/pay/failed/${reference}`;
        }
      } catch {
        // A failed poll is a network blip, not a failed payment. Keep polling.
      }
    }

    poll();
    const loop = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(loop);
    };
  }, [reference]);

  const slow = elapsed > 20;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="t-h1 m-0 text-ink-900">Confirming your payment</h1>

      <div
        className="bar-indeterminate mt-8 h-1 w-full max-w-[320px] overflow-hidden bg-ink-100"
        role="progressbar"
        aria-label="Confirming your payment"
      />

      <p className="t-body measure mt-8 text-ink-700" aria-live="polite">
        {status === 'success'
          ? 'Confirmed. Taking you to your receipt.'
          : slow
            ? 'Your bank has taken the payment and we are waiting for the confirmation to reach us. This sometimes takes a few minutes. You do not need to pay again, and you can close this tab — we will email you either way.'
            : 'Your payment has gone through to Paystack. We are waiting for their confirmation, which is what actually enrols you. No further action is needed.'}
      </p>

      <p className="t-caption mt-8 mb-1 text-ink-700">Payment reference</p>
      <p className="t-data-lg m-0 select-all text-ink-900">{reference}</p>
      <p className="t-caption mt-2 text-ink-700">
        Quote this if you need to contact the institution about this payment.
      </p>
    </div>
  );
}
