'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, lessons, modules, programmes } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { bandsProblem, sortBands, type Band } from '@/lib/grading';
import type { FormState } from '../auth/actions';

/**
 * IA-02 programme & module setup (LRN-01).
 *
 * The shape LRN-01 asks for is Programme → Semester → Module, and until now
 * nothing in the application could create a module at all: the seed made them
 * and a real institution had no way to. SA-01 provisions a programme shell and
 * tells the institution to configure it themselves, which was an instruction
 * with nowhere to carry it out.
 *
 * What this screen deliberately does **not** do is publish. Publishing is the
 * facilitator's at FC-02, gated on the module actually having content, and an
 * administrator publishing an empty module from here would put a students'
 * module list in front of people with nothing behind it. Structure is set
 * here; what goes inside it is set by the person who teaches it.
 */

async function theProgramme(institutionId: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx.select().from(programmes).where(eq(programmes.institutionId, institutionId)).limit(1),
  );
  return row ?? null;
}

/** The programme record itself — what PB-03 and the landing page render. */
export async function saveProgramme(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  const entryRequirements = String(form.get('entryRequirements') ?? '').trim();
  const durationMonths = Number(form.get('durationMonths') ?? 12);

  if (title.length < 6) {
    return { error: 'Give the programme its full title — it is printed on every certificate.' };
  }
  if (!Number.isInteger(durationMonths) || durationMonths < 3 || durationMonths > 60) {
    return { error: 'Duration is a whole number of months between 3 and 60.' };
  }
  /*
   * Entry requirements are not optional in practice: PB-01 and PB-03 render
   * them to candidates deciding whether to pay an application fee, and the
   * fallback text there says "Published by the institution", which is a
   * promise this is the screen that keeps.
   */
  if (entryRequirements.length < 20) {
    return {
      error:
        'Say who may apply, in a sentence or two. Candidates read this before paying an application fee, and the public page currently says you will publish it.',
    };
  }

  const programme = await theProgramme(institution.id);
  if (!programme) return { error: 'This institution has no programme record.' };

  await withTenant(institution.id, (tx) =>
    tx
      .update(programmes)
      .set({
        title,
        summary: summary || null,
        entryRequirements,
        durationMonths,
      })
      .where(eq(programmes.id, programme.id)),
  );

  await audit({
    action: 'programme.updated',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'programmes',
    entityId: programme.id,
    detail: { title, durationMonths },
  });

  return { redirectTo: '/admin/programme?saved=programme' };
}

/**
 * The grading scheme. Bands arrive as parallel `bandLabel`/`bandMin` fields,
 * which is what a repeating row of inputs posts.
 */
export async function saveGradingScheme(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const labels = form.getAll('bandLabel').map((v) => String(v));
  const mins = form.getAll('bandMin').map((v) => String(v));

  const bands: Band[] = labels
    .map((label, i) => ({
      label: label.trim(),
      // An empty row is how somebody deletes a band, so a blank pair is
      // dropped rather than reported as an error.
      minPercent: mins[i] === undefined || mins[i].trim() === '' ? Number.NaN : Number(mins[i]),
    }))
    .filter((b) => b.label !== '' || Number.isFinite(b.minPercent));

  const problem = bandsProblem(bands);
  if (problem) return { error: problem };

  const programme = await theProgramme(institution.id);
  if (!programme) return { error: 'This institution has no programme record.' };

  await withTenant(institution.id, (tx) =>
    tx
      .update(programmes)
      .set({ gradingBands: sortBands(bands) })
      .where(eq(programmes.id, programme.id)),
  );

  await audit({
    action: 'programme.grading_scheme_set',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'programmes',
    entityId: programme.id,
    // Worth recording in full: a classification on somebody's transcript is
    // read through whichever scheme was in force, and this is the only record
    // of what that was.
    detail: { bands: sortBands(bands) },
  });

  return { redirectTo: '/admin/programme?saved=grading' };
}

/** A module in a semester. Code is the thing students and registrars quote. */
export async function addModule(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const code = String(form.get('code') ?? '')
    .trim()
    .toUpperCase();
  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  const semester = Number(form.get('semester') ?? 1);
  const facilitatorId = String(form.get('facilitatorId') ?? '');

  if (!/^[A-Z]{2,6}[ -]?\d{2,4}$/.test(code)) {
    return { error: 'A module code is letters then numbers — DPP 501, or DPP-501.' };
  }
  if (title.length < 4) return { error: 'Give the module a title.' };
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
    return { error: 'Semester is a whole number between 1 and 8.' };
  }

  const programme = await theProgramme(institution.id);
  if (!programme) return { error: 'This institution has no programme record.' };

  const existing = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.programmeId, programme.id)),
  );
  if (existing.some((m) => m.code.replace(/[ -]/g, '') === code.replace(/[ -]/g, ''))) {
    return { error: `${code} already exists. Module codes appear on transcripts and cannot repeat.` };
  }

  const inSemester = existing.filter((m) => m.semester === semester);

  await withTenant(institution.id, (tx) =>
    tx.insert(modules).values({
      institutionId: institution.id,
      programmeId: programme.id,
      code,
      title,
      summary: summary || null,
      semester,
      position: inSemester.length + 1,
      facilitatorId: facilitatorId || null,
      // Never published on creation. There is nothing in it yet.
      published: false,
    }),
  );

  await audit({
    action: 'module.created',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'modules',
    detail: { code, title, semester },
  });

  return { redirectTo: `/admin/programme?added=${encodeURIComponent(code)}` };
}

/** Retitle a module, move it between semesters, or hand it to somebody. */
export async function updateModule(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  const semester = Number(form.get('semester') ?? 1);
  const facilitatorId = String(form.get('facilitatorId') ?? '');

  if (title.length < 4) return { error: 'Give the module a title.' };
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
    return { error: 'Semester is a whole number between 1 and 8.' };
  }

  const [module] = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!module) return { error: 'That module does not exist here.' };

  await withTenant(institution.id, (tx) =>
    tx
      .update(modules)
      .set({
        title,
        summary: summary || null,
        semester,
        facilitatorId: facilitatorId || null,
      })
      .where(eq(modules.id, moduleId)),
  );

  await audit({
    action: 'module.updated',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'modules',
    entityId: moduleId,
    detail: {
      code: module.code,
      semesterMoved: module.semester !== semester ? { from: module.semester, to: semester } : null,
      facilitatorChanged: (module.facilitatorId ?? '') !== facilitatorId,
    },
  });

  return { redirectTo: `/admin/programme?updated=${encodeURIComponent(module.code)}` };
}

/** Order within a semester — the order a student reads the programme in. */
export async function moveModule(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  await requireRole('institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');
  const direction = String(form.get('direction') ?? '');
  if (direction !== 'up' && direction !== 'down') return { error: 'Unknown direction.' };

  const [module] = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!module) return { error: 'That module does not exist here.' };

  await withTenant(institution.id, async (tx) => {
    const siblings = await tx
      .select()
      .from(modules)
      .where(and(eq(modules.programmeId, module.programmeId), eq(modules.semester, module.semester)))
      .orderBy(asc(modules.position), asc(modules.code));

    const index = siblings.findIndex((m) => m.id === moduleId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return;

    const reordered = [...siblings];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    // Rewritten from 1 rather than swapping two values, so a list that was
    // already inconsistent comes out consistent.
    for (const [i, m] of reordered.entries()) {
      await tx.update(modules).set({ position: i + 1 }).where(eq(modules.id, m.id));
    }
  });

  return { redirectTo: '/admin/programme?reordered=1' };
}

/**
 * Removing a module. Refused once anything has been taught in it: lessons and
 * assessments cascade, and the grades hanging off those assessments are
 * somebody's record of what they did. Unpublishing hides a module; deleting
 * one that students have worked in destroys evidence.
 */
export async function removeModule(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');

  const moduleId = String(form.get('moduleId') ?? '');

  const [module] = await withTenant(institution.id, (tx) =>
    tx.select().from(modules).where(eq(modules.id, moduleId)).limit(1),
  );
  if (!module) return { error: 'That module does not exist here.' };

  const [counted] = await withTenant(institution.id, (tx) =>
    tx
      .select({
        lessons: sql<number>`(SELECT count(*) FROM ${lessons} WHERE ${lessons.moduleId} = ${moduleId})::int`,
        assessments: sql<number>`(SELECT count(*) FROM ${assessments} WHERE ${assessments.moduleId} = ${moduleId})::int`,
      })
      .from(modules)
      .where(eq(modules.id, moduleId)),
  );

  const lessonCount = Number(counted?.lessons ?? 0);
  const assessmentCount = Number(counted?.assessments ?? 0);
  if (lessonCount > 0 || assessmentCount > 0) {
    return {
      error: `${module.code} has ${lessonCount} ${
        lessonCount === 1 ? 'lesson' : 'lessons'
      } and ${assessmentCount} ${
        assessmentCount === 1 ? 'assessment' : 'assessments'
      } in it. Deleting it would take the grades attached to them as well. Ask its facilitator to unpublish it instead.`,
    };
  }

  await withTenant(institution.id, (tx) => tx.delete(modules).where(eq(modules.id, moduleId)));

  await audit({
    action: 'module.deleted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'modules',
    entityId: moduleId,
    detail: { code: module.code, title: module.title },
  });

  return { redirectTo: `/admin/programme?removed=${encodeURIComponent(module.code)}` };
}
