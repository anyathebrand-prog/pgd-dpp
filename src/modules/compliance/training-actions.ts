'use server';

import { db } from '@/db';
import { staffTraining } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { QUESTIONS, TRAINING_VERSION, VALID_DAYS, gradeTraining } from './training';
import type { FormState } from '../auth/actions';

/** Every role that works on other people's records, which is every staff role. */
const STAFF = ['registry', 'institution_admin', 'facilitator', 'curator', 'dpo', 'super_admin'] as const;

/**
 * CMP-17 — recording an attempt.
 *
 * Every attempt is written, pass or fail. The answers are graded here, on the
 * server, from the answer key in training.ts; the browser only ever sees the
 * questions and the options.
 */
export async function submitTraining(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole(...STAFF);

  const answers: Record<string, number | undefined> = {};
  for (const q of QUESTIONS) {
    const raw = form.get(q.id);
    answers[q.id] = raw === null ? undefined : Number(raw);
  }

  const { score, passed, missed } = gradeTraining(answers);
  const expiresAt = passed ? new Date(Date.now() + VALID_DAYS * 86_400_000) : null;

  await db.insert(staffTraining).values({
    userId: me.userId,
    version: TRAINING_VERSION,
    score,
    passed,
    expiresAt,
  });

  await audit({
    action: passed ? 'training.passed' : 'training.failed',
    actorId: me.userId,
    subjectId: me.userId,
    entity: 'staff_training',
    detail: { version: TRAINING_VERSION, score, of: QUESTIONS.length },
  });

  if (!passed) {
    // The missed questions travel back, so the person sees which situations
    // to reread rather than a bare "failed".
    return {
      redirectTo: `/security/training?result=failed&score=${score}&missed=${missed.join(',')}`,
    };
  }
  return { redirectTo: `/security/training?result=passed&score=${score}` };
}
