import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { consentRecords } from '@/db/schema';
import { requireUser, clientIp } from '@/lib/auth';
import { currentInstitution } from '@/lib/tenant';
import { CONSENT_PURPOSES, currentNoticeVersion } from '@/lib/consent';
import { audit } from '@/lib/audit';
import { hashIp } from '@/lib/crypto';
import { TopBar, Footer } from '@/components/shell';
import { Banner, Button, DataString, Panel } from '@/components/ui';

/**
 * ST-15 privacy and consent settings (CMP-06).
 *
 * Withdrawing has to be exactly as easy as granting, which means the same
 * control in the same place, not an email address to write to. The required
 * consent is shown as locked with its reason and a route to act on it, rather
 * than hidden — §6 calls that the Locked state, and pretending the row does not
 * exist would misrepresent what we hold.
 */
export default async function PrivacySettings() {
  const me = await requireUser();
  const institution = await currentInstitution();
  const version = await currentNoticeVersion();

  const history = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, me.userId))
    .orderBy(desc(consentRecords.recordedAt));

  const latest = new Map<string, (typeof history)[number]>();
  for (const r of history) if (!latest.has(r.purpose)) latest.set(r.purpose, r);

  async function updateConsent(form: FormData) {
    'use server';
    const me2 = await requireUser();
    const inst = await currentInstitution();
    const v = await currentNoticeVersion();
    const { headers } = await import('next/headers');
    const h = await headers();

    // Every change writes a NEW row. Consent history is append-only — an
    // auditor asks what was true on a date, and an overwritten row cannot
    // answer that.
    const changed = CONSENT_PURPOSES.filter((p) => !p.required).map((p) => ({
      institutionId: inst?.id ?? null,
      userId: me2.userId,
      purpose: p.key,
      granted: form.get(p.key) === 'on',
      noticeVersion: v,
      purposeTextShown: `${p.title} — ${p.text}`,
      ipHash: hashIp(clientIp(h)),
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    }));

    await db.insert(consentRecords).values(changed);
    await audit({
      action: 'consent.updated',
      institutionId: inst?.id ?? null,
      actorId: me2.userId,
      subjectId: me2.userId,
      detail: { noticeVersion: v, changed: changed.map((c) => ({ purpose: c.purpose, granted: c.granted })) },
    });
  }

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Privacy and consent</h1>
        <p className="t-body mt-3 mb-10 text-ink-700">
          What you have agreed to, and what you can change. Withdrawing a consent takes effect
          immediately and never affects your standing on the programme.
        </p>

        <form action={updateConsent}>
          <ul className="m-0 grid list-none gap-4 p-0">
            {CONSENT_PURPOSES.map((p) => {
              const record = latest.get(p.key);
              return (
                <li key={p.key} className="rounded-md bg-record p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <h2 className="t-h4 m-0 text-ink-900">{p.title}</h2>
                      <p className="t-body-sm mt-2 mb-2 text-ink-700">{p.text}</p>
                      <p className="t-caption m-0 text-ink-700">
                        {record
                          ? `${record.granted ? 'Granted' : 'Declined'} on ${record.recordedAt.toLocaleDateString('en-NG')} against notice v${record.noticeVersion}`
                          : 'No decision recorded'}
                      </p>
                    </div>
                    {p.required ? (
                      // Locked: read-only plus a reason plus a route to act.
                      <div className="w-[180px] shrink-0 text-right">
                        <p className="t-body-sm m-0 font-semibold text-ink-900">Cannot be withdrawn here</p>
                        <p className="t-caption m-0 text-ink-700">
                          Withdrawing this means ending your relationship with the institution.{' '}
                          <Link href="/account/close" className="text-ink-700 underline underline-offset-2">
                            Close my account
                          </Link>
                        </p>
                      </div>
                    ) : (
                      <label className="flex shrink-0 items-center gap-2">
                        <span className="sr-only">{p.title}</span>
                        <input
                          type="checkbox"
                          name={p.key}
                          defaultChecked={record?.granted ?? false}
                          className="h-11 w-11 accent-[#6B2436]"
                        />
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-16">
            <Button type="submit">Save my choices</Button>
          </div>
        </form>

        <div className="mt-16 grid gap-6">
          <Panel title="Your rights under the NDPA">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              You can ask for a copy of your data, have it corrected, have it deleted where the law
              allows, object to processing, or ask for it in a portable format. A request is
              answered within 30 days.
            </p>
            <ul className="m-0 list-none space-y-2 p-0">
              <li>
                <Link href="/account/privacy/export" className="t-body-sm text-ink-900 underline underline-offset-2">
                  Download everything we hold about you
                </Link>
              </li>
              <li>
                <Link href="/dpo/request" className="t-body-sm text-ink-900 underline underline-offset-2">
                  Make a request to the Data Protection Officer
                </Link>
              </li>
            </ul>
          </Panel>

          <Panel title="Consent history">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Every decision is kept, including ones you later changed. This is the record an
              auditor would be shown.
            </p>
            <ul className="m-0 list-none space-y-2 p-0">
              {history.slice(0, 10).map((r) => (
                <li key={r.id} className="t-caption text-ink-700">
                  <DataString value={r.recordedAt.toISOString().slice(0, 10)} label="Date" /> ·{' '}
                  {r.purpose.replace(/_/g, ' ')} · {r.granted ? 'granted' : 'declined'} · notice v
                  {r.noticeVersion}
                </li>
              ))}
            </ul>
          </Panel>

          {institution ? (
            <Banner tone="info" title="Who is responsible for what">
              <p>
                {institution.name} decides who is admitted and what is taught, and is the controller
                for your academic record. The platform runs the systems and is the controller for
                your account and payments. Either can take a request and route it.
              </p>
            </Banner>
          ) : null}
        </div>

        <p className="t-caption mt-10 text-ink-700">
          Current privacy notice:{' '}
          <Link href={`/privacy/v${version}`} className="text-ink-700 underline underline-offset-2">
            version {version}
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
