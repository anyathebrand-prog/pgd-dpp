import { PaymentPending } from '@/components/payment-pending';

/**
 * PY-02. The browser callback lands here. It confirms nothing — it polls for
 * the webhook's verdict (PAY-03).
 */
export default async function PendingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return (
    <main id="main">
      <PaymentPending reference={ref} />
    </main>
  );
}
