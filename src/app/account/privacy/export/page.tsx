import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { assembleSubjectData } from '@/modules/compliance/dsr';
import { Footer, TopBar } from '@/components/shell';
import { Banner, LinkButton, Panel, Record } from '@/components/ui';

/**
 * ST-16 my data (CMP-07).
 *
 * §6.6: "Most requests should never become tickets." So this shows what the
 * export contains before it is downloaded, rather than offering an opaque
 * button — a subject access request people can answer themselves is worth
 * more than a fast queue.
 *
 * It is also honest about what is not included and why, because an export
 * that quietly omits things is worse than one that explains its edges.
 */
export default async function MyDataPage() {
  const me = await requireUser();
  const data = await assembleSubjectData(me.userId);
  if (!data) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Account details', value: '1 record — name, email, phone, status, sign-in history' },
    { label: 'Consent decisions', value: `${data.consents.length} recorded, with the wording shown at the time` },
    { label: 'Applications', value: data.applications.length ? data.applications.map((a) => a.institution).join(', ') : 'None' },
    { label: 'Uploaded documents', value: `${data.documents.length} listed — file names, sizes and deletion dates` },
    { label: 'Enrolments', value: data.enrolments.length ? data.enrolments.map((e) => e.matricNumber).join(', ') : 'None' },
    { label: 'Payments', value: `${data.payments.length} — reference, amount and status` },
    { label: 'Results', value: `${data.results.length} graded submissions, with feedback` },
  ];

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-10">
        <p className="t-body-sm m-0">
          <Link href="/account/privacy" className="text-ink-700 underline underline-offset-2">
            Back to privacy settings
          </Link>
        </p>

        <h1 className="t-h1 mt-4 text-ink-900">Your data</h1>
        <p className="t-body measure mt-3 mb-8 text-ink-700">
          Everything this platform holds about you, as a single file. You do not need to ask
          anyone, and you do not need to give a reason.
        </p>

        <Record title="What the file contains" meta="Machine-readable JSON, portable to another provider">
          <dl className="t-body-sm m-0 grid grid-cols-[200px_1fr] gap-x-5 gap-y-2 text-ink-900">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-ink-700">{r.label}</dt>
                <dd className="m-0">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Record>

        <div className="mt-8">
          <Banner tone="info" title="What is not in it, and why">
            <ul className="m-0 list-disc pl-5">
              <li>
                <strong>Your password.</strong> It is stored only as an Argon2id hash and cannot be
                read back — not by us either.
              </li>
              <li>
                <strong>The files themselves.</strong> Documents are listed with their names and
                dates; download the originals from your application, where each link is
                short-lived and logged.
              </li>
              <li>
                <strong>Card details.</strong> These never reached this platform. Paystack holds
                them; we hold a reference and an amount.
              </li>
            </ul>
          </Banner>
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-4">
          {/* A plain link, not a fetch-and-blob: it works without JavaScript,
              and the browser handles the download the way the user expects. */}
          <LinkButton href="/api/account/export" download>
            Download my data
          </LinkButton>
          <p className="t-body-sm m-0 text-ink-700">This download is recorded in the audit log.</p>
        </div>

        <div className="mt-12 grid gap-6">
          <Panel title="Correcting something">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              If something here is wrong, most of it you can fix yourself on your profile. Details
              on a submitted application are locked because the registry has assessed them — ask
              them to correct it and the change is recorded against your file.
            </p>
            <Link href="/account" className="t-body-sm text-ink-900 underline underline-offset-2">
              Your profile
            </Link>
          </Panel>

          <Panel title="If you want something deleted">
            <p className="t-body-sm mt-0 mb-3 text-ink-700">
              Documents from an unsuccessful application are deleted automatically on the retention
              schedule. Your academic record, if you have one, is kept — that is the legitimate
              exception to erasure, and a request to delete it will be refused with the reason in
              writing rather than quietly ignored.
            </p>
            <Link href="/dpo/request" className="t-body-sm text-ink-900 underline underline-offset-2">
              Make a request to the Data Protection Officer
            </Link>
          </Panel>
        </div>

        <p className="t-caption mt-10 text-ink-700">
          Signed in as {me.email}. A request handled by a person is answered within 30 days.
        </p>
      </main>
      <Footer />
    </>
  );
}
