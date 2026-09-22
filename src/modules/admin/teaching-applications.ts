'use server';

import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { institutions, memberships, teachingApplications, users } from '@/db/schema';
import { clientIp, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { deleteObject, putObject } from '@/lib/storage';
import { rateLimit } from '@/lib/ratelimit';
import { verifyTurnstile } from '@/lib/turnstile';
import { APPLICATION_MAX_BYTES, CERTS_MAX_EACH_KIND, CONTENT_TYPE, fileProblem, sniffKind } from './faculty-files';
import { issueActivationLink } from '../auth/actions';
import type { FormState } from '../auth/actions';

/**
 * "Teach with us": joining the one central faculty.
 *
 * The faculty is run by Data Protection Hub in collaboration with ALDAPCON,
 * so an application goes to the Hub, reviewed by its super admin in the
 * platform console. Applying grants nothing. Inviting grants the
 * facilitator role at the universities the Hub chooses (the teaching
 * console works per university: its modules, its grading), and sends the
 * ordinary activation link to set a password.
 */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function submitTeachingApplication(_prev: FormState, form: FormData): Promise<FormState> {
  const ip = clientIp(await headers());

  const fullName = String(form.get('fullName') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  const qualifications = String(form.get('qualifications') ?? '').trim();
  const areas = String(form.get('areas') ?? '').trim();
  const cv = form.get('cv');
  const files = (name: string) => form.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);
  const academic = files('academicCerts');
  const professional = files('professionalCerts');

  if (fullName.length < 2) return { error: 'Give your full name.' };
  if (!EMAIL.test(email)) return { error: 'Give an email address we can reply to.' };
  if (qualifications.length < 20) {
    return { error: 'Say something about your qualifications and experience: a few sentences is enough.' };
  }
  if (areas.length < 5) return { error: 'Say which parts of the programme you would like to teach.' };
  if (form.get('consent') !== 'on') {
    return { error: 'Confirm that Data Protection Hub may hold these details to consider your application.' };
  }

  /*
   * Every file is checked before any is stored, so a refused application
   * leaves nothing behind. The CV and both kinds of certificate are
   * required: the faculty is vetted on them.
   */
  if (!(cv instanceof File) || cv.size === 0) return { error: 'Attach your CV.' };
  if (academic.length === 0) return { error: 'Attach at least one academic certificate: a degree certificate or transcript.' };
  if (professional.length === 0) {
    return { error: 'Attach at least one professional certificate: for example a DPCO licence, CIPP/E, CIPM or call to bar.' };
  }
  if (academic.length > CERTS_MAX_EACH_KIND || professional.length > CERTS_MAX_EACH_KIND) {
    return { error: `Attach up to ${CERTS_MAX_EACH_KIND} certificates of each kind: your most relevant.` };
  }
  const all = [
    { file: cv, role: 'cv' as const, kind: null },
    ...academic.map((file) => ({ file, role: 'certificate' as const, kind: 'academic' as const })),
    ...professional.map((file) => ({ file, role: 'certificate' as const, kind: 'professional' as const })),
  ];
  if (all.reduce((sum, f) => sum + f.file.size, 0) > APPLICATION_MAX_BYTES) {
    return { error: 'Together the files are over 24MB. Save the larger scans smaller and try again.' };
  }
  const read = await Promise.all(all.map(async (f) => ({ ...f, bytes: Buffer.from(await f.file.arrayBuffer()) })));
  for (const f of read) {
    const problem = fileProblem(f.file, f.bytes.subarray(0, 8), f.role);
    if (problem) return { error: problem };
  }

  if (!(await verifyTurnstile(String(form.get('cf-turnstile-response') ?? ''), ip, 'teach_application'))) {
    return { error: 'The security check did not complete. Reload the page and try again.' };
  }
  if (!rateLimit(`teach:${ip}`, 5, 60 * 60_000).allowed) {
    return { error: 'Several applications have come from this connection already. Try again in an hour.' };
  }

  const folder = `faculty-applications/${Date.now()}-${randomBytes(6).toString('hex')}`;
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  let cvObjectKey = '';
  const cvFilename = cv.name.slice(-200);
  const certificates: { kind: 'academic' | 'professional'; key: string; filename: string; contentType: string }[] = [];
  for (const [n, f] of read.entries()) {
    const key = `${folder}/${f.kind ?? 'cv'}-${n}-${safe(f.file.name)}`;
    await putObject(key, f.bytes);
    if (f.kind === null) cvObjectKey = key;
    else certificates.push({ kind: f.kind, key, filename: f.file.name.slice(-200), contentType: CONTENT_TYPE[sniffKind(f.bytes.subarray(0, 8))!] });
  }

  const [row] = await db
    .insert(teachingApplications)
    .values({ fullName, email, phone: phone || null, qualifications, areas, cvObjectKey, cvFilename, certificates })
    .returning({ id: teachingApplications.id });

  await audit({
    action: 'teaching_application.received',
    entity: 'teaching_applications',
    entityId: row.id,
    detail: { academic: academic.length, professional: professional.length },
  });

  return { redirectTo: '/teach-with-us?sent=1' };
}

async function openApplication(id: string) {
  const [row] = await db
    .select()
    .from(teachingApplications)
    .where(and(eq(teachingApplications.id, id), eq(teachingApplications.status, 'received')))
    .limit(1);
  return row ?? null;
}

export async function inviteToFaculty(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');
  const row = await openApplication(String(form.get('applicationId') ?? ''));
  if (!row) return { error: 'That application has already been answered.' };

  const chosen = form.getAll('institutionId').map(String);
  if (chosen.length === 0) return { error: 'Choose at least one university for them to teach at.' };
  const where = await db
    .select()
    .from(institutions)
    .where(and(inArray(institutions.id, chosen), eq(institutions.status, 'live')));
  if (where.length !== chosen.length) return { error: 'One of those universities is not live.' };

  // SSO-04: one human, one account. An existing account gains the role.
  const [existing] = await db.select().from(users).where(eq(users.email, row.email)).limit(1);
  const person =
    existing ?? (await db.insert(users).values({ email: row.email, fullName: row.fullName, status: 'staff' }).returning())[0];

  for (const inst of where) {
    await db
      .insert(memberships)
      .values({ userId: person.id, institutionId: inst.id, role: 'facilitator' })
      .onConflictDoNothing();
  }

  // AUTH-01: an activation link, never a password set for them, and only
  // for someone who cannot already sign in.
  const invited = !person.passwordHash;
  if (invited) {
    const root = process.env.APP_ROOT_DOMAIN ?? 'localhost:3000';
    await issueActivationLink(person.id, row.email, 'Data Protection Hub', `${where[0].slug}.${root}`);
  }

  await db
    .update(teachingApplications)
    .set({ status: 'invited', decidedBy: me.userId, decidedAt: new Date() })
    .where(eq(teachingApplications.id, row.id));

  await audit({
    action: 'faculty.invited',
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'teaching_applications',
    entityId: row.id,
    subjectId: person.id,
    detail: { universities: where.map((i) => i.slug), invited },
  });

  return { redirectTo: `/platform/faculty?invited=${encodeURIComponent(row.fullName)}` };
}

export async function declineTeachingApplicant(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('super_admin');
  const row = await openApplication(String(form.get('applicationId') ?? ''));
  if (!row) return { error: 'That application has already been answered.' };

  // Nothing is kept that the decision no longer needs: the CV and every
  // certificate go now.
  if (row.cvObjectKey) await deleteObject(row.cvObjectKey);
  for (const c of row.certificates) await deleteObject(c.key);
  await db
    .update(teachingApplications)
    .set({ status: 'declined', decidedBy: me.userId, decidedAt: new Date(), cvObjectKey: null, certificates: [] })
    .where(eq(teachingApplications.id, row.id));
  await audit({
    action: 'teaching_application.declined',
    actorId: me.userId,
    actorRole: 'super_admin',
    entity: 'teaching_applications',
    entityId: row.id,
  });
  return { redirectTo: `/platform/faculty?declined=${encodeURIComponent(row.fullName)}` };
}
