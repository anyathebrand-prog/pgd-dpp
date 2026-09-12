/**
 * PRD §7.2: "E2E coverage is mandatory on the two payment paths."
 *
 * This drives the real webhook route handler with real HMAC signatures against
 * a real database. Nothing here is mocked, because every interesting failure in
 * this subsystem lives in the seam between the signature check, the idempotency
 * key and the settlement transaction — and a mock of any one of those three
 * tests the mock instead.
 *
 * The two paths:
 *   1. application fee  — settlement moves the application into the registry queue
 *   2. tuition          — settlement creates the enrollment and the matric number
 *
 * The rules being defended, in priority order:
 *   PAY-03  only the webhook confirms a payment; the browser never does
 *   PAY-04  duplicate delivery and replay are harmless
 *   §5.1    no enrollment without admitted + offer_accepted
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { adminDb, adminSql, appSql } from '@/db';
import {
  applications,
  cohorts,
  enrollments,
  inboundEvents,
  institutions,
  memberships,
  transactions,
  users,
} from '@/db/schema';
import { POST } from '@/app/api/webhooks/paystack/route';

const FEE_KOBO = 2_500_000;
const TUITION_KOBO = 51_500_000;

let institutionId: string;
let cohortId: string;
let userId: string;

/** Builds a correctly signed Paystack delivery, exactly as the real one arrives. */
function delivery(
  event: 'charge.success' | 'charge.failed',
  reference: string,
  opts: { amountKobo?: number; eventId?: number; signature?: string } = {},
) {
  const body = JSON.stringify({
    event,
    id: opts.eventId ?? Math.floor(Math.random() * 1e9),
    data: {
      id: Math.floor(Math.random() * 1e9),
      reference,
      amount: opts.amountKobo ?? FEE_KOBO,
      status: event === 'charge.success' ? 'success' : 'failed',
      paid_at: new Date().toISOString(),
    },
  });

  const signature =
    opts.signature ??
    createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');

  return new Request('http://localhost/api/webhooks/paystack', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': signature },
    body,
  });
}

async function makeApplication(status: 'awaiting_application_fee' | 'offer_accepted' | 'admitted') {
  const reference = `TEST-APP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const [app] = await adminDb
    .insert(applications)
    .values({ institutionId, cohortId, userId, reference, status })
    .returning();
  return app;
}

async function makeTransaction(
  applicationId: string,
  context: 'application' | 'tuition',
  amountKobo: number,
) {
  const reference = `TEST-${context.toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const [txn] = await adminDb
    .insert(transactions)
    .values({ institutionId, userId, applicationId, reference, context, amountKobo })
    .returning();
  return txn;
}

beforeAll(async () => {
  const [inst] = await adminDb
    .select()
    .from(institutions)
    .where(eq(institutions.slug, 'unilag'))
    .limit(1);
  expect(inst, 'seed data missing — run npm run db:reset').toBeTruthy();
  institutionId = inst.id;

  const [cohort] = await adminDb
    .select()
    .from(cohorts)
    .where(eq(cohorts.institutionId, institutionId))
    .limit(1);
  cohortId = cohort.id;

  const [user] = await adminDb
    .insert(users)
    .values({
      email: `payments-test-${Date.now()}@example.ng`,
      fullName: 'Payments Test Subject',
      status: 'candidate',
      emailVerifiedAt: new Date(),
    })
    .returning();
  userId = user.id;
  await adminDb.insert(memberships).values({ userId, institutionId, role: 'candidate' });
});

beforeEach(async () => {
  // A candidate may hold only one application per cohort, and only one
  // enrollment, so each test starts from a clean subject rather than trying to
  // work around the constraints that make those rules true.
  await adminDb.delete(enrollments).where(eq(enrollments.userId, userId));
  await adminDb.delete(transactions).where(eq(transactions.userId, userId));
  await adminDb.delete(applications).where(eq(applications.userId, userId));
  await adminDb.update(users).set({ status: 'candidate' }).where(eq(users.id, userId));
  await adminDb
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'student')));
});

afterAll(async () => {
  await adminDb.delete(enrollments).where(eq(enrollments.userId, userId));
  await adminDb.delete(transactions).where(eq(transactions.userId, userId));
  await adminDb.delete(applications).where(eq(applications.userId, userId));
  await adminDb.delete(memberships).where(eq(memberships.userId, userId));
  await adminDb.delete(users).where(eq(users.id, userId));
  await appSql.end();
  await adminSql.end();
});

/* ------------------------------------------------------ signature and replay */

describe('the webhook only trusts what it can verify', () => {
  it('rejects a forged signature and settles nothing', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);

    const res = await POST(delivery('charge.success', txn.reference, { signature: 'deadbeef' }));
    expect(res.status).toBe(401);

    const [after] = await adminDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, txn.id));
    expect(after.status).toBe('pending');

    const [appAfter] = await adminDb
      .select()
      .from(applications)
      .where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('awaiting_application_fee');
  });

  it('still records a forged delivery, flagged invalid', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);
    const eventId = Math.floor(Math.random() * 1e9);

    await POST(delivery('charge.success', txn.reference, { signature: 'deadbeef', eventId }));

    const [event] = await adminDb
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.eventId, String(eventId)));

    // Dropping it silently would discard the evidence that someone is probing
    // this endpoint, which is exactly what you want during an incident.
    expect(event).toBeTruthy();
    expect(event.signatureValid).toBe(false);
    expect(event.processedAt).toBeNull();
  });

  it('treats a duplicate delivery of the same event as a no-op', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);
    const eventId = Math.floor(Math.random() * 1e9);

    const first = await POST(delivery('charge.success', txn.reference, { eventId }));
    const second = await POST(delivery('charge.success', txn.reference, { eventId }));

    expect(first.status).toBe(200);
    // Paystack retries until it sees a 200, so a duplicate must answer 200 —
    // not an error that would make it retry forever.
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const rows = await adminDb
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.eventId, String(eventId)));
    expect(rows).toHaveLength(1);
  });
});

/* -------------------------------------------------- path 1: application fee */

describe('path 1 — the application fee', () => {
  it('moves the application into the registry queue on settlement', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);

    const res = await POST(delivery('charge.success', txn.reference));
    expect(res.status).toBe(200);

    const [after] = await adminDb.select().from(transactions).where(eq(transactions.id, txn.id));
    expect(after.status).toBe('success');
    expect(after.paidAt).toBeTruthy();

    const [appAfter] = await adminDb.select().from(applications).where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('submitted');
    expect(appAfter.submittedAt).toBeTruthy();
  });

  it('records a declined charge without touching the application', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);

    await POST(delivery('charge.failed', txn.reference));

    const [after] = await adminDb.select().from(transactions).where(eq(transactions.id, txn.id));
    expect(after.status).toBe('failed');

    const [appAfter] = await adminDb.select().from(applications).where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('awaiting_application_fee');
  });

  it('holds a charge whose amount does not match what we charged', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);

    await POST(delivery('charge.success', txn.reference, { amountKobo: 100 }));

    const [after] = await adminDb.select().from(transactions).where(eq(transactions.id, txn.id));
    // Never trust the callback amount over the amount we charged, and never
    // resolve the difference silently in either direction.
    expect(after.status).toBe('awaiting_approval');
    expect(after.metadata).toMatchObject({
      amountMismatch: { expected: FEE_KOBO, received: 100 },
    });

    const [appAfter] = await adminDb.select().from(applications).where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('awaiting_application_fee');
  });

  it('survives a reference it has never seen', async () => {
    const res = await POST(delivery('charge.success', 'TEST-NOT-A-REAL-REFERENCE'));
    // A 500 here would make Paystack retry a payload we can never process.
    expect(res.status).toBe(200);
  });
});

/* --------------------------------------------------------- path 2: tuition */

describe('path 2 — tuition, and the admission gate', () => {
  it('creates the enrollment and matric number on settlement', async () => {
    const app = await makeApplication('offer_accepted');
    const txn = await makeTransaction(app.id, 'tuition', TUITION_KOBO);

    const res = await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO }));
    expect(res.status).toBe(200);

    const rows = await adminDb.select().from(enrollments).where(eq(enrollments.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].matricNumber).toMatch(/^UNILAG\/DPP\/\d{4}\//);
    expect(rows[0].cohortId).toBe(cohortId);

    const [appAfter] = await adminDb.select().from(applications).where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('enrolled');

    // AUTH-10 lifecycle: candidate becomes student, with the role to match.
    const [userAfter] = await adminDb.select().from(users).where(eq(users.id, userId));
    expect(userAfter.status).toBe('student');

    const roles = await adminDb
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'student')));
    expect(roles).toHaveLength(1);
  });

  it('refuses to enrol anyone who has not accepted an offer', async () => {
    // §5.1 LOCKED. This is the gate. Paying without an accepted offer must not
    // buy a place, however the payment arrived.
    const app = await makeApplication('admitted');
    const txn = await makeTransaction(app.id, 'tuition', TUITION_KOBO);

    const res = await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO }));
    expect(res.status).toBe(200);

    const rows = await adminDb.select().from(enrollments).where(eq(enrollments.userId, userId));
    expect(rows, 'a payment bypassed the admission gate').toHaveLength(0);

    const [appAfter] = await adminDb.select().from(applications).where(eq(applications.id, app.id));
    expect(appAfter.status).toBe('admitted');

    // The money is still recorded as received — it just did not buy a place.
    const [after] = await adminDb.select().from(transactions).where(eq(transactions.id, txn.id));
    expect(after.status).toBe('success');
  });

  it('does not enrol twice when the same event is replayed', async () => {
    const app = await makeApplication('offer_accepted');
    const txn = await makeTransaction(app.id, 'tuition', TUITION_KOBO);
    const eventId = Math.floor(Math.random() * 1e9);

    await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO, eventId }));
    await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO, eventId }));

    const rows = await adminDb.select().from(enrollments).where(eq(enrollments.userId, userId));
    expect(rows, 'replay produced a second enrollment').toHaveLength(1);
  });

  it('does not enrol twice when a DIFFERENT event settles the same reference', async () => {
    // The inbound_events key deduplicates identical deliveries. This covers the
    // other case: two distinct event ids naming one transaction, which the
    // already-settled check in settleTransaction has to catch instead.
    const app = await makeApplication('offer_accepted');
    const txn = await makeTransaction(app.id, 'tuition', TUITION_KOBO);

    await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO }));
    await POST(delivery('charge.success', txn.reference, { amountKobo: TUITION_KOBO }));

    const rows = await adminDb.select().from(enrollments).where(eq(enrollments.userId, userId));
    expect(rows).toHaveLength(1);
  });
});

/* --------------------------------------------------------------- audit trail */

describe('settlement leaves an audit trail', () => {
  it('records who settled what, against the data subject', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);

    await POST(delivery('charge.success', txn.reference));

    const { auditLog } = await import('@/db/schema');
    const entries = await adminDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, txn.id));

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('payment.settled');
    expect(entries[0].actorRole).toBe('system:webhook');
    // CMP-09 depends on this: scoping affected subjects has to be one indexed
    // query, not a forensic exercise.
    expect(entries[0].subjectId).toBe(userId);
  });

  it('marks the inbound event processed once settlement succeeds', async () => {
    const app = await makeApplication('awaiting_application_fee');
    const txn = await makeTransaction(app.id, 'application', FEE_KOBO);
    const eventId = Math.floor(Math.random() * 1e9);

    await POST(delivery('charge.success', txn.reference, { eventId }));

    const [event] = await adminDb
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.eventId, String(eventId)));
    expect(event.processedAt).toBeTruthy();
    expect(event.processingError).toBeNull();
  });
});
