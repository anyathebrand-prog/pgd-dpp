import Link from 'next/link';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, sessions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { TopBar, Footer } from '@/components/shell';
import { Panel } from '@/components/ui';
import { SessionList } from '@/components/session-list';

/**
 * ST-17 active sessions (AUTH-07).
 *
 * The list exists so that "sign out everywhere" is a decision rather than a
 * guess. Two details the flow is specific about: the current session is marked
 * and cannot be ended in isolation — ending it is signing out, and calling it
 * anything else would misdescribe what just happened.
 *
 * What is deliberately absent is a location column. We hash IP addresses
 * rather than storing them (CMP-13), so "Lagos, Nigeria" would either be a
 * fabrication or a reason to start keeping something we decided not to keep.
 * A device string and a start time answer the actual question — is one of
 * these not me — without collecting more to do it.
 */
export default async function SessionsPage() {
  const me = await requireUser();

  const live = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      mfaSatisfied: sessions.mfaSatisfied,
      institution: institutions.shortName,
    })
    .from(sessions)
    .leftJoin(institutions, eq(institutions.id, sessions.institutionId))
    .where(
      and(
        eq(sessions.userId, me.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(sessions.createdAt);

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Where you are signed in</h1>
        <p className="t-body mt-3 mb-8 text-ink-700">
          Every device with a live session on this account. If one of these is not you, end it and
          change your password.
        </p>

        <SessionList
          sessions={live.map((s) => ({
            id: s.id,
            device: describe(s.userAgent),
            startedAt: s.createdAt.toLocaleString('en-NG', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
            expiresAt: s.expiresAt.toLocaleDateString('en-NG', {
              day: 'numeric',
              month: 'long',
            }),
            institution: s.institution ?? null,
            mfaSatisfied: s.mfaSatisfied,
            current: s.id === me.sessionId,
          }))}
        />

        <div className="mt-12">
          <Panel title="What we record about a session">
            <p className="t-body-sm mt-0 mb-0 text-ink-700">
              The browser string above, when the session started, and a one-way hash of the IP
              address it came from. The hash lets us spot a pattern of failed logins without
              keeping a log of where you have been — so there is no location column here, because
              there is no location to show.
            </p>
          </Panel>
        </div>

        <p className="t-body-sm mt-10">
          <Link href="/account" className="text-ink-700 underline underline-offset-2">
            Back to your account
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}

/**
 * A user agent string is not for reading. This turns it into the two facts a
 * person uses to recognise their own device, and says plainly when it cannot.
 */
function describe(ua: string | null): string {
  if (!ua) return 'Unknown device';

  const os =
    /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone or iPad'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
    : /Linux/i.test(ua) ? 'Linux'
    : null;

  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : null;

  if (os && browser) return `${browser} on ${os}`;
  return os ?? browser ?? 'Unknown device';
}
