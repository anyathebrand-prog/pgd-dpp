import Link from 'next/link';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { alumniProfiles, channelPosts, contentReports, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, EmptyState, Panel, Record } from '@/components/ui';
import { BroadcastForm, ModerationDecision } from '@/components/moderation-panels';

/**
 * IA-10 alumni channel and broadcast (ALM-11, ALM-08).
 *
 * Two jobs on one screen because they are one person's job: an institution
 * admin talks to their graduates and moderates what those graduates say to
 * each other. Splitting them would mean a moderation queue nobody opens.
 *
 * "Broadcast to own alumni only" needs no filter at send time — the broadcast
 * is a row in this institution's channel, which only this institution's
 * alumni can read. There is no version that reaches another school, because
 * there is nowhere for it to go.
 */
export default async function AlumniAdmin() {
  const institution = await requireInstitution();
  await requireRole('institution_admin', 'registry');

  const open = await withTenant(institution.id, (tx) =>
    tx
      .select({ report: contentReports, post: channelPosts })
      .from(contentReports)
      .innerJoin(channelPosts, eq(channelPosts.id, contentReports.postId))
      .where(and(eq(contentReports.institutionId, institution.id), isNull(contentReports.resolvedAt)))
      .orderBy(desc(contentReports.createdAt)),
  );

  const recent = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.institutionId, institution.id))
      .orderBy(desc(channelPosts.createdAt))
      .limit(10),
  );

  // `alumni_profiles` is shared: an alumnus belongs to the platform as much
  // as to the institution that taught them, and the directory is national.
  const [{ n: graduates }] = await db
    .select({ n: count() })
    .from(alumniProfiles)
    .where(eq(alumniProfiles.institutionId, institution.id));

  const [{ n: listed }] = await db
    .select({ n: count() })
    .from(alumniProfiles)
    .where(
      and(
        eq(alumniProfiles.institutionId, institution.id),
        eq(alumniProfiles.directoryVisible, true),
      ),
    );

  const authorIds = [...new Set([...open.map((o) => o.post.authorId), ...recent.map((p) => p.authorId)].filter(Boolean))] as string[];
  const authors = authorIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, authorIds))
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return 'Someone since departed';
    const person = authors.find((a) => a.id === id);
    return person?.fullName ?? person?.email ?? 'An alumnus';
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="t-h1 m-0 text-ink-900">Alumni</h1>
        <p className="t-caption m-0 text-ink-700">
          {graduates} {graduates === 1 ? 'graduate' : 'graduates'} · {listed} listed nationally
        </p>
      </div>

      {open.length > 0 ? (
        <div className="mb-8">
          <Banner tone="warning" title={`${open.length} report${open.length === 1 ? '' : 's'} waiting`}>
            <p>
              Someone in your channel flagged a post. Removing one takes a reason, which the
              channel shows where the post was — a thread with a hole in it is more unsettling than
              one that says a moderator was here.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
        <div>
          <h2 className="t-h2 m-0 mb-4 text-ink-900">Reports</h2>
          {open.length === 0 ? (
            <EmptyState heading="Nothing reported">
              Alumni can report any post in your channel. What arrives here is what one of them
              thought needed a moderator.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-6 p-0">
              {open.map(({ report, post }) => (
                <Record
                  as="li"
                  key={report.id}
                  title={`Reported as ${report.reason.replace(/_/g, ' ')}`}
                  meta={`Posted by ${nameOf(post.authorId)} on ${post.createdAt.toLocaleDateString('en-NG')} · reported ${report.createdAt.toLocaleDateString('en-NG')}`}
                >
                  <p className="t-body-sm mt-0 mb-4 whitespace-pre-line text-ink-900">{post.body}</p>
                  {report.detail ? (
                    <p className="t-body-sm mt-0 mb-4 text-ink-700">
                      What the reporter added: {report.detail}
                    </p>
                  ) : null}
                  <ModerationDecision postId={post.id} reportId={report.id} />
                </Record>
              ))}
            </ul>
          )}

          <h2 className="t-h2 mt-12 mb-4 text-ink-900">Lately in the channel</h2>
          <ul className="m-0 grid list-none gap-3 p-0">
            {recent.map((post) => (
              <li key={post.id} className="border-b border-ink-300 pb-3">
                <p className="t-body-sm m-0 text-ink-900">
                  {post.removedAt ? <s>{post.body.slice(0, 120)}</s> : post.body.slice(0, 120)}
                  {post.body.length > 120 ? '…' : ''}
                </p>
                <p className="t-caption m-0 text-ink-700">
                  {post.kind === 'broadcast' ? 'Broadcast' : nameOf(post.authorId)} ·{' '}
                  {post.createdAt.toLocaleDateString('en-NG')}
                  {post.removedAt ? ` · removed: ${post.removedReason}` : ''}
                </p>
              </li>
            ))}
            {recent.length === 0 ? (
              <li className="t-body-sm text-ink-700">Nobody has posted yet.</li>
            ) : null}
          </ul>
        </div>

        <aside className="space-y-6">
          <Panel title="Broadcast to your alumni">
            <BroadcastForm />
          </Panel>

          <Panel title="What you can and cannot see">
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              Your own graduates, and your own channel. The national directory is not yours to
              moderate, and another university&apos;s channel is not yours to read — the same rule
              that stops them reading this one.
            </p>
          </Panel>
        </aside>
      </div>

      <p className="t-body-sm mt-10">
        <Link href="/admin" className="text-ink-700 underline underline-offset-2">
          Back to the console
        </Link>
      </p>
    </>
  );
}
