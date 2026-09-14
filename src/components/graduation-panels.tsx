'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button } from './ui';
import type { ActionState } from './form';
import { certifyCompletion } from '@/modules/alumni/actions';

/**
 * RG — certifying a student's completion (ALM-01, LRN-08).
 *
 * One button, and it does four things at once: issues the certificate, closes
 * the enrolment, moves the person from student to alumnus, and creates their
 * (empty, invisible) alumni profile. They happen together because a graduate
 * who holds a certificate but is still a student to the system is a support
 * ticket, and one that is hard to describe.
 */
export function CertifyButton({ enrollmentId, name }: { enrollmentId: string; name: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    certifyCompletion,
    undefined,
  );

  /*
   * The outcome goes into the URL, not into this component.
   *
   * Certifying moves the row out of "still studying", so a banner rendered
   * here unmounts with the row it was confirming and the registrar sees the
   * person vanish and nothing else. The page renders it instead, and it
   * survives a reload.
   */
  useEffect(() => {
    if (state?.notice) router.replace(`/admin/graduation?certified=${enrollmentId}`);
  }, [state?.notice, enrollmentId, router]);

  return (
    <div>
      {state?.error ? (
        <div className="mb-3">
          <Banner tone="danger" title="Not certified">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-3">
          <Banner tone="verified" title="Certified">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
          {pending ? 'Issuing' : 'Certify completion'}
          <span className="sr-only"> for {name}</span>
        </Button>
      </form>
    </div>
  );
}
