'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input } from './ui';
import type { ActionState } from './form';
import { broadcast, dismissReport, removePost } from '@/modules/alumni/channel-actions';
import { Textarea } from './ui';

/** IA-10 / ALM-11 — an institution writing to its own graduates. */
export function BroadcastForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(broadcast, undefined);

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not sent">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}
      {state?.notice ? (
        <div className="mb-4">
          <Banner tone="verified" title="Sent">
            <p>{state.notice}</p>
          </Banner>
        </div>
      ) : null}

      <Field label="Subject" name="title" inputId="broadcast-title" required>
        <Input id="broadcast-title" name="title" required />
      </Field>

      <Field
        label="Message"
        name="body"
        inputId="broadcast-body"
        required
        helper="Goes to your own alumni and nobody else's. It appears in their school channel."
      >
        <Textarea id="broadcast-body" name="body" rows={5} required />
      </Field>

      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Sending' : 'Broadcast to our alumni'}
      </Button>
    </form>
  );
}

/**
 * IA-10 — the moderator's two options on a report.
 *
 * Removing needs a reason and dismissing does not, which is the right way
 * round: taking something down is the act that has to be explainable
 * afterwards, both to the person who wrote it and to whoever asks later why
 * a channel looks the way it does.
 */
export function ModerationDecision({ postId, reportId }: { postId: string; reportId: string }) {
  const router = useRouter();
  const [removeState, removeAction, removing] = useActionState<ActionState, FormData>(
    removePost,
    undefined,
  );
  const [dismissState, dismissAction, dismissing] = useActionState<ActionState, FormData>(
    dismissReport,
    undefined,
  );

  const state = removeState ?? dismissState;

  useEffect(() => {
    if (removeState?.notice || dismissState?.notice) router.refresh();
  }, [removeState?.notice, dismissState?.notice, router]);

  return (
    <div>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not recorded">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <form action={removeAction}>
          <input type="hidden" name="postId" value={postId} />
          <Field
            label="Remove it, and say why"
            name="reason"
            inputId={`remove-${reportId}`}
            helper="Shown in the channel where the post was, so the thread is not left with a hole in it."
          >
            <Input id={`remove-${reportId}`} name="reason" />
          </Field>
          <Button type="submit" size="dense" variant="secondary" disabled={removing}>
            {removing ? 'Removing' : 'Remove the post'}
          </Button>
        </form>

        <form action={dismissAction}>
          <input type="hidden" name="reportId" value={reportId} />
          <p className="t-body-sm mt-0 mb-3 text-ink-700">
            Or close the report and leave the post where it is. Nothing is shown in the channel.
          </p>
          <Button type="submit" size="dense" variant="tertiary" disabled={dismissing}>
            {dismissing ? 'Closing' : 'Nothing wrong with it'}
          </Button>
        </form>
      </div>
    </div>
  );
}
