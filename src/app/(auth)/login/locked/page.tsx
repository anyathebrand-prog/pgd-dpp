import Link from 'next/link';
import { Banner } from '@/components/ui';

/**
 * AU-09. The copy states what happened and what to do, and does not apologise
 * (§1.4). It also does not say whether the account exists.
 */
export default function LockedPage() {
  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Too many attempts</h1>
      <div className="mt-6">
        <Banner tone="warning" title="Sign-in is paused on this account">
          <p>
            Sign-in has been paused for a short period after repeated failed attempts. The wait gets
            longer with each further attempt, so waiting is faster than retrying.
          </p>
        </Banner>
      </div>
      <p className="t-body mt-8 text-ink-700">
        If you cannot remember your password,{' '}
        <Link href="/forgot" className="text-ink-900 underline underline-offset-2">
          reset it
        </Link>{' '}
        — that clears the pause immediately.
      </p>
    </>
  );
}
