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

/* ------------------------------------------------------------------ PAY-06 */

/**
 * Bank list, account resolution and subaccount creation — the three calls
 * IA-07 needs.
 *
 * The requirement that shapes all three: "account name resolved and displayed
 * for explicit confirmation before saving — Paystack is not liable for
 * payouts to a wrong account." A transposed digit in an account number is a
 * valid account belonging to a stranger, and the only thing standing between
 * a university's tuition and that stranger is a human reading the resolved
 * name and saying yes.
 *
 * Under PAYSTACK_SIMULATE the calls are answered locally so the flow is
 * exercisable without keys. The stand-in is deliberately unhelpful about one
 * thing: it resolves a name derived from the digits rather than whatever the
 * caller hoped for, so a test that expects a particular name has to have
 * asked for it.
 */

export type Bank = { name: string; code: string };

const SIMULATED_BANKS: Bank[] = [
  { name: 'Access Bank', code: '044' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'United Bank for Africa', code: '033' },
  { name: 'Zenith Bank', code: '057' },
];

export async function listBanks(): Promise<Bank[]> {
  if (isSimulated()) return SIMULATED_BANKS;

  const res = await fetch(`${BASE}/bank?country=nigeria&perPage=100`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    // The list changes rarely and a slow payout screen is a screen nobody
    // finishes, so this is the one Paystack call worth caching.
    next: { revalidate: 86_400 },
  });
  if (!res.ok) return SIMULATED_BANKS;

  const body = (await res.json()) as { data?: { name: string; code: string }[] };
  return (body.data ?? []).map((b) => ({ name: b.name, code: b.code }));
}

export type Resolution =
  | { ok: true; accountName: string }
  | { ok: false; reason: string };

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<Resolution> {
  if (!/^\d{10}$/.test(accountNumber)) {
    return { ok: false, reason: 'A Nigerian account number is ten digits.' };
  }

  if (isSimulated()) {
    // Derived from the digits, so the simulation cannot accidentally agree
    // with whatever a caller was hoping to see.
    const bank = SIMULATED_BANKS.find((b) => b.code === bankCode)?.name ?? 'Unknown Bank';
    return { ok: true, accountName: `SIMULATED ACCOUNT ${accountNumber.slice(-4)} — ${bank}` };
  }

  const res = await fetch(
    `${BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
  );
  const body = (await res.json()) as { status?: boolean; message?: string; data?: { account_name?: string } };

  if (!res.ok || !body.status || !body.data?.account_name) {
    return {
      ok: false,
      reason: body.message ?? 'The bank could not confirm that account number.',
    };
  }
  return { ok: true, accountName: body.data.account_name };
}

export async function createSubaccount(params: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  /** The percentage the INSTITUTION keeps. */
  sharePercent: number;
}): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  if (isSimulated()) {
    return { ok: true, code: `ACCT_sim_${humanCode(10).toLowerCase()}` };
  }

  const res = await fetch(`${BASE}/subaccount`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      business_name: params.businessName,
      bank_code: params.bankCode,
      account_number: params.accountNumber,
      percentage_charge: 100 - params.sharePercent,
    }),
  });
  const body = (await res.json()) as { status?: boolean; message?: string; data?: { subaccount_code?: string } };

  if (!res.ok || !body.status || !body.data?.subaccount_code) {
    return { ok: false, reason: body.message ?? 'Paystack refused to create the subaccount.' };
  }
  return { ok: true, code: body.data.subaccount_code };
}

/**
 * PAY-12 — asking Paystack to return money to the card or account it came
 * from.
 *
 * Called only after a second person has approved the refund. Paystack pays the
 * refund out of the settlement balance, so a refund on a split transaction
 * comes back proportionally from the institution's share and the platform's —
 * which is the arrangement the institutional agreement assumes, and the reason
 * this goes through Paystack rather than as a separate bank transfer that
 * would leave the platform's commission kept on money that was returned.
 */
export async function createRefund(params: {
  reference: string;
  amountKobo: number;
  note: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (isSimulated()) {
    return { ok: true, id: `RF_sim_${humanCode(10).toLowerCase()}` };
  }

  const res = await fetch(`${BASE}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: params.reference,
      amount: params.amountKobo,
      merchant_note: params.note.slice(0, 200),
    }),
  });
  const body = (await res.json()) as {
    status?: boolean;
    message?: string;
    data?: { id?: number | string };
  };

  if (!res.ok || !body.status || body.data?.id == null) {
    return { ok: false, reason: body.message ?? 'Paystack refused the refund.' };
  }
  return { ok: true, id: String(body.data.id) };
}
