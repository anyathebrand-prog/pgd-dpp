/**
 * Core schema — PRD §13.
 *
 * Two classes of table exist here and the distinction is load-bearing:
 *
 *  - TENANT-SCOPED: carries `institutionId NOT NULL`. Row-level security is
 *    applied in `rls.sql` against `current_setting('app.institution_id')`.
 *  - SHARED: library, national alumni content, platform config. These are
 *    explicitly exempt from RLS and listed in SHARED_TABLES below, so the
 *    exemption is a decision rather than an oversight (§7.4).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ tenancy */

export const institutions = pgTable(
  'institutions',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    city: text('city'),
    logoUrl: text('logo_url'),
    /** IA-06. Only --tenant-brand is overridable; semantic tokens are not (§2.5). */
    brandColour: text('brand_colour').notNull().default('#6B2436'),
    /** PAY-06. Verified against the resolved bank name at onboarding. */
    paystackSubaccountCode: text('paystack_subaccount_code'),
    paystackSharePercent: integer('paystack_share_percent').notNull().default(90),
    /**
     * PAY-11. Where a sponsor sends a bank transfer, which is how a great many
     * of them actually pay. Kept on the institution rather than in a settings
     * blob because PY-06 renders it to someone about to move money: a stale or
     * mistyped account number here is a payment into the void.
     */
    bankName: text('bank_name'),
    bankAccountName: text('bank_account_name'),
    bankAccountNumber: text('bank_account_number'),
    /**
     * SSO-02. The shared secret a university's portal signs its handoff tokens
     * with. Tier 2 exists because most Nigerian university portals are bespoke
     * PHP with no SAML or OIDC endpoint (§5.4), and a signed short-lived link
     * is something any of them can produce.
     *
     * Null means the institution has no handoff configured, and PB-08 refuses
     * every token rather than falling back to something weaker.
     */
    ssoSharedSecret: text('sso_shared_secret'),
    /** §5.1: an offer lapses if the acceptance fee is unpaid within N days. */
    offerExpiryDays: integer('offer_expiry_days').notNull().default(14),
    status: text('status', { enum: ['provisioning', 'live', 'suspended'] })
      .notNull()
      .default('provisioning'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('institutions_slug_key').on(t.slug)],
);

/* -------------------------------------------------------------------- users */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    /** Argon2id (AUTH-03). Null until the activation link is used (AUTH-01). */
    passwordHash: text('password_hash'),
    fullName: text('full_name'),
    phone: text('phone'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** AUTH-10 lifecycle. */
    status: text('status', {
      enum: ['pending', 'candidate', 'student', 'alumni', 'staff', 'suspended'],
    })
      .notNull()
      .default('pending'),
    totpSecret: text('totp_secret'),
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

/**
 * SSO-04: one human, one platform account, even across two institutions.
 * Membership is the join, and it is where the per-institution role lives.
 *
 * Deliberately SHARED rather than RLS-scoped, despite carrying institution_id.
 * It is an identity table in the same class as `users` and `sessions`: every
 * request resolves the whole membership set for a person BEFORE a tenant is
 * established, and the AU-10 institution chooser exists precisely to read
 * across institutions. Policing it per-tenant would make `currentPrincipal`
 * return an empty role set on every request, so every staff role check would
 * fail. A row here holds only (user, institution, role) and no personal data,
 * and callers filter by institution explicitly.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: [
        'candidate',
        'student',
        'alumni',
        'facilitator',
        'registry',
        'institution_admin',
        'curator',
        'super_admin',
        'dpo',
      ],
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_user_institution_role_key').on(t.userId, t.institutionId, t.role),
    index('memberships_institution_idx').on(t.institutionId),
  ],
);

/** AUTH-07. Session ids are stored hashed; the raw token lives only in the cookie. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'cascade',
    }),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    /** AUTH-08: set once the TOTP challenge is cleared. */
    mfaSatisfied: boolean('mfa_satisfied').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

/** AU-02, AU-05, AU-06. Single-use, hashed, short-lived. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify_email', 'reset_password', 'activate'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    /** The six-digit OTP path (AU-02) stores the code hash here instead. */
    codeHash: text('code_hash'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose)],
);

/**
 * SSO-02 replay protection.
 *
 * A signed handoff token is a bearer credential for the ninety seconds it
 * lives, and a link sitting in a browser history or a proxy log can be
 * replayed inside that window. Each token carries a nonce, each nonce is
 * spent once, and the row is what makes "once" true.
 *
 * Shared rather than tenant-scoped, for the same reason `auth_tokens` is: it
 * is consumed before any session exists to derive a tenant from.
 */
export const ssoNonces = pgTable(
  'sso_nonces',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    nonce: text('nonce').notNull(),
    usedAt: createdAt(),
    /** Kept only as long as a token could still be replayed. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('sso_nonces_institution_nonce_key').on(t.institutionId, t.nonce)],
);

/* --------------------------------------------------------------- programmes */

export const programmes = pgTable('programmes', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Post Graduate Diploma in Data Protection & Privacy'),
  summary: text('summary'),
  entryRequirements: text('entry_requirements'),
  durationMonths: integer('duration_months').notNull().default(12),
  createdAt: createdAt(),
});

export const cohorts = pgTable(
  'cohorts',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** §5.1 LOCKED: capacity is enforced at offer issuance, not at payment. */
    capacity: integer('capacity').notNull().default(60),
    applicationOpensAt: timestamp('application_opens_at', { withTimezone: true }),
    applicationClosesAt: timestamp('application_closes_at', { withTimezone: true }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    status: text('status', { enum: ['draft', 'open', 'closed', 'running', 'completed'] })
      .notNull()
      .default('draft'),
    createdAt: createdAt(),
  },
  (t) => [index('cohorts_institution_idx').on(t.institutionId)],
);

/** IA-03 / PAY-01. */
export const feeItems = pgTable(
  'fee_items',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['application', 'acceptance', 'tuition', 'id_card', 'library_levy', 'examination'],
    }).notNull(),
    label: text('label').notNull(),
    /** Kobo. Integer money only — never a float on a payments table. */
    amountKobo: integer('amount_kobo').notNull(),
    mandatory: boolean('mandatory').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('fee_items_institution_idx').on(t.institutionId)],
);

/* --------------------------------------------------------------- admissions */

export const applications = pgTable(
  'applications',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    /** APP-07 tracker states, plus the payment and offer states from §5.1. */
    status: text('status', {
      enum: [
        'draft',
        'awaiting_application_fee',
        'submitted',
        'under_review',
        'documents_queried',
        'admitted',
        'offer_accepted',
        'enrolled',
        'rejected',
        'waitlisted',
        'offer_lapsed',
        'withdrawn',
      ],
    })
      .notNull()
      .default('draft'),
    /** APP-03 autosave payload, validated on submit rather than on keystroke. */
    personal: jsonb('personal').$type<Record<string, unknown>>().notNull().default({}),
    education: jsonb('education').$type<Record<string, unknown>>().notNull().default({}),
    experience: jsonb('experience').$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    decisionBy: uuid('decision_by').references(() => users.id, { onDelete: 'set null' }),
    decisionNote: text('decision_note'),
    /** AP-10. Set at offer issuance from institutions.offerExpiryDays. */
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_reference_key').on(t.reference),
    uniqueIndex('applications_user_cohort_key').on(t.userId, t.cohortId),
    index('applications_institution_status_idx').on(t.institutionId, t.status),
  ],
);

/** APP-04. Originals are immutable; access is exclusively via signed URL (CMP-13). */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'degree_certificate',
        'transcript',
        'nysc_certificate',
        'passport_photo',
        'id_document',
        'payment_proof',
      ],
    }).notNull(),
    /** institutions/{id}/applications/{applicant_id}/... — never a public object. */
    objectKey: text('object_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: text('checksum_sha256'),
    scanStatus: text('scan_status', { enum: ['pending', 'clean', 'infected', 'failed'] })
      .notNull()
      .default('pending'),
    status: text('status', { enum: ['uploaded', 'accepted', 'queried', 'rejected', 'purged'] })
      .notNull()
      .default('uploaded'),
    /** CMP-10. Set when the retention clock starts; the purge job reads this. */
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    /**
     * DP-07 needs to tell "not yet due" from "tried and failed". A failed
     * purge has to alert rather than sit quietly in a log, and it cannot do
     * that if the only evidence is an absent purgedAt.
     */
    purgeAttemptedAt: timestamp('purge_attempted_at', { withTimezone: true }),
    purgeError: text('purge_error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('documents_application_idx').on(t.applicationId),
    index('documents_purge_idx').on(t.purgeAfter),
  ],
);

/** APP-08 / RG-03. The candidate re-uploads that one item only. */
export const documentQueries = pgTable('document_queries', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  documentKind: text('document_kind').notNull(),
  /** Shown to the candidate verbatim (§5.5, document slot, queried state). */
  note: text('note').notNull(),
  raisedBy: uuid('raised_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id, { onDelete: 'restrict' }),
    applicationId: uuid('application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
    /** Issued on settlement of the tuition charge, never on the browser callback. */
    matricNumber: text('matric_number').notNull(),
    status: text('status', { enum: ['active', 'deferred', 'withdrawn', 'completed'] })
      .notNull()
      .default('active'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('enrollments_matric_key').on(t.matricNumber),
    uniqueIndex('enrollments_user_cohort_key').on(t.userId, t.cohortId),
  ],
);

/* ----------------------------------------------------------------- payments */

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    applicationId: uuid('application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
    /** The reference a candidate reads out to support. Plex Mono, everywhere. */
    reference: text('reference').notNull(),
    context: text('context', { enum: ['application', 'tuition', 'sundry'] }).notNull(),
    amountKobo: integer('amount_kobo').notNull(),
    currency: text('currency').notNull().default('NGN'),
    channel: text('channel', { enum: ['paystack', 'offline_transfer'] })
      .notNull()
      .default('paystack'),
    status: text('status', {
      enum: ['pending', 'success', 'failed', 'abandoned', 'awaiting_approval', 'reversed'],
    })
      .notNull()
      .default('pending'),
    /** PAY-05. A snapshot of the split at charge time, not a live lookup. */
    subaccountCode: text('subaccount_code'),
    platformShareKobo: integer('platform_share_kobo').notNull().default(0),
    institutionShareKobo: integer('institution_share_kobo').notNull().default(0),
    paystackId: text('paystack_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** PAY-10: one reminder, 24h hold. */
    recoveryEmailSentAt: timestamp('recovery_email_sent_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('transactions_reference_key').on(t.reference),
    index('transactions_institution_status_idx').on(t.institutionId, t.status),
  ],
);

export const transactionLines = pgTable('transaction_lines', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  feeItemId: uuid('fee_item_id').references(() => feeItems.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  amountKobo: integer('amount_kobo').notNull(),
});

/**
 * PAY-04 / §7.5. Every webhook lands here keyed on Paystack's event id BEFORE
 * any business logic runs. Idempotency and replay protection come free, and
 * reconciliation gets an audit trail. Not tenant-scoped: the receiver does not
 * yet know which tenant an event belongs to when it writes the row.
 */
export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: id(),
    provider: text('provider').notNull().default('paystack'),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex('inbound_events_provider_event_key').on(t.provider, t.eventId)],
);

/* ----------------------------------------------------------------- learning */

export const modules = pgTable(
  'modules',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'cascade' }),
    semester: integer('semester').notNull().default(1),
    code: text('code').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    position: integer('position').notNull().default(0),
    facilitatorId: uuid('facilitator_id').references(() => users.id, { onDelete: 'set null' }),
    published: boolean('published').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('modules_programme_idx').on(t.programmeId)],
);

export const lessons = pgTable(
  'lessons',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(0),
    /** LRN-02. Rich text renders on a Literata reading surface (ST-03). */
    body: text('body'),
    videoUid: text('video_uid'),
    videoDurationSeconds: integer('video_duration_seconds'),
    /** LRN-09, where the institution permits it. */
    downloadable: boolean('downloadable').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('lessons_module_idx').on(t.moduleId)],
);

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** LRN-03 resume-where-you-left-off. */
    positionSeconds: integer('position_seconds').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.userId] })],
);

export const assessments = pgTable('assessments', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  moduleId: uuid('module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind', { enum: ['quiz', 'assignment'] })
    .notNull()
    .default('quiz'),
  instructions: text('instructions'),
  timeLimitMinutes: integer('time_limit_minutes'),
  attemptLimit: integer('attempt_limit').notNull().default(1),
  passMark: integer('pass_mark').notNull().default(50),
  weight: integer('weight').notNull().default(100),
  opensAt: timestamp('opens_at', { withTimezone: true }),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  published: boolean('published').notNull().default(false),
  createdAt: createdAt(),
});

export const questions = pgTable('questions', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  assessmentId: uuid('assessment_id')
    .notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  kind: text('kind', { enum: ['mcq', 'true_false', 'short_answer'] }).notNull(),
  prompt: text('prompt').notNull(),
  /** [{ key, text }] for mcq. Never serialised to the client with the answer. */
  options: jsonb('options').$type<{ key: string; text: string }[]>().notNull().default([]),
  correctAnswer: text('correct_answer'),
  marks: integer('marks').notNull().default(1),
});

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull().default(1),
    answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
    fileObjectKey: text('file_object_key'),
    startedAt: createdAt(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    autoScore: integer('auto_score'),
    status: text('status', { enum: ['in_progress', 'submitted', 'returned', 'graded'] })
      .notNull()
      .default('in_progress'),
    /** FC-03 "return for revision". Shown to the student verbatim. */
    returnedNote: text('returned_note'),
  },
  (t) => [
    uniqueIndex('submissions_assessment_user_attempt_key').on(t.assessmentId, t.userId, t.attempt),
  ],
);

/**
 * Conflict C-06. A timed assessment cannot be extended by the person taking
 * it, which fails WCAG 2.2.1 unless the timing is essential. Assessment
 * timing is essential, so the exception applies — but the resolution is to
 * build extended time into the facilitator console rather than to rely on
 * the exception alone and leave disabled students with no route.
 *
 * Granted per student per assessment, with a reason, by the facilitator who
 * teaches the module.
 */
export const assessmentAccommodations = pgTable(
  'assessment_accommodations',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Added to the assessment's own limit, not a replacement for it. */
    extraMinutes: integer('extra_minutes').notNull(),
    /**
     * Why it was granted. Deliberately free text and deliberately not a
     * diagnosis — a facilitator recording "documented accommodation on file
     * with the registry" is the right level of detail to hold here.
     */
    reason: text('reason').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('accommodations_assessment_user_key').on(t.assessmentId, t.userId)],
);

export const grades = pgTable('grades', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  maxScore: integer('max_score').notNull(),
  feedback: text('feedback'),
  gradedBy: uuid('graded_by').references(() => users.id, { onDelete: 'set null' }),
  gradedAt: createdAt(),
});

export const announcements = pgTable('announcements', {
  id: id(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** LRN-08 / PB-07. The verification code is public and reveals minimum data. */
export const certificates = pgTable(
  'certificates',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    /**
     * A completion certificate hangs off an enrollment; an admission letter is
     * issued before one exists, so it hangs off the application instead.
     * Exactly one of the two is set, which the check constraint in rls.sql
     * enforces at the database rather than by convention.
     */
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['completion', 'admission_letter'] })
      .notNull()
      .default('completion'),
    verificationCode: text('verification_code').notNull(),
    holderName: text('holder_name').notNull(),
    programmeTitle: text('programme_title').notNull(),
    issuedAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    objectKey: text('object_key'),
  },
  (t) => [uniqueIndex('certificates_code_key').on(t.verificationCode)],
);

/* -------------------------------------------------------- shared: knowledge */

/** LIB-06: every item carries a visible licence and provenance statement. */
export const licences = pgTable('licences', {
  id: id(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  allowsHosting: boolean('allows_hosting').notNull(),
  allowsDownload: boolean('allows_download').notNull(),
  statement: text('statement').notNull(),
});

export const libraryItems = pgTable(
  'library_items',
  {
    id: id(),
    collection: text('collection', { enum: ['library', 'resource_centre'] })
      .notNull()
      .default('library'),
    title: text('title').notNull(),
    citation: text('citation'),
    authors: text('authors'),
    /** LIB-02 facets. */
    jurisdiction: text('jurisdiction'),
    instrumentType: text('instrument_type'),
    court: text('court'),
    subjectAreas: text('subject_areas').array(),
    year: integer('year'),
    abstract: text('abstract'),
    /** Populated by the OCR/extraction worker; the FTS index is built on it. */
    fullText: text('full_text'),
    objectKey: text('object_key'),
    externalUrl: text('external_url'),
    licenceId: uuid('licence_id').references(() => licences.id, { onDelete: 'restrict' }),
    sourceAttribution: text('source_attribution').notNull(),
    status: text('status', { enum: ['draft', 'in_review', 'published', 'taken_down'] })
      .notNull()
      .default('draft'),
    /** RES-04: student and faculty submissions await curator approval. */
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    viewCount: integer('view_count').notNull().default(0),
    downloadCount: integer('download_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('library_items_status_idx').on(t.status)],
);

/**
 * LIB-07. A takedown claim against a library item.
 *
 * Shared rather than tenant-scoped, because the corpus is shared: a rights
 * holder complains about an item, not about a university. The claimant is
 * usually not a user of this platform and is not asked to become one, so
 * their contact details live here and nowhere else — and they are personal
 * data, which is why this table carries its own retention rule.
 */
export const takedownRequests = pgTable(
  'takedown_requests',
  {
    id: id(),
    /** Human-quotable, and the only thing the claimant is given to quote. */
    reference: text('reference').notNull(),
    itemId: uuid('item_id').references(() => libraryItems.id, { onDelete: 'set null' }),
    /** Free text, because a claimant who cannot find the item still has a claim. */
    itemDescription: text('item_description').notNull(),
    claimantName: text('claimant_name').notNull(),
    claimantEmail: text('claimant_email').notNull(),
    claimantOrganisation: text('claimant_organisation'),
    basis: text('basis', {
      enum: ['copyright', 'personal_data', 'inaccuracy', 'other'],
    }).notNull(),
    detail: text('detail').notNull(),
    /** The declaration is the part that makes a bad-faith claim actionable. */
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: ['received', 'under_review', 'upheld', 'rejected'] })
      .notNull()
      .default('received'),
    outcomeNote: text('outcome_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('takedown_requests_reference_key').on(t.reference),
    index('takedown_requests_status_idx').on(t.status),
  ],
);

/**
 * RES-06. A reader's own bookmarks.
 *
 * Shared rather than tenant-scoped, because the corpus is: an alumnus who
 * studied at one university and bookmarked a judgment keeps that bookmark,
 * and LIB-08 says their access continues after they graduate. The row is
 * personal data — it says what someone has been reading — so it is deleted
 * with the user rather than retained with the item.
 */
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => libraryItems.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('bookmarks_user_item_key').on(t.userId, t.itemId)],
);

/* ----------------------------------------------------------- shared: alumni */

export const alumniProfiles = pgTable(
  'alumni_profiles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Affiliation shows on every profile (§4 LOCKED) but is not an RLS key here. */
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    cohortYear: integer('cohort_year').notNull(),
    currentRole: text('current_role'),
    employer: text('employer'),
    specialisation: text('specialisation'),
    location: text('location'),
    linkedinUrl: text('linkedin_url'),
    /** ALM-02 / CMP-15: private unless the alumnus opts in. Default is false. */
    directoryVisible: boolean('directory_visible').notNull().default(false),
    /**
     * AL-03: "each field individually visibility-controlled, default
     * private". A single directory toggle would make opting in an
     * all-or-nothing bargain — your employer's name for the ability to find
     * a classmate — and CMP-15's privacy-by-default means the granular
     * answer, not the convenient one.
     *
     * Empty means nothing beyond the three facts a directory entry cannot
     * exist without: name, institution and cohort year.
     */
    visibleFields: text('visible_fields').array(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('alumni_profiles_user_key').on(t.userId)],
);

/**
 * ALM-10 / ALM-11 — a school's private channel, and what an institution
 * broadcasts into it.
 *
 * Tenant-scoped, and that is the whole design. ALM-12 says a School A
 * alumnus may see School B graduates in the national directory and may not
 * enter School B's channel — so the rows live behind row-level security like
 * every other institutional record, and the access check happens before the
 * tenant is set rather than instead of it.
 *
 * One table for posts and broadcasts, distinguished by `kind`: they differ in
 * who may write them and how they are presented, not in what they are, and
 * two tables would mean two moderation queues for the same job.
 */
export const channelPosts = pgTable(
  'channel_posts',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['post', 'broadcast'] })
      .notNull()
      .default('post'),
    title: text('title'),
    body: text('body').notNull(),
    /**
     * ALM-08. Removed rather than deleted: a moderator's decision is a record,
     * and a post that simply disappears teaches the person who reported it
     * nothing about whether anyone looked.
     */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedReason: text('removed_reason'),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('channel_posts_institution_idx').on(t.institutionId, t.createdAt)],
);

/** ALM-08. Someone flagged something, and a moderator has to see it. */
export const contentReports = pgTable(
  'content_reports',
  {
    id: id(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => channelPosts.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason', {
      enum: ['abusive', 'personal_data', 'off_topic', 'spam', 'other'],
    }).notNull(),
    detail: text('detail'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('content_reports_institution_idx').on(t.institutionId, t.resolvedAt)],
);

/* -------------------------------------------------------------- compliance */

/** CMP-05. Consent binds to the version of the notice in force at the time. */
export const privacyNotices = pgTable(
  'privacy_notices',
  {
    id: id(),
    version: integer('version').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('privacy_notices_version_key').on(t.version)],
);

/** CMP-06. Granular, timestamped, versioned, withdrawable. */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', {
      enum: ['application_processing', 'post_programme_retention', 'alumni_directory', 'marketing'],
    }).notNull(),
    granted: boolean('granted').notNull(),
    noticeVersion: integer('notice_version').notNull(),
    /** The exact wording shown, stored verbatim. An audit asks for this. */
    purposeTextShown: text('purpose_text_shown').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    recordedAt: createdAt(),
  },
  (t) => [index('consent_records_user_purpose_idx').on(t.userId, t.purpose)],
);

/** CMP-07. The 30-day statutory clock is `dueAt`, set at intake. */
export const dataSubjectRequests = pgTable('data_subject_requests', {
  id: id(),
  institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  subjectEmail: text('subject_email').notNull(),
  kind: text('kind', {
    enum: ['access', 'rectification', 'erasure', 'portability', 'objection', 'restriction'],
  }).notNull(),
  detail: text('detail'),
  /** §6.3: routed to whichever party is controller for the data in question. */
  routedTo: text('routed_to', { enum: ['platform', 'institution'] })
    .notNull()
    .default('platform'),
  /**
   * §6.6: verify the requester before fulfilling — but do not demand more
   * identity data than we already hold. This records that the check happened
   * and how, not a pile of fresh identity documents.
   */
  identityVerifiedAt: timestamp('identity_verified_at', { withTimezone: true }),
  identityVerifiedNote: text('identity_verified_note'),
  status: text('status', {
    enum: ['received', 'verifying', 'in_progress', 'routed', 'fulfilled', 'refused'],
  })
    .notNull()
    .default('received'),
  receivedAt: createdAt(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  outcomeNote: text('outcome_note'),
  handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
});

/** CMP-09. The 72-hour notification clock runs from `discoveredAt`. */
export const breaches = pgTable('breaches', {
  id: id(),
  institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull(),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  affectedSubjectCount: integer('affected_subject_count'),
  dataCategories: text('data_categories').array(),
  ndpcNotifiedAt: timestamp('ndpc_notified_at', { withTimezone: true }),
  subjectsNotifiedAt: timestamp('subjects_notified_at', { withTimezone: true }),
  status: text('status', { enum: ['open', 'contained', 'notified', 'closed'] })
    .notNull()
    .default('open'),
  createdAt: createdAt(),
});

/** CMP-04. A living Record of Processing Activities, exportable on demand. */
export const processingActivities = pgTable('processing_activities', {
  id: id(),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  lawfulBasis: text('lawful_basis').notNull(),
  dataCategories: text('data_categories').array().notNull(),
  subjectCategories: text('subject_categories').array().notNull(),
  controller: text('controller').notNull(),
  processors: text('processors').array(),
  retentionRule: text('retention_rule').notNull(),
  crossBorder: text('cross_border'),
  updatedAt: updatedAt(),
});

/** CMP-10. The purge job reports against this, and DP-07 renders it. */
export const retentionRules = pgTable('retention_rules', {
  id: id(),
  entity: text('entity').notNull(),
  condition: text('condition').notNull(),
  retainDays: integer('retain_days').notNull(),
  basis: text('basis').notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastPurgedCount: integer('last_purged_count').notNull().default(0),
});

/**
 * AUTH-09 / CMP-14. Immutable: the app role holds INSERT and SELECT only, with
 * no UPDATE or DELETE grant. Retained 12 months.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    institutionId: uuid('institution_id'),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    /** Present when staff read or write a record belonging to another person. */
    subjectId: uuid('subject_id'),
    ipHash: text('ip_hash'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    at: createdAt(),
  },
  (t) => [
    index('audit_log_institution_at_idx').on(t.institutionId, t.at),
    index('audit_log_subject_idx').on(t.subjectId),
  ],
);

/**
 * Tables deliberately NOT tenant-scoped. Anything absent from this list and
 * lacking institution_id fails the schema guard in tests/isolation.test.ts.
 */
export const SHARED_TABLES = [
  'institutions',
  'users',
  'sessions',
  'memberships',
  'auth_tokens',
  'sso_nonces',
  'inbound_events',
  'licences',
  'library_items',
  'takedown_requests',
  'bookmarks',
  'alumni_profiles',
  'privacy_notices',
  'consent_records',
  'data_subject_requests',
  'breaches',
  'processing_activities',
  'retention_rules',
  'audit_log',
] as const;
