import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import { enrollments, institutions, memberships, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { TopBar, Footer, BottomTabs } from '@/components/shell';
import { Banner, DataString, Panel } from '@/components/ui';
import { AccountDetailsForm, ChangePasswordForm } from '@/components/account-panels';

/**
 * ST-14 profile and account.
 *
 * The purpose given in the flow is CMP-07: self-service correction that keeps
 * rectification out of the DPO queue entirely. That only works if the page is
 * honest about the fields it will not let you change — a greyed-out input with
 * no explanation sends the person to the DPO anyway, having first made them
 * feel obstructed.
 *
 * So academically locked fields say they are locked, say why, and carry the
 * route to have them corrected by someone who can.
 */
export default async function AccountPage() {
  const me = await requireUser();

  const [user] = await db.select().from(users).where(eq(users.id, me.userId)).limit(1);

  // `memberships` and `enrollments` differ in kind: the first is what you may
  // do, the second is an academic record. Only the second locks a name.
  const links = await db
    .select({
      institution: institutions.name,
      institutionId: institutions.id,
      shortName: institutions.shortName,
      role: memberships.role,
      slug: institutions.slug,
    })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(eq(memberships.userId, me.userId));

  // enrollments is tenant-scoped, so a plain `db` read here returns nothing —
  // RLS is working, and the page would quietly decide nobody is enrolled and
  // unlock a name that is printed on a certificate. One scoped read per
  // institution the person is actually attached to, which is the same
  // mechanism PB-02 uses and needs no cross-tenant exemption.
  const enrolled = (
    await Promise.all(
      [...new Set(links.map((l) => l.institutionId))].map((institutionId) =>
        withTenant(institutionId, (tx) =>
          tx
            .select({
              matricNumber: enrollments.matricNumber,
              institutionId: enrollments.institutionId,
            })
            .from(enrollments)
            .where(eq(enrollments.userId, me.userId)),
        ),
      ),
    )
  ).flat();

  const nameLocked = enrolled.length > 0;

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Your account</h1>
        <p className="t-body mt-3 mb-10 text-ink-700">
          What we hold that you can change yourself. Anything you cannot change here says why, and
          where to go instead.
        </p>

        <AccountDetailsForm
          fullName={user?.fullName ?? ''}
          phone={user?.phone ?? ''}
          email={user?.email ?? ''}
          nameLocked={nameLocked}
        />

        {nameLocked ? (
          <div className="mt-6">
            <Banner tone="info" title="Your legal name is part of an academic record">
              <p>
                It is printed on your certificate and tied to your matriculation number, so it is
                corrected by the registry rather than edited here. That is a correction request,
                and it is free.
              </p>
              <p className="mt-2">
                <Link href="/dpo/request" className="text-ink-900 underline underline-offset-2">
                  Request a correction to your name
                </Link>
              </p>
            </Banner>
          </div>
        ) : null}

        <div className="mt-12">
          <ChangePasswordForm />
        </div>

        <div className="mt-12 grid gap-6">
          <Panel title="Two-factor authentication">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              {me.totpEnrolled
                ? 'An authenticator app is set up on this account.'
                : 'Not set up. Staff accounts with registry, admin or DPO duties are required to have it; for everyone else it is optional and worth the two minutes.'}
            </p>
            <Link
              href="/security/2fa/setup"
              className="t-body-sm text-ink-900 underline underline-offset-2"
            >
              {me.totpEnrolled ? 'Replace my authenticator app' : 'Set up two-factor authentication'}
            </Link>
          </Panel>

          <Panel title="Where you are signed in">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Every device holding a live session, and a way to end any of them.
            </p>
            <Link
              href="/security/sessions"
              className="t-body-sm text-ink-900 underline underline-offset-2"
            >
              Manage active sessions
            </Link>
          </Panel>

          <Panel title="Privacy and consent">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              What you have agreed to, per purpose, and a copy of everything we hold about you.
            </p>
            <ul className="m-0 list-none space-y-2 p-0">
              <li>
                <Link
                  href="/account/privacy"
                  className="t-body-sm text-ink-900 underline underline-offset-2"
                >
                  Privacy and consent settings
                </Link>
              </li>
              <li>
                <Link
                  href="/account/privacy/export"
                  className="t-body-sm text-ink-900 underline underline-offset-2"
                >
                  Download everything we hold about you
                </Link>
              </li>
            </ul>
          </Panel>

          <Panel title="Your institutions">
            {/* SSO-04: one human, one account, even holding places at two
                universities. This is where that stops being an abstraction. */}
            <ul className="m-0 list-none space-y-3 p-0">
              {links.map((link) => {
                const matric = enrolled.find(
                  (e) => e.institutionId === link.institutionId,
                )?.matricNumber;
                return (
                  <li key={`${link.slug}-${link.role}`}>
                    <p className="t-body-sm m-0 font-semibold text-ink-900">{link.institution}</p>
                    <p className="t-caption m-0 text-ink-700">
                      {link.role.replace(/_/g, ' ')}
                      {matric ? ' · ' : ''}
                      {matric ? <DataString value={matric} label="Matriculation number" /> : null}
                    </p>
                  </li>
                );
              })}
              {links.length === 0 ? (
                <li className="t-body-sm text-ink-700">
                  No institution is linked to this account yet.
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>
      </main>
      <BottomTabs />
      <Footer />
    </>
  );
}
