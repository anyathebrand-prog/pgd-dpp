'use server';

import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { teachingApplications } from '@/db/schema';
import { clientIp, requireRole } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { deleteObject, putObject } from '@/lib/storage';
import { rateLimit } from '@/lib/ratelimit';
import { verifyTurnstile } from '@/lib/turnstile';
import { assignmentFileProblem } from '@/modules/learning/assignment';
import { inviteStaff } from './staff';
import type { FormState } from '../auth/actions';

/**
 * "Teach with us". Asking to teach, and the administrator's answer.
 *
 * Submitting grants nothing. The administrator reads the application on the
 * Staff page and either invites the person as a facilitator, through the
 * same inviteStaff every other appointment goes through, or declines it.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function submitTeachingApplication(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const ip = clientIp(await headers());

  const fullName = String(form.get('fullName') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  const qualifications = String(form.get('qualifications') ?? '').trim();
  const areas = String(form.get('areas') ?? '').trim();
  const cv = form.get('cv');

  if (fullName.length < 2) return { error: 'Give your full name.' };
  if (!EMAIL.test(email)) return { error: 'Give an email address the university can reply to.' };
  if (qualifications.length < 20) {
    return { error: 'Say something about your qualifications and experience: a few sentences is enough.' };
  }
  if (areas.length < 5) return { error: 'Say which parts of the programme you would like to teach.' };
  if (form.get('consent') !== 'on') {
    return { error: `Confirm that ${institution.name} may hold these details to consider your application.` };
  }

  if (!(await verifyTurnstile(String(form.get('cf-turnstile-response') ?? ''), ip, 'teach_application'))) {
    return { error: 'The security check did not complete. Reload the page and try again.' };
  }
  if (!rateLimit(`teach:${ip}`, 5, 60 * 60_000).allowed) {
    return { error: 'Several applications have come from this connection already. Try again in an hour.' };
  }

  let cvObjectKey: string | null = null;
  let cvFilename: string | null = null;
  if (cv instanceof File && cv.size > 0) {
    const body = Buffer.from(await cv.arrayBuffer());
    const problem = assignmentFileProblem(cv, body.subarray(0, 8));
    if (problem) return { error: problem.replace('Upload a PDF', 'Attach your CV as a PDF') };
    const safe = cv.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cvObjectKey = `institutions/${institution.id}/teaching/${Date.now()}-${safe}`;
    cvFilename = cv.name.slice(-200);
    await putObject(cvObjectKey, body);
  }

  const [row] = await withTenant(institution.id, (tx) =>
    tx
      .insert(teachingApplications)
      .values({
        institutionId: institution.id,
        fullName,
        email,
        phone: phone || null,
        qualifications,
        areas,
        cvObjectKey,
        cvFilename,
      })
      .returning({ id: teachingApplications.id }),
  );

  await audit({
    action: 'teaching_application.received',
    institutionId: institution.id,
    entity: 'teaching_applications',
    entityId: row.id,
    detail: { withCv: Boolean(cvObjectKey) },
  });

  return { redirectTo: '/teach-with-us?sent=1' };
}

async function openApplication(institutionId: string, id: string) {
  const [row] = await withTenant(institutionId, (tx) =>
    tx
      .select()
      .from(teachingApplications)
      .where(and(eq(teachingApplications.id, id), eq(teachingApplications.status, 'received')))
      .limit(1),
  );
  return row ?? null;
}

export async function inviteTeachingApplicant(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');
  const row = await openApplication(institution.id, String(form.get('applicationId') ?? ''));
  if (!row) return { error: 'That application has already been answered.' };

  // The one route to a role: the same invitation as any other appointment.
  const invite = new FormData();
  invite.set('fullName', row.fullName);
  invite.set('email', row.email);
  invite.set('role', 'facilitator');
  const result = await inviteStaff(undefined, invite);
  if (result?.error) return result;

  await withTenant(institution.id, (tx) =>
    tx
      .update(teachingApplications)
      .set({ status: 'invited', decidedBy: me.userId, decidedAt: new Date() })
      .where(eq(teachingApplications.id, row.id)),
  );
  return result;
}

export async function declineTeachingApplicant(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('institution_admin');
  const row = await openApplication(institution.id, String(form.get('applicationId') ?? ''));
  if (!row) return { error: 'That application has already been answered.' };

  // Nothing is kept that the decision no longer needs: the CV goes now.
  if (row.cvObjectKey) await deleteObject(row.cvObjectKey);
  await withTenant(institution.id, (tx) =>
    tx
      .update(teachingApplications)
      .set({ status: 'declined', decidedBy: me.userId, decidedAt: new Date(), cvObjectKey: null })
      .where(eq(teachingApplications.id, row.id)),
  );
  await audit({
    action: 'teaching_application.declined',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'institution_admin',
    entity: 'teaching_applications',
    entityId: row.id,
  });
  return { redirectTo: `/admin/staff?declined=${encodeURIComponent(row.fullName)}` };
}
