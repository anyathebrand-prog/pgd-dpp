import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { Banner, Button, Field, Panel, Select, Textarea } from '@/components/ui';
import { statusLabel } from '@/modules/admissions/queue-filter';

/**
 * RG-06 applicant data export — `{school}./admin/applications/export` (APP-09).
 *
 * The flow is explicit that an export "is itself a processing activity:
 * audit-logged, with a stated purpose". So the purpose is asked for before
 * the file exists, and it travels into the audit log with the row count and
 * the filter — a copy of applicants' data leaving the system is the thing a
 * breach investigation asks about first.
 *
 * Gap G-17 leaves open whether documents go in the export. They do not.
 * Data minimisation (NDPA s.24) says an export carries what its purpose
 * needs, and no reporting purpose needs a degree certificate or a passport
 * photograph in a spreadsheet on somebody's laptop. The file carries the
 * application record; the documents stay behind their signed, logged links.
 */
export default async function ExportApplications({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const institution = await requireInstitution();
  await requireRole('registry', 'institution_admin');
  const { status, error } = await searchParams;

  return (
    <>
      <p className="t-caption m-0">
        <Link
          href={`/admin/applications${status ? `?status=${encodeURIComponent(status)}` : ''}`}
          className="text-ink-700 underline underline-offset-2"
        >
          Back to applications
        </Link>
      </p>
      <h1 className="t-h1 mt-2 mb-2 text-ink-900">Export applicants</h1>
      <p className="t-body measure mt-0 mb-8 text-ink-700">
        A CSV of {statusLabel(status)} at {institution.shortName}. Exporting is itself processing
        of their data, so it needs a stated purpose, and it is recorded against your name.
      </p>

      {error ? (
        <div className="mb-8">
          <Banner tone="danger" title="Not exported">
            <p>{error}</p>
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <Panel title="Why do you need it?">
          {/* A plain form POST: the response is a file, which a server action
              cannot hand back to the browser. */}
          <form method="post" action="/admin/applications/export/csv">
            <input type="hidden" name="status" value={status ?? ''} />
            <Field label="Purpose" name="purpose" inputId="export-purpose" required>
              <Select id="export-purpose" name="purpose" required defaultValue="">
                <option value="" disabled>
                  Choose a purpose
                </option>
                <option value="registry_reporting">Registry reporting to the university</option>
                <option value="accreditation_return">Accreditation or regulatory return</option>
                <option value="sponsor_reconciliation">Reconciling with a sponsor</option>
                <option value="other">Something else, described below</option>
              </Select>
            </Field>
            <Field
              label="Detail"
              name="note"
              inputId="export-note"
              required
              helper="Who it is for and what it will be used for. This goes into the audit log as written."
            >
              <Textarea id="export-note" name="note" rows={3} required />
            </Field>
            <Button type="submit">Download the CSV</Button>
          </form>
        </Panel>

        <aside className="space-y-6">
          <Panel title="What is in the file">
            <p className="t-body-sm mt-0 mb-2 text-ink-700">
              Reference, name, email, intake, status, and the dates it was submitted and decided.
            </p>
            <p className="t-body-sm m-0 text-ink-700">
              Not included: documents, the passport photograph, date of birth or anything from the
              personal details step. No reporting purpose needs those in a spreadsheet, and a file
              on somebody&apos;s laptop is outside every control this platform has.
            </p>
          </Panel>
          <Panel title="Once it leaves">
            <p className="t-body-sm m-0 text-ink-700">
              The copy you download is yours to protect. Delete it when the purpose is done, and do
              not forward it further than that purpose needs.
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
