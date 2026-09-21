/**
 * CMP-17 — grading and the annual expiry.
 */
import { describe, expect, it } from 'vitest';
import {
  PASS_MARK,
  QUESTIONS,
  TRAINING_VERSION,
  gradeTraining,
  trainingStatus,
} from '@/modules/compliance/training';

const allCorrect = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.correct]));

describe('grading', () => {
  it('passes a perfect set', () => {
    expect(gradeTraining(allCorrect)).toMatchObject({ score: QUESTIONS.length, passed: true, missed: [] });
  });

  it('passes at the pass mark and fails one below it', () => {
    const wrong = (ids: string[]) =>
      Object.fromEntries(QUESTIONS.map((q) => [q.id, ids.includes(q.id) ? (q.correct + 1) % 3 : q.correct]));

    const oneWrong = gradeTraining(wrong([QUESTIONS[0].id]));
    expect(oneWrong.score).toBe(QUESTIONS.length - 1);
    expect(oneWrong.passed).toBe(QUESTIONS.length - 1 >= PASS_MARK);

    const twoWrong = gradeTraining(wrong([QUESTIONS[0].id, QUESTIONS[1].id]));
    expect(twoWrong.passed).toBe(false);
    expect(twoWrong.missed).toEqual([QUESTIONS[0].id, QUESTIONS[1].id]);
  });

  it('counts an unanswered question as wrong, not as an error', () => {
    const { [QUESTIONS[0].id]: _skipped, ...rest } = allCorrect;
    expect(gradeTraining(rest).missed).toEqual([QUESTIONS[0].id]);
  });

  it('counts an out-of-range answer as wrong', () => {
    expect(gradeTraining({ ...allCorrect, [QUESTIONS[0].id]: 99 }).missed).toContain(QUESTIONS[0].id);
  });

  it('has exactly one correct option per question, inside the options', () => {
    for (const q of QUESTIONS) {
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(q.options.length);
    }
  });
});

describe('where a person stands', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

  it('never trained', () => {
    expect(trainingStatus(null, now)).toBe('never');
  });

  it('valid with more than a month left', () => {
    expect(trainingStatus({ version: TRAINING_VERSION, expiresAt: days(90) }, now)).toBe('valid');
  });

  it('due soon inside a month', () => {
    expect(trainingStatus({ version: TRAINING_VERSION, expiresAt: days(20) }, now)).toBe('due_soon');
  });

  it('expired on the day, not the day after', () => {
    expect(trainingStatus({ version: TRAINING_VERSION, expiresAt: now }, now)).toBe('expired');
  });

  it('a pass on an older version no longer counts', () => {
    // Trained on a text that has since changed materially.
    expect(trainingStatus({ version: TRAINING_VERSION - 1, expiresAt: days(200) }, now)).toBe('outdated');
  });
});
