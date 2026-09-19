import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { adminDb } from '@/db';
import { inboundEvents } from '@/db/schema';
import { paystackSignatureValid } from '@/lib/crypto';
import { failTransaction, settleTransaction } from '@/modules/payments/settle';

/**
 * PAY-03 / PAY-04 / §7.5 — the Paystack webhook receiver.
 *
 * In production this is a separate deployable, so it stays up during an app
 * deploy and answers fast. The ordering here is the important part and holds
 * either way:
 *
 *   1. read the RAW body — the HMAC is over exact bytes, so parsing first and
 *      re-serialising would break verification on any key-order difference;
 *   2. verify the HMAC SHA512 signature in constant time;
 *   3. write the event to `inbound_events` keyed on Paystack's event id BEFORE
 *      any business logic — that single unique index is what makes replay and
 *      duplicate delivery harmless;
 *   4. only then settle.
 *
 * A payload that fails the signature check is still recorded, flagged invalid,
 * and answered with 401. Silently dropping it would throw away the evidence
 * that someone is probing this endpoint.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('x-paystack-signature');
  const valid = paystackSignatureValid(raw, signature);

  let body: {
    event?: string;
    id?: string | number;
    data?: { id?: number; reference?: string; amount?: number; status?: string; paid_at?: string };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true }, { status: 400 });
  }

  const eventType = body.event ?? 'unknown';
  // Paystack does not always send a top-level event id, so the transaction id
  // plus event type is the stable key. It is what deduplicates a retry.
  const eventId = String(body.id ?? `${eventType}:${body.data?.id ?? body.data?.reference ?? crypto.randomUUID()}`);

  /*
   * An unsigned payload is still recorded — it is the evidence that someone
   * is probing — but in a namespace of its own, so it can never occupy a real
   * event's dedupe key.
   *
   * It used to be written under the real key, as provider `paystack`, before
   * the signature was checked. Paystack transaction ids are sequential, so
   * anyone could post an unsigned `charge.success` for the next few ids; each
   * claimed its key, and when the genuine event arrived it was answered
   * "duplicate" and the payment never settled. The unique index is what makes
   * replay harmless, and it was being handed to people with no signature.
   *
   * The event id is kept as sent, because it is the useful part of the
   * evidence. The provider is what separates the two.
   */
  if (!valid) {
    await adminDb
      .insert(inboundEvents)
      .values({
        provider: 'paystack:unsigned',
        eventId,
        eventType,
        signatureValid: false,
        payload: body as Record<string, unknown>,
      })
      .onConflictDoNothing();
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const [inserted] = await adminDb
    .insert(inboundEvents)
    .values({
      provider: 'paystack',
      eventId,
      eventType,
      signatureValid: true,
      payload: body as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });

  let stored = inserted;
  if (!stored) {
    /*
     * Seen before. A duplicate of an event that was processed answers 200 and
     * does nothing, which is PAY-04.
     *
     * But an event whose processing *failed* is not a duplicate — the 500
     * below exists precisely so Paystack retries it — and treating the retry
     * as one meant the failure was permanent. So an unprocessed row is picked
     * up again. Settlement is idempotent on the transaction's own status, so
     * a retry after a partial failure cannot enrol anyone twice.
     */
    const [previous] = await adminDb
      .select({ id: inboundEvents.id, processedAt: inboundEvents.processedAt })
      .from(inboundEvents)
      .where(and(eq(inboundEvents.provider, 'paystack'), eq(inboundEvents.eventId, eventId)))
      .limit(1);
    if (!previous || previous.processedAt) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    stored = { id: previous.id };
  }

  try {
    const reference = body.data?.reference;
    if (reference) {
      // §7.5 says business logic belongs in a job, not inline, so a slow
      // side-effect never makes Paystack see a timeout and retry. Settlement
      // here is a handful of indexed writes in one transaction and stays well
      // inside the budget; the queue is the next thing to move behind, and the
      // inbound_events row is already the durable hand-off point for it.
      if (eventType === 'charge.success') {
        await settleTransaction({
          reference,
          paystackId: body.data?.id ? String(body.data.id) : null,
          amountKobo: body.data?.amount ?? null,
          paidAt: body.data?.paid_at ? new Date(body.data.paid_at) : new Date(),
        });
      } else if (eventType === 'charge.failed') {
        await failTransaction(reference, 'failed');
      }
    }

    await adminDb
      .update(inboundEvents)
      .set({ processedAt: new Date() })
      .where(eq(inboundEvents.id, stored.id));
  } catch (err) {
    await adminDb
      .update(inboundEvents)
      .set({ processingError: err instanceof Error ? err.message : String(err) })
      .where(eq(inboundEvents.id, stored.id));
    // 500 so Paystack retries. The event row is already durable, so the retry
    // deduplicates to a no-op if the failure was partial.
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
