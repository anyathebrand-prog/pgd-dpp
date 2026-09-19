'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select } from './ui';
import type { ActionState } from './form';
import { confirmPayoutAccount, resolvePayoutAccount } from '@/modules/admin/payouts';

/** IA-07, step one: which account. */
export function PayoutLookup({
  banks,
  bankCode,
  accountNumber,
}: {
  banks: { name: string; code: string }[];
  bankCode: string;
  accountNumber: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    resolvePayoutAccount,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="The bank did not confirm that account">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Bank" name="bankCode" inputId="payout-bank" required>
        <Select id="payout-bank" name="bankCode" required defaultValue={bankCode}>
          <option value="">Choose the bank</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Account number"
        name="accountNumber"
        inputId="payout-account"
        required
        helper="Ten digits. We ask the bank whose account it is before anything is saved."
      >
        <Input
          id="payout-account"
          name="accountNumber"
          inputMode="numeric"
          required
          defaultValue={accountNumber}
        />
      </Field>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Asking the bank' : 'Look it up'}
      </Button>
    </form>
  );
}

/**
 * IA-07, step two: a person reads the name and says it is theirs.
 *
 * The checkbox is the control. Paystack is not liable for payouts to a wrong
 * account, and a transposed digit is a valid account belonging to a stranger
 * — so the name the bank returned is set in the largest type on the page, and
 * saving is impossible without someone ticking that they read it.
 */
export function PayoutConfirm({
  bankCode,
  bankName,
  accountNumber,
  accountName,
  sharePercent,
}: {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  sharePercent: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    confirmPayoutAccount,
    undefined,
  );

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-6">
          <Banner tone="danger" title="Not saved">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <input type="hidden" name="bankCode" value={bankCode} />
      <input type="hidden" name="accountNumber" value={accountNumber} />
      <input type="hidden" name="accountName" value={accountName} />

      <div className="mb-8 rounded-md bg-record p-5">
        <p className="t-caption m-0 mb-1 text-ink-700">The bank says this account belongs to</p>
        <p className="t-h2 m-0 text-ink-900">{accountName}</p>
        <p className="t-body-sm mt-3 mb-0 text-ink-700">
          {bankName} · {accountNumber}
        </p>
      </div>

      <Field
        label="Your share of each payment"
        name="sharePercent"
        inputId="payout-share"
        required
        helper="The percentage that settles to you. The remainder is the platform's commission, and Paystack's fee comes off your share."
      >
        <Input
          id="payout-share"
          name="sharePercent"
          inputMode="numeric"
          required
          defaultValue={sharePercent}
        />
      </Field>

      <label className="t-body-sm mb-8 flex items-start gap-3 text-ink-900">
        <input
          type="checkbox"
          name="confirmed"
          className="mt-0.5 h-6 w-6 shrink-0 accent-[#6B2436]"
        />
        <span>
          I have read the name above and it is this institution&apos;s account. I understand that
          money settling to the wrong account because the number was wrong is not recoverable by
          the platform or by Paystack.
        </span>
      </label>

      <div className="flex flex-wrap gap-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Saving' : 'That is our account'}
        </Button>
        <Button type="button" variant="tertiary" onClick={() => router.push('/admin/payouts')}>
          Start again
        </Button>
      </div>
    </form>
  );
}
