'use server';

import { and, desc, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { assessments, assignmentFiles, modules, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { putObject } from '@/lib/storage';
import { myPlan } from '@/modules/payments/plan';
import { assignmentFileProblem, assignmentState, canChange, isLate } from './assignment';
import type { FormState } from '../auth/actions';

/**
 * ST-07 — file-upload assignments.
 *
 * Two steps, because they are two decisions. Attaching a file saves a draft
 * the student can look at and replace; submitting sends it to the
 * facilitator's queue (FC-03) and cannot be undone. A single "upload and
 * submit" button turns a wrong-file slip into a resubmission request.
 *
 * One submission row per student per assignment. A return for revision
 * reopens that row rather than starting a new attempt, so the facilitator's
 * note and the history stay on one record.
 */

function assignmentKey(institutionId: string, assessmentId: string, userId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `institutions/${institutionId}/assignments/${assessmentId}/${userId}/${Date.now()}-${safe}`;
}

async function loadAssignment(institutionId: string, assessmentId: string, userId: string) {
  return withTenant(institutionId, async (tx) => {
    const [assessment] = await tx
      .select({ a: assessments, modulePublished: modules.published })
      .from(assessments)
      .innerJoin(modules, eq(modules.id, assessments.moduleId))
      .where(and(eq(assessments.id, assessmentId), eq(assessments.kind, 'assignment')))
      .limit(1);
    const [row] = await tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.assessmentId, assessmentId), eq(submissions.userId, userId)))
      .orderBy(desc(submissions.attempt))
      .limit(1);
    return { assessment, row: row ?? null };
  });
}

export async function saveAssignmentDraft(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const assessmentId = String(form.get('assessmentId') ?? '');
  const file = form.get('file');

  const { assessment, row } = await loadAssignment(institution.id, assessmentId, me.userId);
  if (!assessment || !assessment.a.published || !assessment.modulePublished) {
    return { error: 'This assignment is not available.' };
  }
  if ((await myPlan(institution.id, me.userId)).gated) {
    return { redirectTo: `/assignment/${assessmentId}` };
  }
  if (!canChange(assignmentState(row))) {
    return { error: 'This has already been submitted. It can only be changed if your facilitator returns it.' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose the file to attach.' };
  }

  const body = Buffer.from(await file.arrayBuffer());
  const problem = assignmentFileProblem(file, body.subarray(0, 8));
  if (problem) return { error: problem };

  const key = assignmentKey(institution.id, assessmentId, me.userId, file.name);
  await putObject(key, body);

  await withTenant(institution.id, async (tx) => {
    let submissionId = row?.id;
    if (!submissionId) {
      const [created] = await tx
        .insert(submissions)
        .values({
          institutionId: institution.id,
          assessmentId,
          userId: me.userId,
          attempt: 1,
          status: 'in_progress',
          fileObjectKey: key,
        })
        .returning({ id: submissions.id });
      submissionId = created.id;
    } else {
      await tx.update(submissions).set({ fileObjectKey: key }).where(eq(submissions.id, submissionId));
    }
    await tx.insert(assignmentFiles).values({
      institutionId: institution.id,
      submissionId,
      userId: me.userId,
      objectKey: key,
      filename: file.name.slice(-200),
      contentType: file.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: file.size,
    });
  });

  return { redirectTo: `/assignment/${assessmentId}?saved=1` };
}

export async function submitAssignment(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const institution = await requireInstitution();
  const assessmentId = String(form.get('assessmentId') ?? '');

  const { assessment, row } = await loadAssignment(institution.id, assessmentId, me.userId);
  if (!assessment || !assessment.a.published || !assessment.modulePublished) {
    return { error: 'This assignment is not available.' };
  }
  if ((await myPlan(institution.id, me.userId)).gated) {
    return { redirectTo: `/assignment/${assessmentId}` };
  }
  const state = assignmentState(row);
  if (!row || !row.fileObjectKey || !canChange(state)) {
    return { error: state === 'not_started' ? 'Attach your file first.' : 'This has already been submitted.' };
  }

  const now = new Date();
  const late = isLate(assessment.a.closesAt, now);

  const sent = await withTenant(institution.id, async (tx) => {
    // Conditional on the state read above, so a double-click cannot submit twice.
    const updated = await tx
      .update(submissions)
      .set({ status: 'submitted', submittedAt: now, late })
      .where(and(eq(submissions.id, row.id), eq(submissions.status, row.status)))
      .returning({ id: submissions.id });
    if (updated.length === 0) return false;
    await tx
      .update(assignmentFiles)
      .set({ submittedAt: now })
      .where(eq(assignmentFiles.objectKey, row.fileObjectKey!));
    return true;
  });
  if (!sent) return { redirectTo: `/assignment/${assessmentId}` };

  await audit({
    action: state === 'returned' ? 'assignment.resubmitted' : 'assignment.submitted',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'student',
    entity: 'submissions',
    entityId: row.id,
    subjectId: me.userId,
    detail: { late },
  });

  return { redirectTo: `/assignment/${assessmentId}?submitted=1` };
}
