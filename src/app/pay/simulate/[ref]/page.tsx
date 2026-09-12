import { notFound, redirect } from 'next/navigation';
import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { isSimulated } from '@/lib/paystack';
import { Banner, Button, Naira, Panel } from '@/components/ui';

/**
 * Local and staging stand-in for the Paystack hosted checkout.
 *
 * It deliberately does NOT mark anything paid itself. It signs a
 * `charge.success` payload and posts it to our own webhook route, so the path
 * under test is the real one — signature verification, the inbound_events
 * dedupe key, and settlement all run exactly as they will in production. A
 * simulator that shortcut to "enrolled" would hide the one bug (PAY-03) this
 * architecture exists to prevent.
 *
 * It refuses to render when real Paystack keys are configured.
 */
export default async function SimulateCheckout({ params }: { params: Promise<{ ref: string }> }) {
  if (!isSimulated()) notFound();

  const { ref } = await params;
  const me = await requireUser();
  const institution = await requireInstitution();

  const [txn] = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.reference, ref), eq(transactions.userId, me.userId)))
      .limit(1),
  );
  if (!txn) notFound();

  async function fire(outcome: 'charge.success' | 'charge.failed') {
    'use server';
    const h = await headers();
    const payload = {
      event: outcome,
      data: {
        id: Math.floor(Math.random() * 1e9),
        reference: ref,
        amount: txn.amountKobo,
        status: outcome === 'charge.success' ? 'success' : 'failed',
        paid_at: new Date().toISOString(),
      },
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_simulated')
      .update(raw)
      .digest('hex');

    const proto = process.env.APP_PROTOCOL ?? 'http';
    await fetch(`${proto}://${h.get('host')}/api/webhooks/paystack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: raw,
    });

    redirect(`/pay/pending/${ref}`);
  }

  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
      <h1 className="t-h1 m-0 text-ink-900">Simulated checkout</h1>
      <p className="t-body mt-3 mb-8 text-ink-700">
        Paystack keys are not configured, so this stands in for the hosted checkout. It posts a
        signed webhook to this application exactly as Paystack would.
      </p>

      <Panel title="Charge">
        <dl className="t-body-sm m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-ink-900">
          <dt className="text-ink-700">Reference</dt>
          <dd className="t-data m-0">{txn.reference}</dd>
          <dt className="text-ink-700">Amount</dt>
          <dd className="m-0">
            <Naira kobo={txn.amountKobo} />
          </dd>
          <dt className="text-ink-700">Institution share</dt>
          <dd className="m-0">
            <Naira kobo={txn.institutionShareKobo} />
          </dd>
          <dt className="text-ink-700">Platform share</dt>
          <dd className="m-0">
            <Naira kobo={txn.platformShareKobo} />
          </dd>
        </dl>
      </Panel>

      <div className="mt-8">
        <Banner tone="info" title="Not a real payment">
          <p>This screen exists only when PAYSTACK_SIMULATE is on. It is never reachable in production.</p>
        </Banner>
      </div>

      <div className="mt-16 flex flex-wrap gap-4">
        <form action={fire.bind(null, 'charge.success')}>
          <Button type="submit">Simulate a successful charge</Button>
        </form>
        <form action={fire.bind(null, 'charge.failed')}>
          <Button type="submit" variant="secondary">
            Simulate a declined charge
          </Button>
        </form>
      </div>
    </main>
  );
}
