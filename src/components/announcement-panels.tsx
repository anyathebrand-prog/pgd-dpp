'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select, Textarea, cx } from './ui';
import type { ActionState } from './form';
import { deleteAnnouncement, postAnnouncement } from '@/modules/teaching/assessment-actions';

/**
 * LRN-06 — announcements to a cohort.
 *
 * §5.8's scope warning is the design here: this is an announcement, not a
 * forum. No replies, no threads, no edit. A correction is a second
 * announcement, because the first one has already been read.
 */
export function AnnouncementComposer({
  cohorts,
}: {
  cohorts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    postAnnouncement,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  if (cohorts.length === 0) {
    return (
      <Banner tone="info" title="No cohort is running">
        <p>Announcements go to a cohort, and none of yours is open or running right now.</p>
      </Banner>
    );
  }

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not posted">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-4">
          <Banner tone="verified" title="Posted">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Cohort" name="cohortId" inputId="ann-cohort" required>
        <Select id="ann-cohort" name="cohortId" required defaultValue={cohorts[0]?.id}>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Subject" name="title" inputId="ann-title" required>
        <Input id="ann-title" name="title" required />
      </Field>

      <Field
        label="Announcement"
        name="body"
        inputId="ann-body"
        required
        helper="Everyone in that cohort reads this on their dashboard. It cannot be edited afterwards — a correction is a second announcement."
      >
        <Textarea id="ann-body" name="body" rows={5} required />
      </Field>

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Posting' : 'Post to the cohort'}
      </Button>
    </form>
  );
}

/** Removing one — for the wrong cohort, or a name that should not be there. */
export function AnnouncementRemove({
  announcementId,
  title,
  className,
}: {
  announcementId: string;
  title: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteAnnouncement,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction} className={cx(className)}>
      <input type="hidden" name="announcementId" value={announcementId} />
      <Button type="submit" size="inline" variant="tertiary" disabled={pending}>
        Remove<span className="sr-only"> — {title}</span>
      </Button>
      {state?.error ? (
        <p className="t-body-sm mt-2 mb-0 font-semibold text-danger">{state.error}</p>
      ) : null}
    </form>
  );
}
