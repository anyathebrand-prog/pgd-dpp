/**
 * CMP-17 — annual data protection training for staff.
 *
 * Short and practical on purpose. The people taking it review identity
 * documents and handle payments for a living, and the useful training is the
 * handful of situations where the right thing is not the convenient thing:
 * a phone call asking for results, a document you could just email, a file
 * on a shared drive. A long course is completed once and forgotten; five
 * decisions made correctly once a year is what a regulator is asking about.
 *
 * Versioned, because what counts as "trained" is trained on a particular
 * text. When the content changes materially the version goes up and last
 * year's completions stop counting — the record says which version each
 * person passed, so that is visible rather than assumed.
 */

export const TRAINING_VERSION = 1;
export const VALID_DAYS = 365;
export const PASS_MARK = 4;

export const SECTIONS = [
  {
    title: 'You are handling other people’s records',
    body: 'Degree certificates, passport photographs, identity documents and payment details. Every time you open one it is recorded against your name, and the student can ask to see who has looked. Open what your task needs, and nothing more.',
  },
  {
    title: 'Keep it inside the platform',
    body: 'Documents stay behind the links the platform gives you, which expire in minutes. Downloading one to a personal device, forwarding it by personal email or messaging app, or saving it to a shared drive takes it outside every control this platform has, and makes you the only safeguard left.',
  },
  {
    title: 'Confirm who you are talking to',
    body: 'A phone call or an email from "a student" asking for results, a transcript or a password reset is exactly how records get taken. Send people to their own account, where they have proved who they are. Do not read anything out.',
  },
  {
    title: 'A breach has a 72-hour clock',
    body: 'If you think personal data has gone where it should not — a misdirected email, a lost laptop, a document where it should not be — tell the Data Protection Officer at once. The Commission must be notified within 72 hours of the institution becoming aware, and the clock starts when you notice, not when somebody decides it is serious.',
  },
];

export const QUESTIONS = [
  {
    id: 'breach',
    prompt: 'You realise you emailed an applicant list to the wrong address an hour ago. What do you do?',
    options: [
      'Email the recipient asking them to delete it, and leave it there',
      'Tell the Data Protection Officer now, because the 72-hour clock has already started',
      'Wait to see whether the recipient replies before deciding whether it matters',
    ],
    correct: 1,
  },
  {
    id: 'phone',
    prompt: 'Someone phones, gives a student’s name and matriculation number, and asks for their grades.',
    options: [
      'Read the grades out, since they knew the matriculation number',
      'Email the grades to the address they give you',
      'Tell them to sign in to their own account, and give nothing out by phone',
    ],
    correct: 2,
  },
  {
    id: 'device',
    prompt: 'You want to review a batch of applicants’ documents at home this evening.',
    options: [
      'Download them to your personal laptop so you can work offline',
      'Review them in the platform, through its links, and do not download them',
      'Forward them to your personal email so they are easy to find',
    ],
    correct: 1,
  },
  {
    id: 'minimum',
    prompt: 'You are checking one applicant’s degree certificate. Their file also has an ID document and a photograph.',
    options: [
      'Open only the degree certificate, since that is what the task needs',
      'Open everything, in case something is relevant',
      'Download the whole file so you have it for reference',
    ],
    correct: 0,
  },
  {
    id: 'shared',
    prompt: 'You find a folder of applicants’ scanned documents on a shared drive nobody seems to own.',
    options: [
      'Leave it, since you did not put it there',
      'Delete it quietly so the problem goes away',
      'Report it to the Data Protection Officer, and do not delete or move it yourself',
    ],
    correct: 2,
  },
] as const;

/**
 * Score a set of answers. Unanswered or out-of-range answers are wrong, not
 * errors: a submission that skips a question has not shown it knows the
 * answer.
 */
export function gradeTraining(answers: Record<string, number | undefined>) {
  const score = QUESTIONS.reduce((n, q) => n + (answers[q.id] === q.correct ? 1 : 0), 0);
  const missed = QUESTIONS.filter((q) => answers[q.id] !== q.correct).map((q) => q.id);
  return { score, passed: score >= PASS_MARK, missed };
}

export type TrainingStatus = 'never' | 'valid' | 'due_soon' | 'expired' | 'outdated';

/**
 * Where a person stands. `outdated` is a pass on an older version of the
 * content: it counted then, and it does not now.
 */
export function trainingStatus(
  latest: { version: number; expiresAt: Date } | null,
  now = new Date(),
): TrainingStatus {
  if (!latest) return 'never';
  if (latest.version < TRAINING_VERSION) return 'outdated';
  const msLeft = latest.expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return 'expired';
  // A month's warning, because an annual deadline that arrives unannounced
  // is missed by everybody at once.
  if (msLeft <= 30 * 86_400_000) return 'due_soon';
  return 'valid';
}
