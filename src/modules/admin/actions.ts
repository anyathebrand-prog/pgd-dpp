'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { applications, cohorts, feeItems, institutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { checkBrandColour } from '@/lib/contrast';
import type { FormState } from '../auth/actions';

const FEE_KINDS = [
  'application',
  'acceptance',
  'tuition',
  'id_card',
  'library_levy',
  'examination',
] as const;

/** Naira in, kobo out. Money is never a float on this side of the boundary. */
function parseNaira(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/* --------------------------------------------------------------------- IA-03 */

/**
 * Fee schedule.
 *
 * The app flow marks fee versioning as gap G-19: "changing a fee must not
 * alter amounts already quoted to candidates mid-application", and the PRD
 * does not say how. This does not invent a versioning scheme; it does the
 * honest thing available — counts the candidates who are mid-application,
 * tells the admin before they save, and records the change with both amounts
 * so the question is answerable later. Settled payments are unaffected either
 * way: `transaction_lines` snapshots the amount at charge time.
 */
export async function saveFee(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const kind = String(form.get('kind') ?? '') as (typeof FEE_KINDS)[number];
  const label = String(form.get('label') ?? '').trim();
  const amount = parseNaira(String(form.get('amount') ?? ''));
  const cohortId = String(form.get('cohortId') ?? '') || null;

  if (!FEE_KINDS.includes(kind)) return { error: 'Unknown fee type.' };
  if (!label) return { error: 'Give the fee a label. Candidates see it on their receipt.' };
  if (amount === null) return { error: 'Enter an amount in naira, for example 25000 or 25,000.00.' };
  if (amount <= 0) return { error: 'A fee must be greater than zero. To remove a fee, delete it.' };

  const existing = await withTenant(institution.id, (tx) =>
    tx
      .select()
      .from(feeItems)
      .where(and(eq(feeItems.institutionId, institution.id), eq(feeItems.kind, kind))),
  );
  const current = existing.find((f) => (f.cohortId ?? null) === cohortId);

  await withTenant(institution.id, async (tx) => {
    if (current) {
      await tx
        .update(feeItems)
        .set({ label, amountKobo: amount })
        .where(eq(feeItems.id, current.id));
    } else {
      await tx.insert(feeItems).values({
        institutionId: institution.id,
        cohortId,
        kind,
        label,
        amountKobo: amount,
      });
    }
  });

  await audit({
    action: 'fee.changed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'fee_items',
    entityId: current?.id ?? kind,
    detail: { kind, from: current?.amountKobo ?? null, to: amount, cohortId },
  });

  revalidatePath('/admin/fees');
  return { notice: current ? 'Fee updated.' : 'Fee added.' };
}

/** How many people are mid-application and would see a new number. */
export async function candidatesMidApplication(institutionId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(applications)
      .where(
        inArray(applications.status, ['draft', 'awaiting_application_fee', 'admitted', 'offer_accepted']),
      ),
  );
  return Number(row?.n ?? 0);
}

/* --------------------------------------------------------------------- IA-04 */

export async function saveCohort(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const id = String(form.get('cohortId') ?? '') || null;
  const name = String(form.get('name') ?? '').trim();
  const capacity = Number(form.get('capacity') ?? NaN);
  const status = String(form.get('status') ?? 'draft') as 'draft' | 'open' | 'closed' | 'running' | 'completed';

  const date = (key: string) => {
    const v = String(form.get(key) ?? '').trim();
    return v ? new Date(v) : null;
  };
  const opens = date('applicationOpensAt');
  const closes = date('applicationClosesAt');
  const starts = date('startsAt');

  if (!name) return { error: 'Give the intake a name candidates will recognise, such as "January 2027 intake".' };
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { error: 'Capacity must be a whole number of places, at least one.' };
  }
  if (opens && closes && closes <= opens) {
    return { error: 'Applications cannot close before they open.' };
  }
  if (closes && starts && starts < closes) {
    return {
      error:
        'Teaching cannot start before applications close — the registry needs time to review, and §5.1 puts the decision between the two payments.',
    };
  }

  // §5.1: capacity is enforced at offer issuance. Lowering it below the seats
  // already committed would silently oversell, so it is refused rather than
  // accepted and quietly violated.
  if (id) {
    const [held] = await withTenant(institution.id, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(
          and(
            eq(applications.cohortId, id),
            inArray(applications.status, ['admitted', 'offer_accepted', 'enrolled']),
          ),
        ),
    );
    if (Number(held?.n ?? 0) > capacity) {
      return {
        error: `${held.n} places are already committed in this cohort, so capacity cannot go below that. Offers already made are not withdrawn to fit a smaller number.`,
      };
    }
  }

  const [programme] = await withTenant(institution.id, (tx) =>
    tx.select({ id: cohorts.programmeId }).from(cohorts).limit(1),
  );

  await withTenant(institution.id, async (tx) => {
    if (id) {
      await tx
        .update(cohorts)
        .set({
          name,
          capacity,
          status,
          applicationOpensAt: opens,
          applicationClosesAt: closes,
          startsAt: starts,
        })
        .where(eq(cohorts.id, id));
    } else {
      if (!programme) throw new Error('NO_PROGRAMME');
      await tx.insert(cohorts).values({
        institutionId: institution.id,
        programmeId: programme.id,
        name,
        capacity,
        status,
        applicationOpensAt: opens,
        applicationClosesAt: closes,
        startsAt: starts,
      });
    }
  });

  await audit({
    action: id ? 'cohort.updated' : 'cohort.created',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'cohorts',
    entityId: id ?? name,
    detail: { name, capacity, status },
  });

  revalidatePath('/admin/cohorts');
  return { notice: id ? 'Intake updated.' : 'Intake created.' };
}

/* --------------------------------------------------------------------- IA-06 */

/**
 * Branding — §2.5 and conflict C-04.
 *
 * The colour is validated and **blocked**, not warned about. The brief is
 * explicit: "Do not warn-and-allow." A brand colour that fails contrast is
 * not a stylistic choice an institution gets to make, because the people it
 * fails are reading on a cheap phone in daylight, and because the platform's
 * accessibility compliance cannot depend on a university administrator's
 * colour taste.
 */
export async function saveBranding(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const input = String(form.get('brandColour') ?? '');
  const logoUrl = String(form.get('logoUrl') ?? '').trim() || null;
  const check = checkBrandColour(input);

  if (!check.passes) {
    return {
      error: check.suggestion
        ? `${check.problem} The closest colour to yours that passes is ${check.suggestion} — use that, or pick something darker.`
        : (check.problem ?? 'That colour cannot be used.'),
    };
  }

  await withTenant(institution.id, (tx) =>
    tx
      .update(institutions)
      .set({ brandColour: check.hex!, logoUrl, updatedAt: new Date() })
      .where(eq(institutions.id, institution.id)),
  );

  await audit({
    action: 'branding.changed',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'institutions',
    entityId: institution.id,
    detail: { from: institution.brandColour, to: check.hex, ratio: check.ratio.toFixed(2) },
  });

  revalidatePath('/admin/branding');
  return { notice: `Saved. ${check.hex} reaches ${check.ratio.toFixed(2)}:1 against the page.` };
}
