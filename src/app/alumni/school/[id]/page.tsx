import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { channelPosts, institutions, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { BottomTabs, Footer, TopBar } from '@/components/shell';
import { Banner, EmptyState, Panel, Record } from '@/components/ui';
import { ChannelComposer, ReportControl } from '@/components/channel-panels';
import { mayEnterChannel } from '@/modules/alumni/queries';

/**
 * AL-05 school channel (ALM-10, ALM-12).
 *
 * "A School A alumnus can see School B graduates in the directory but cannot
 * enter School B's channel — enforced server-side, not by hiding the link."
 * That is this page's only real requirement, and it is met by checking
 * membership before a tenant context is opened at all: a stranger gets a 404,
 * which tells them nothing about whether the channel exists.
 *
 * Removed posts leave a marker rather than vanishing. A conversation with a
 * hole in it is confusing; a conversation that says a moderator removed
 * something, and why, is a moderation policy people can see working.
 */
export default async function SchoolChannel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  // Before anything else, and before any tenant context.
  if (!(await mayEnterChannel(me.userId, id))) notFound();

  const [institution] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, id))
    .limit(1);
  if (!institution) notFound();

  const posts = await withTenant(id, (tx) =>
    tx
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.institutionId, id))
      .orderBy(desc(channelPosts.createdAt))
      .limit(50),
  );

  const authorIds = [...new Set(posts.map((p) => p.authorId).filter(Boolean))] as string[];
  const authors = authorIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, authorIds))
    : [];
  const nameOf = (authorId: string | null) => {
    if (!authorId) return 'Someone since departed';
    const person = authors.find((a) => a.id === authorId);
    return person?.fullName ?? person?.email ?? 'An alumnus';
  };

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/alumni" className="text-ink-700 underline underline-offset-2">
            Back to the alumni home
          </Link>
        </p>

        <h1 className="t-h1 mt-4 mb-2 text-ink-900">{institution.shortName} channel</h1>
        <p className="t-body measure mb-8 text-ink-700">
          Private to {institution.name} graduates. Alumni of the other universities can find you in
          the national directory; they cannot read this.
        </p>

        <div className="mb-10">
          <Panel title="Post to your school">
            <ChannelComposer institutionId={id} />
          </Panel>
        </div>

        {posts.length === 0 ? (
          <EmptyState heading="Nothing here yet">
            Be the first. Enforcement news, a question about a DPIA, a job you have heard about —
            this is a room of people doing the same work at the same institution.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-5 p-0">
            {posts.map((post) => {
              if (post.removedAt) {
                return (
                  <li key={post.id}>
                    {/* ALM-08: removed, and visibly so. A hole in a thread is
                        more unsettling than a marker explaining it. */}
                    <div className="rounded-md border border-dashed border-ink-300 p-4">
                      <p className="t-body-sm m-0 text-ink-700">
                        A moderator removed this post on{' '}
                        {post.removedAt.toLocaleDateString('en-NG')}: {post.removedReason}
                      </p>
                    </div>
                  </li>
                );
              }

              return (
                <Record
                  as="li"
                  key={post.id}
                  title={post.kind === 'broadcast' ? (post.title ?? 'From the institution') : nameOf(post.authorId)}
                  meta={
                    post.kind === 'broadcast'
                      ? `From ${institution.shortName} · ${post.createdAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}`
                      : post.createdAt.toLocaleDateString('en-NG', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                  }
                >
                  <p className="t-body-sm mt-0 mb-0 whitespace-pre-line text-ink-900">{post.body}</p>
                  <ReportControl postId={post.id} institutionId={id} />
                </Record>
              );
            })}
          </ul>
        )}

        <div className="mt-12">
          <Banner tone="info" title="What this channel is, and is not">
            <p>
              It is a noticeboard for one university&apos;s graduates, moderated by that
              university&apos;s admin. It is not a private message system — everyone here can read
              everything, including the moderators.
            </p>
          </Banner>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
