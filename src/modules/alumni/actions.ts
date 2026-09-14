'use server';

import { and, eq } from 'drizzle-orm';
import { db, withTenant } from '@/db';
import {
  alumniProfiles,
  certificates,
  consentRecords,
  enrollments,
  memberships,
  users,
} from '@/db/schema';
import { requireUser, requireRole, clientIp } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';
import { currentNoticeVersion } from '@/lib/consent';
import { hashIp } from '@/lib/crypto';
import { humanCode } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { OPTIONAL_FIELDS } from './fields';
import type { FormState } from '../auth/actions';

/**
 * The alumni community — ALM-01, ALM-02, ALM-03, and CMP-15.
 *
 * §5.8 carries a scope warning worth repeating here, because it is the reason
 * this module is small: "a community is a product, not a feature. v1 should be
 * directory + forum + jobs board only. Do not build a social network."
 *
 * CMP-15 is the rule everything else bends around: profiles are private
 * unless the alumnus opts in, and per AL-03 each field is controlled
 * separately. A single toggle would make opting in an all-or-nothing bargain
 * — your employer's name in exchange for finding a classmate — which is not
 * what privacy by default means.
 */

/**
 * ALM-01 — the transition, which is not a status flip.
 *
 * Completing the programme changes what someone is to this platform: a
 * different role, a different landing page, and — the part that matters to
 * them — library access that continues (LIB-08). Issuing the certificate is
 * what marks completion, so the transition happens there rather than in a
 * nightly job that could be late by a day.
 *
 * The alumni profile is created immediately and empty, with nothing visible.
 * Creating it lazily on first visit would mean the row's existence depended
 * on someone showing up, and "have we got a profile for them" is a question
 * the directory has to answer without ambiguity.
 */
export async function certifyCompletion(_prev: FormState, form: FormData): Promise<FormState> {
  const institution = await requireInstitution();
  const me = await requireRole('registry', 'institution_admin');

  const enrollmentId = String(form.get('enrollmentId') ?? '');

  const [enrolment] = await withTenant(institution.id, (tx) =>
    tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).limit(1),
  );
  if (!enrolment) return { error: 'That enrolment does not exist.' };
  if (enrolment.status === 'completed') return { error: 'They have already been certified.' };
  if (enrolment.status !== 'active') {
    return { error: `That enrolment is ${enrolment.status}, so there is nothing to certify.` };
  }

  const [student] = await db.select().from(users).where(eq(users.id, enrolment.userId)).limit(1);
  if (!student) return { error: 'That student no longer exists.' };

  const code = humanCode(10);

  await withTenant(institution.id, async (tx) => {
    await tx.insert(certificates).values({
      institutionId: institution.id,
      enrollmentId: enrolment.id,
      kind: 'completion',
      verificationCode: code,
      holderName: student.fullName ?? student.email,
      programmeTitle: 'Post Graduate Diploma in Data Protection & Privacy',
    });
    await tx
      .update(enrollments)
      // completedAt is the date the certificate carries, so it is written
      // here rather than inferred later from a row's modification time.
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(enrollments.id, enrolment.id));
  });

  // AUTH-10 lifecycle: student → alumni, with the role to match. The student
  // membership stays: they were a student, and the record of that is not
  // something graduation erases.
  await db.update(users).set({ status: 'alumni', updatedAt: new Date() }).where(eq(users.id, student.id));
  await db
    .insert(memberships)
    .values({ userId: student.id, institutionId: institution.id, role: 'alumni' })
    .onConflictDoNothing();

  await db
    .insert(alumniProfiles)
    .values({
      userId: student.id,
      institutionId: institution.id,
      cohortYear: (enrolment.createdAt ?? new Date()).getFullYear(),
      // CMP-15. Nothing is visible until they say so, including the fact that
      // they exist.
      directoryVisible: false,
      visibleFields: [],
    })
    .onConflictDoNothing();

  await audit({
    action: 'alumni.certified',
    institutionId: institution.id,
    actorId: me.userId,
    actorRole: 'registry',
    subjectId: student.id,
    entity: 'enrollments',
    entityId: enrolment.id,
    detail: { verificationCode: code },
  });

  /*
   * No revalidatePath at all here, and the sibling path matters as much as
   * this one: /admin/applications shares a layout with /admin/graduation, so
   * revalidating it refreshes this segment too. The certified row leaves the
   * list as part of the action's own response, the component that was going
   * to report the outcome unmounts, and the registrar sees the person vanish
   * with no confirmation that anything happened.
   *
   * The client navigates to a URL carrying the outcome instead, which fetches
   * fresh data anyway.
   */
  return { notice: `Certified. ${student.fullName ?? student.email} is now an alumnus.` };
}

/** AL-03 — the profile, and what of it anyone else may see. */
export async function saveAlumniProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();

  const [profile] = await db
    .select()
    .from(alumniProfiles)
    .where(eq(alumniProfiles.userId, me.userId))
    .limit(1);
  if (!profile) return { error: 'You do not have an alumni profile.' };

  const currentRole = String(form.get('currentRole') ?? '').trim();
  const employer = String(form.get('employer') ?? '').trim();
  const specialisation = String(form.get('specialisation') ?? '').trim();
  const location = String(form.get('location') ?? '').trim();
  const linkedinUrl = String(form.get('linkedinUrl') ?? '').trim();
  const listed = form.get('directoryVisible') === 'on';

  if (linkedinUrl && !/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(linkedinUrl)) {
    return { error: 'Give the full LinkedIn URL, starting with https://www.linkedin.com/.' };
  }

  const visibleFields = OPTIONAL_FIELDS.filter((f) => form.get(`show_${f.key}`) === 'on').map(
    (f) => f.key,
  );

  await db
    .update(alumniProfiles)
    .set({
      currentRole: currentRole || null,
      employer: employer || null,
      specialisation: specialisation || null,
      location: location || null,
      linkedinUrl: linkedinUrl || null,
      directoryVisible: listed,
      visibleFields,
      updatedAt: new Date(),
    })
    .where(eq(alumniProfiles.userId, me.userId));

  /*
   * CMP-06: the directory is consent-based, so turning it on or off is a
   * consent decision and gets a consent record — not just a column update.
   * §6.5 requires withdrawal to be as easy as granting and to take effect
   * "within minutes, not on a nightly job", which it does: the directory
   * reads this row.
   */
  if (listed !== profile.directoryVisible) {
    const { headers } = await import('next/headers');
    const h = await headers();
    await db.insert(consentRecords).values({
      institutionId: profile.institutionId,
      userId: me.userId,
      purpose: 'alumni_directory',
      granted: listed,
      noticeVersion: await currentNoticeVersion(),
      purposeTextShown: 'Appearing in the alumni directory',
      ipHash: hashIp(clientIp(h)),
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    });
  }

  await audit({
    action: 'alumni.profile_updated',
    institutionId: profile.institutionId,
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'alumni_profiles',
    entityId: profile.id,
    detail: { directoryVisible: listed, visibleFields },
  });

  // The profile page and the directory both re-read this row on next visit;
  // the form stays mounted to report what changed.
  return {
    notice: listed
      ? 'Saved. You are listed in the directory, showing only the fields you ticked.'
      : 'Saved. You are not listed, and nobody can see your profile.',
  };
}
