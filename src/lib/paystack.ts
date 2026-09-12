import 'server-only';
import { humanCode } from './crypto';

/**
 * Paystack, integrated directly — no payment abstraction layer (§7.2).
 *
 * The rule this module exists to protect: **enrollment is confirmed by the
 * `charge.success` webhook, never by the browser callback** (PAY-03). Nothing
 * here returns a "paid" answer to a page. The only thing that marks a
 * transaction successful is the webhook handler.
 */

const BASE = 'https://api.paystack.co';

export function isSimulated() {
  return process.env.PAYSTACK_SIMULATE === '1' || !process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_');
}

export function newReference(prefix: 'APP' | 'TUI' | 'SUN') {
  return `${prefix}-${humanCode(10)}`;
}

/**
 * PAY-05 transaction splits. `bearer_type: 'subaccount'` puts Paystack's fee
 * on the institution's share, which is the arrangement the institutional
 * agreement assumes; flip it per tenant if a contract says otherwise.
 */
export function splitFor(amountKobo: number, sharePercent: number) {
  const institutionShareKobo = Math.floor((amountKobo * sharePercent) / 100);
  return { institutionShareKobo, platformShareKobo: amountKobo - institutionShareKobo };
}

export type InitResult = { authorizationUrl: string; accessCode: string; reference: string };

export async function initializeTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  subaccountCode?: string | null;
  sharePercent?: number;
  metadata?: Record<string, unknown>;
}): Promise<InitResult> {
  if (isSimulated()) {
    // Local and staging without live keys. The simulated checkout page posts to
    // the same webhook route with a valid signature, so the path under test is
    // the real one — the browser still never confirms anything.
    return {
      authorizationUrl: `/pay/simulate/${params.reference}`,
      accessCode: 'simulated',
      reference: params.reference,
    };
  }

  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      currency: 'NGN',
      callback_url: params.callbackUrl,
      metadata: params.metadata ?? {},
      ...(params.subaccountCode
        ? {
            subaccount: params.subaccountCode,
            // Percentage retained by the PLATFORM; the subaccount gets the rest.
            transaction_charge: undefined,
            bearer: 'subaccount',
          }
        : {}),
    }),
  });

  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data?: { authorization_url: string; access_code: string; reference: string };
  };
  if (!json.status || !json.data) throw new Error(`Paystack initialize failed: ${json.message}`);
  return {
    authorizationUrl: json.data.authorization_url,
    accessCode: json.data.access_code,
    reference: json.data.reference,
  };
}

/**
 * Used by the nightly reconciliation job (PAY-08), not by the request path.
 * If the webhook and this disagree, the drift is flagged for a human rather
 * than silently resolved — a payments system that self-heals hides the bug.
 */
export async function verifyTransaction(reference: string) {
  if (isSimulated()) return null;
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const json = (await res.json()) as {
    status: boolean;
    data?: { status: string; amount: number; id: number; paid_at: string };
  };
  return json.data ?? null;
}
