'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Record, cx } from './ui';
import type { ActionState } from './form';
import { revokeSession, signOutEverywhereAction } from '@/modules/auth/account-actions';

type Row = {
  id: string;
  device: string;
  startedAt: string;
  expiresAt: string;
  institution: string | null;
  mfaSatisfied: boolean;
  current: boolean;
};

/** ST-17. */
export function SessionList({ sessions }: { sessions: Row[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    revokeSession,
    undefined,
  );
  const [allState, allAction, allPending] = useActionState<ActionState, FormData>(
    signOutEverywhereAction,
    undefined,
  );

  // Ending a session changes this very list, so the page has to re-read.
  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  useEffect(() => {
    if (allState?.redirectTo) router.push(allState.redirectTo);
  }, [allState?.redirectTo, router]);

  return (
    <>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not ended">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-4">
          <Banner tone="verified" title="Ended">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <ul className="m-0 grid list-none gap-4 p-0">
        {sessions.map((s) => (
          <Record
            as="li"
            key={s.id}
            title={s.device}
            meta={`Signed in ${s.startedAt} · expires ${s.expiresAt}${
              s.institution ? ` · opened at ${s.institution}` : ''
            }`}
            className={cx(s.current && 'border-l-[3px] border-l-verified-fill')}
          >
            <div className="flex flex-wrap items-center gap-4">
              {s.current ? (
                <p className="t-body-sm m-0 font-semibold text-verified-text">
                  This device, right now
                </p>
              ) : (
                <form action={formAction}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <Button type="submit" size="dense" variant="secondary" disabled={pending}>
                    End this session
                  </Button>
                </form>
              )}
              {s.mfaSatisfied ? (
                <p className="t-caption m-0 text-ink-700">Second factor cleared</p>
              ) : null}
            </div>
          </Record>
        ))}
      </ul>

      <form action={allAction} className="mt-8">
        <p className="t-body-sm mt-0 mb-3 text-ink-700">
          Signing out everywhere ends this session too, so you will be asked to log in again.
        </p>
        <Button type="submit" variant="secondary" disabled={allPending} aria-busy={allPending}>
          {allPending ? 'Signing out' : 'Sign out everywhere'}
        </Button>
      </form>
    </>
  );
}
