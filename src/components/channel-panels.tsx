'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Select, Textarea } from './ui';
import type { ActionState } from './form';
import { postToChannel, reportPost } from '@/modules/alumni/channel-actions';

/** AL-05 — writing into your own school's channel. */
export function ChannelComposer({ institutionId }: { institutionId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    postToChannel,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <form action={formAction}>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not posted">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <Field
        label="Say something"
        name="body"
        inputId="channel-body"
        required
        helper="Everyone who graduated from this university sees it. Nobody from another one does."
      >
        <Textarea id="channel-body" name="body" rows={4} required />
      </Field>

      <input type="hidden" name="institutionId" value={institutionId} />
      <Button type="submit" size="dense" disabled={pending} aria-busy={pending}>
        {pending ? 'Posting' : 'Post'}
      </Button>
    </form>
  );
}

/**
 * AL-08 — reporting a post (ALM-08).
 *
 * Deliberately a disclosure rather than a modal: a modal needs focus
 * trapping, an escape route and a return path, and this needs none of those
 * to do its job. It is also on every post rather than hidden behind a menu,
 * because a reporting control nobody can find is a moderation policy nobody
 * can use.
 */
export function ReportControl({
  postId,
  institutionId,
}: {
  postId: string;
  institutionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    reportPost,
    undefined,
  );

  if (state?.notice) {
    return (
      <p className="t-caption mt-3 mb-0 text-verified-text" role="status">
        {state.notice}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="motion-state t-caption mt-3 text-ink-700 underline underline-offset-2 hover:text-ink-900"
      >
        Report this post
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-4 border-t border-ink-700/20 pt-4">
      {state?.error ? (
        <div className="mb-3">
          <Banner tone="danger" title="Not reported">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="institutionId" value={institutionId} />

      <Field label="What is wrong with it" name="reason" inputId={`reason-${postId}`} required>
        <Select id={`reason-${postId}`} name="reason" required defaultValue="abusive">
          <option value="abusive">Abusive or harassing</option>
          <option value="personal_data">It contains someone&apos;s personal data</option>
          <option value="off_topic">Off topic for this channel</option>
          <option value="spam">Spam or advertising</option>
          <option value="other">Something else</option>
        </Select>
      </Field>

      <Field label="Anything else the moderator should know" name="detail" inputId={`detail-${postId}`}>
        <Textarea id={`detail-${postId}`} name="detail" rows={2} />
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="dense" variant="secondary" disabled={pending}>
          {pending ? 'Sending' : 'Send the report'}
        </Button>
        <Button type="button" size="dense" variant="tertiary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
