import Link from 'next/link';
import { TopBar, Footer } from '@/components/shell';
import { Banner, LinkButton } from '@/components/ui';

/**
 * PB-08's failure states (SSO-02).
 *
 * §5 lists them: verifying, token expired, token replayed, signature invalid,
 * unknown student identifier. Each gets its own sentence, because they are
 * five different problems with five different fixes — and because "something
 * went wrong" sends a student to a university IT desk that cannot help them.
 *
 * What every state shares is a way forward. A student blocked by a portal's
 * clock drift must never be stuck: logging in here directly always works, and
 * that is the first thing on the page.
 */
const STATES: Record<string, { title: string; detail: string; offerLogin?: boolean }> = {
  missing: {
    title: 'This link is incomplete',
    detail: 'It arrived without a token. Your university portal should have included one.',
  },
  malformed: {
    title: 'This link is not valid',
    detail: 'The token could not be read. It may have been truncated by an email client or a chat app.',
  },
  unsupported_algorithm: {
    title: 'This link is not valid',
    detail:
      'The token is not signed the way a handoff has to be signed. Your university IT team will recognise this one.',
  },
  bad_signature: {
    title: 'This link could not be verified',
    detail:
      'The signature does not match the key we hold for this university. Either the key has changed or the link was altered in transit.',
  },
  expired: {
    title: 'This link has expired',
    detail:
      'Handoff links last two minutes by design. Go back to your university portal and click through again.',
  },
  replayed: {
    title: 'This link has already been used',
    detail:
      'Each link works once. That is deliberate — a link sitting in a browser history would otherwise be a way into your account.',
  },
  unknown_student: {
    title: 'No account matches this link',
    detail:
      'Your university portal says you are a student, but there is no account here with that address. An account is created when you are admitted, never by a link.',
    offerLogin: false,
  },
  not_configured: {
    title: 'This university has no portal handoff',
    detail: 'Nothing is set up for this institution, so no link from a portal can sign you in here.',
  },
};

export default async function HandoffFailed({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const state = STATES[reason ?? ''] ?? STATES.malformed;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-16">
        <h1 className="t-h1 m-0 text-ink-900">{state.title}</h1>

        <div className="mt-8">
          <Banner tone="warning" title="What happened">
            <p>{state.detail}</p>
          </Banner>
        </div>

        <p className="t-body mt-8 text-ink-700">
          Nothing is wrong with your account. Links from a university portal are deliberately
          short-lived and single-use, so the usual fix is to start again from the portal — or to
          sign in here directly, which always works.
        </p>

        <div className="mt-12 flex flex-wrap gap-4">
          {state.offerLogin === false ? null : <LinkButton href="/login">Log in instead</LinkButton>}
          <Link
            href="/programmes"
            className="t-body-sm self-center text-ink-700 underline underline-offset-2"
          >
            Back to the programme
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
