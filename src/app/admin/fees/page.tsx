import { asc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { cohorts, feeItems } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { candidatesMidApplication, setInstallmentPolicy } from '@/modules/admin/actions';
import { ActionForm } from '@/components/form';
import { FeeEditor } from '@/components/admin-panels';
import { Banner, Field, Input, Naira, Panel, Select, cx } from '@/components/ui';

/**
 * IA-03 fee schedule (PAY-01).
 *
 * The app flow records gap G-19 against this screen: changing a fee must not
 * alter amounts already quoted to candidates mid-application, and the PRD
 * does not say how. Rather than invent a versioning scheme quietly, the
 * screen states the exposure — how many people are mid-application right
 * now — and the change is recorded with both amounts. Settled payments are
 * unaffected regardless: `transaction_lines` snapshots the amount charged.
 */
const KINDS = [
  { kind: 'application' as const, label: 'Application fee', note: 'Charged at submission. Non-refundable, and disclosed as such before payment.' },
  { kind: 'acceptance' as const, label: 'Acceptance fee', note: 'Charged only after an offer is accepted.' },
  { kind: 'tuition' as const, label: 'Tuition', note: 'The main charge. Part of the acceptance checkout.' },
  { kind: 'library_levy' as const, label: 'Library levy', note: 'Optional. Included in the acceptance checkout if set.' },
  { kind: 'id_card' as const, label: 'ID card', note: 'Optional.' },
  { kind: 'examination' as const, label: 'Examination fee', note: 'Optional.' },
];

export default async function FeeSchedule() {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  const fees = await withTenant(institution.id, (tx) =>
    tx.select().from(feeItems).where(eq(feeItems.institutionId, institution.id)),
  );
  const intakes = await withTenant(institution.id, (tx) =>
    tx.select().from(cohorts).orderBy(asc(cohorts.startsAt)),
  );
  const inFlight = await candidatesMidApplication(institution.id);

  const applicationFee = fees.find((f) => f.kind === 'application' && !f.cohortId);

  return (
    <>
      <h1 className="t-h1 m-0 text-ink-900">Fees</h1>
      <p className="t-body measure mt-2 mb-6 text-ink-700">
        Amounts are set per institution, and may be overridden for a single intake. A candidate is
        quoted the intake price where one exists, otherwise the institution price.
      </p>

      {!applicationFee ? (
        <div className="mb-6">
          <Banner tone="danger" title="No application fee is set">
            Nobody can submit an application until this exists — the submit step charges it. This is
            the first thing to fill in.
          </Banner>
        </div>
      ) : null}

      {inFlight > 0 ? (
        <div className="mb-6">
          <Banner tone="warning" title={`${inFlight} candidates are mid-application`}>
            <p>
              Changing a fee now changes what they are charged when they reach checkout. Anyone who
              has already paid is unaffected — that amount was recorded when it was taken. There is
              no fee versioning yet, so if a quote has to be honoured, do it before changing the
              number rather than after.
            </p>
          </Banner>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Fees currently configured</caption>
            <thead>
              <tr className="border-b border-ink-500">
                {['Fee', 'Applies to', 'Amount', 'Mandatory'].map((h) => (
                  <th key={h} scope="col" className="t-label px-3 py-3 text-ink-900">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((k, i) => {
                const institutionWide = fees.find((f) => f.kind === k.kind && !f.cohortId);
                const overrides = fees.filter((f) => f.kind === k.kind && f.cohortId);
                return (
                  <tr key={k.kind} className={cx('border-b border-ink-300', i % 2 === 1 && 'bg-ink-100/40')}>
                    <td className="px-3 py-3">
                      <span className="t-body-sm block font-semibold text-ink-900">{k.label}</span>
                      <span className="t-caption block text-ink-700">{k.note}</span>
                    </td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">
                      {institutionWide ? 'All intakes' : '—'}
                      {overrides.map((o) => (
                        <span key={o.id} className="block">
                          {intakes.find((c) => c.id === o.cohortId)?.name ?? 'One intake'}
                        </span>
                      ))}
                    </td>
                    <td className="t-data px-3 py-3 text-ink-900">
                      {institutionWide ? <Naira kobo={institutionWide.amountKobo} /> : <span className="text-ink-500">Not set</span>}
                      {overrides.map((o) => (
                        <span key={o.id} className="block">
                          <Naira kobo={o.amountKobo} />
                        </span>
                      ))}
                    </td>
                    <td className="t-body-sm px-3 py-3 text-ink-700">
                      {institutionWide?.mandatory ? 'Yes' : institutionWide ? 'No' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="space-y-6">
          <Panel title="Paying tuition in parts">
            {/* PAY-09. Off by default: the option is hidden from candidates
                entirely until an institution chooses to offer it. */}
            <p className="t-body-sm mt-0 mb-4 text-ink-700">
              {institution.tuitionInstallments > 1
                ? `Offered: ${institution.tuitionInstallments} parts, ${institution.installmentIntervalDays} days apart. Lessons pause if a later part goes unpaid past its due date.`
                : 'Not offered. Candidates see only the full payment.'}
            </p>
            <ActionForm action={setInstallmentPolicy} submitLabel="Save">
              <div className="grid gap-x-6 md:grid-cols-2">
                <Field label="Parts" name="parts" inputId="plan-parts" required>
                  <Select
                    id="plan-parts"
                    name="parts"
                    defaultValue={String(institution.tuitionInstallments)}
                  >
                    <option value="1">Full payment only</option>
                    <option value="2">Two parts</option>
                    <option value="3">Three parts</option>
                  </Select>
                </Field>
                <Field label="Days between parts" name="intervalDays" inputId="plan-interval" required>
                  <Input
                    id="plan-interval"
                    name="intervalDays"
                    type="number"
                    min={14}
                    max={180}
                    defaultValue={institution.installmentIntervalDays}
                  />
                </Field>
              </div>
            </ActionForm>
            <p className="t-caption mt-3 mb-0 text-ink-700">
              Applies to plans started from now. Anybody already on a plan keeps the dates they
              agreed to.
            </p>
          </Panel>

          <Panel title="Set a fee">
            <FeeEditor
              kinds={KINDS.map((k) => ({ kind: k.kind, label: k.label }))}
              intakes={intakes.map((c) => ({ id: c.id, name: c.name }))}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
