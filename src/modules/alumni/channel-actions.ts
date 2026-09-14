'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '@/db';
import { channelPosts, contentReports } from '@/db/schema';
import { requireUser, requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/ratelimit';
import { mayEnterChannel } from './queries';
import type { FormState } from '../auth/actions';

/**
 * AL-05 and IA-10 — the school channel (ALM-10, ALM-11, ALM-08, ALM-12).
 *
 * ALM-12 is the sentence this module exists to satisfy: a School A alumnus
 * "can see School B graduates in the directory but cannot enter School B's
 * channel — enforced server-side, not by hiding the link". So every function
 * here checks membership of the institution whose channel it is, and only
 * then opens a tenant-scoped transaction. Not rendering a link is decoration;
 * this is the control.
 */

/** AL-05. An alumnus posts into their own school's channel. */
export async function postToChannel(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institutionId = String(form.get('institutionId') ?? '');
  const body = String(form.get('body') ?? '').trim();

  if (!(await mayEnterChannel(me.userId, institutionId))) {
    // The same answer a stranger gets from the page: not "you may not", which
    // would confirm the channel exists and that they are outside it.
    return { error: 'That channel is not yours to post in.' };
  }

  if (body.length < 10) return { error: 'Write something for the channel.' };
  if (body.length > 4000) return { error: 'Keep it under four thousand characters.' };

  // §5.8 warns that a community is a product. A rate limit is the cheapest
  // thing standing between a channel and one person's bad afternoon.
  if (!rateLimit(`channel:${me.userId}`, 10, 60 * 60_000).allowed) {
    return { error: 'You have posted a lot in the last hour. Give it a rest and come back.' };
  }

  await withTenant(institutionId, (tx) =>
    tx.insert(channelPosts).values({
      institutionId,
      authorId: me.userId,
      kind: 'post',
      body,
    }),
  );

  await audit({
    action: 'channel.posted',
    institutionId,
    actorId: me.userId,
    actorRole: 'alumni',
    entity: 'channel_posts',
  });

  return { notice: 'Posted to your school channel.' };
}

/**
 * IA-10 / ALM-11 — an institution broadcasts to its own alumni.
 *
 * "Own alumni only" is not a filter applied at send time: the broadcast is a
 * row in that institution's channel, which only its alumni can read. There is
 * no version of this that reaches another school's graduates, because there
 * is nowhere for it to go.
 */
export async function broadcast(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');

  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();

  if (title.length < 4) return { error: 'Give the broadcast a subject line.' };
  if (body.length < 20) return { error: 'Write the message.' };

  await withTenant(institution.id, (tx) =>
    tx.insert(channelPosts).values({
      institutionId: institution.id,
      authorId: me.userId,
      kind: 'broadcast',
      title,
      body,
    }),
  );

  await audit({
    action: 'channel.broadcast',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'channel_posts',
    detail: { title },
  });

  return { notice: 'Broadcast to your alumni. It is in their school channel now.' };
}

/** AL-08 / ALM-08 — anyone in the channel can report what is in it. */
export async function reportPost(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const postId = String(form.get('postId') ?? '');
  const institutionId = String(form.get('institutionId') ?? '');
  const reason = String(form.get('reason') ?? '') as
    | 'abusive'
    | 'personal_data'
    | 'off_topic'
    | 'spam'
    | 'other';
  const detail = String(form.get('detail') ?? '').trim();

  if (!(await mayEnterChannel(me.userId, institutionId))) {
    return { error: 'That channel is not yours.' };
  }
  if (!['abusive', 'personal_data', 'off_topic', 'spam', 'other'].includes(reason)) {
    return { error: 'Choose a reason.' };
  }

  await withTenant(institutionId, (tx) =>
    tx.insert(contentReports).values({
      institutionId,
      postId,
      reporterId: me.userId,
      reason,
      detail: detail || null,
    }),
  );

  await audit({
    action: 'channel.reported',
    institutionId,
    actorId: me.userId,
    actorRole: 'alumni',
    entity: 'channel_posts',
    entityId: postId,
    detail: { reason },
  });

  return {
    notice:
      'Reported. Your institution’s moderator sees it, and you are told nothing further about who posted it.',
  };
}

/** IA-10 — a moderator removes a post, with a reason that is kept. */
export async function removePost(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');

  const postId = String(form.get('postId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  if (reason.length < 8) {
    return { error: 'Record why. A moderation decision with no reason is indistinguishable from a bug.' };
  }

  const removed = await withTenant(institution.id, (tx) =>
    tx
      .update(channelPosts)
      .set({ removedAt: new Date(), removedReason: reason, removedBy: me.userId })
      .where(and(eq(channelPosts.id, postId), isNull(channelPosts.removedAt)))
      .returning({ id: channelPosts.id }),
  );

  if (removed.length === 0) return { error: 'That post has already been removed.' };

  // Reports about it are closed by the same act: a moderator who removed the
  // post has answered every report about it.
  await withTenant(institution.id, (tx) =>
    tx
      .update(contentReports)
      .set({ resolvedAt: new Date() })
      .where(and(eq(contentReports.postId, postId), isNull(contentReports.resolvedAt))),
  );

  await audit({
    action: 'channel.post_removed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'channel_posts',
    entityId: postId,
    detail: { reason },
  });

  return { notice: 'Removed. The space it occupied says a moderator removed it, and why.' };
}

/** IA-10 — dismissing a report without removing the post. */
export async function dismissReport(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin', 'registry');
  const reportId = String(form.get('reportId') ?? '');

  await withTenant(institution.id, (tx) =>
    tx
      .update(contentReports)
      .set({ resolvedAt: new Date() })
      .where(eq(contentReports.id, reportId)),
  );

  await audit({
    action: 'channel.report_dismissed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'content_reports',
    entityId: reportId,
  });

  return { notice: 'Closed, with the post left where it is.' };
}
