/**
 * §7.9: local is seeded with a TWO-tenant fixture, deliberately.
 *
 * A one-tenant development database makes tenant leaks invisible until
 * production. With four institutions that all have applications, staff and
 * cohorts, a missing `institution_id` filter shows up the first time someone
 * opens a queue — and the isolation test in tests/isolation.test.ts has real
 * data on both sides to prove the point.
 *
 * Runs as the owner role, like migrations. That is why it can write across
 * tenants, and why nothing on the request path may import it.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { hash as argonHash } from '@node-rs/argon2';
import * as s from './schema';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be set');

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema: s });

const PASSWORD = 'Passw0rd-seed-2026';
const day = 86_400_000;

async function main() {
  console.log('Clearing seed data…');
  // Order matters only where cascades do not cover it.
  for (const table of [
    'grades', 'submissions', 'questions', 'assessments', 'lesson_progress', 'lessons', 'modules',
    'announcements', 'certificates', 'transaction_lines', 'transactions', 'inbound_events',
    'document_queries', 'documents', 'enrollments', 'applications', 'fee_items', 'cohorts',
    'programmes', 'alumni_profiles', 'consent_records', 'audit_log', 'sessions', 'auth_tokens',
    'memberships', 'data_subject_requests', 'breaches', 'retention_rules', 'processing_activities',
    'library_items', 'licences', 'privacy_notices', 'users', 'institutions',
  ]) {
    await sql.unsafe(`TRUNCATE TABLE public."${table}" RESTART IDENTITY CASCADE`);
  }

  const passwordHash = await argonHash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  /* ------------------------------------------------------------- compliance */

  await db.insert(s.privacyNotices).values({
    version: 1,
    effectiveFrom: new Date('2026-01-01'),
    body: [
      'This notice explains what the platform and your institution do with your personal data.',
      '',
      'We process your application details and documents to assess your application and, if you',
      'are admitted, to enrol you. Your institution decides admissions and owns your academic',
      'record. The platform operates the systems and handles payments.',
      '',
      'Your rights: access, rectification, erasure, portability, objection and restriction. Write',
      'to the Data Protection Officer at dpo@example.ng. We answer within 30 days.',
    ].join('\n'),
  });

  await db.insert(s.retentionRules).values([
    {
      entity: 'documents (rejected applicants)',
      condition: 'application rejected or withdrawn',
      retainDays: 180,
      basis: 'No further purpose once the decision is final. The dominant exposure in the funnel.',
    },
    {
      entity: 'documents (unsuccessful drafts)',
      condition: 'application left in draft, no activity',
      retainDays: 365,
      basis: 'Abandoned applications accumulate credentials nobody is accountable for.',
    },
    { entity: 'audit_log', condition: 'always', retainDays: 365, basis: 'AUTH-09: retained 12 months.' },
    {
      entity: 'sessions',
      condition: 'expired or revoked',
      retainDays: 90,
      basis: 'Needed briefly for incident investigation, not indefinitely.',
    },
  ]);

  await db.insert(s.processingActivities).values([
    {
      name: 'Admissions assessment',
      purpose: 'Assess applications and issue admission decisions',
      lawfulBasis: 'Steps at the data subject request prior to a contract',
      dataCategories: ['identity', 'contact', 'education history', 'credential documents', 'photograph'],
      subjectCategories: ['candidates'],
      controller: 'Institution',
      processors: ['Platform', 'Cloudflare R2', 'Resend'],
      retentionRule: 'documents (rejected applicants)',
      crossBorder: 'Database and object storage hosted in the EU; transfer basis documented in the DPIA.',
    },
    {
      name: 'Payment processing',
      purpose: 'Collect application, acceptance and tuition fees, and settle to institutions',
      lawfulBasis: 'Performance of a contract',
      dataCategories: ['name', 'email', 'transaction reference', 'amount'],
      subjectCategories: ['candidates', 'students'],
      controller: 'Platform',
      processors: ['Paystack'],
      retentionRule: 'Financial records retained per tax law',
      crossBorder: 'Paystack processes in Nigeria. No card data reaches the platform.',
    },
  ]);

  await db.insert(s.licences).values([
    {
      code: 'NG-GOV',
      name: 'Nigerian government work',
      allowsHosting: true,
      allowsDownload: true,
      statement: 'Government work, freely reproducible. Reproduced in full with source attribution.',
    },
    {
      code: 'PUBLIC-RECORD',
      name: 'Public record — court judgment',
      allowsHosting: true,
      allowsDownload: true,
      statement: 'Public record. Reproduced with the court and citation stated.',
    },
    {
      code: 'LINK-ONLY',
      name: 'All rights reserved — metadata only',
      allowsHosting: false,
      allowsDownload: false,
      statement: 'Copyright retained by the publisher. Metadata and abstract only, with a link to source.',
    },
  ]);

  const [ngGov] = await db.select().from(s.licences).limit(1);

  await db.insert(s.libraryItems).values([
    {
      collection: 'library',
      title: 'Nigeria Data Protection Act 2023',
      citation: 'NDPA 2023',
      jurisdiction: 'Nigeria',
      instrumentType: 'Statute',
      year: 2023,
      subjectAreas: ['data protection', 'enforcement', 'DPO'],
      abstract: 'The principal statute establishing the Nigeria Data Protection Commission.',
      licenceId: ngGov.id,
      sourceAttribution: 'Federal Republic of Nigeria, published by the NDPC.',
      status: 'published',
    },
    {
      collection: 'library',
      title: 'General Application and Implementation Directive 2025',
      citation: 'GAID 2025',
      jurisdiction: 'Nigeria',
      instrumentType: 'Directive',
      year: 2025,
      subjectAreas: ['compliance', 'registration', 'DCPMI tiering'],
      abstract: 'Effective 19 September 2025. Sets registration tiers, audit and reporting duties.',
      licenceId: ngGov.id,
      sourceAttribution: 'Nigeria Data Protection Commission.',
      status: 'published',
    },
  ]);

  /* ------------------------------------------------------------ institutions */

  const institutions = await db
    .insert(s.institutions)
    .values([
      {
        slug: 'unilag',
        name: 'University of Lagos',
        shortName: 'UNILAG',
        city: 'Lagos',
        brandColour: '#1B3A6B',
        paystackSubaccountCode: 'ACCT_seed_unilag',
        paystackSharePercent: 90,
        // SSO-02. A real institution's secret is exchanged during onboarding
        // and never committed; this is a fixture so the handoff is testable.
        ssoSharedSecret: 'seed-unilag-sso-secret-do-not-use-in-production',
        bankName: 'First Bank of Nigeria',
        bankAccountName: 'University of Lagos — PGD DPP',
        bankAccountNumber: '2031457789',
        offerExpiryDays: 14,
        status: 'live',
      },
      {
        slug: 'fulokoja',
        name: 'Federal University Lokoja',
        shortName: 'FUL',
        city: 'Lokoja',
        brandColour: '#0E5C3A',
        paystackSubaccountCode: 'ACCT_seed_fulokoja',
        paystackSharePercent: 88,
        bankName: 'Zenith Bank',
        bankAccountName: 'Federal University Lokoja — PGD DPP',
        bankAccountNumber: '1229930041',
        offerExpiryDays: 21,
        status: 'live',
      },
      {
        slug: 'futo',
        name: 'Federal University of Technology, Owerri',
        shortName: 'FUTO',
        city: 'Owerri',
        brandColour: '#1D5E3C',
        paystackSubaccountCode: 'ACCT_seed_futo',
        paystackSharePercent: 88,
        bankName: 'Access Bank',
        bankAccountName: 'Federal University of Technology Owerri — PGD DPP',
        bankAccountNumber: '0691247735',
        offerExpiryDays: 21,
        status: 'live',
      },
      {
        slug: 'kasu',
        name: 'Kaduna State University',
        shortName: 'KASU',
        city: 'Kaduna',
        brandColour: '#1E6B3A',
        paystackSubaccountCode: 'ACCT_seed_kasu',
        paystackSharePercent: 88,
        bankName: 'Jaiz Bank',
        bankAccountName: 'Kaduna State University — PGD DPP',
        bankAccountNumber: '0004718826',
        offerExpiryDays: 21,
        status: 'live',
      },
    ])
    .returning();

  const [unilag, ful, futo, kasu] = institutions;

  /*
   * What differs between the seeded universities, in one table, so a new
   * one gets its own people and figures instead of silently copying the
   * last. Keyed by slug.
   */
  const PER: Record<
    string,
    {
      intake: string;
      capacity: number;
      applicationKobo: number;
      tuitionKobo: number;
      facilitator: string;
      candidate: string;
      candidateState: string;
      student: string;
      matric: string;
    }
  > = {
    unilag: {
      intake: 'January 2027 intake',
      capacity: 60,
      applicationKobo: 2_500_000,
      tuitionKobo: 45_000_000,
      facilitator: 'Dr Yemi Sowande',
      candidate: 'Blessing Oyelaran',
      candidateState: 'Ogun',
      student: 'Kelechi Obi',
      matric: 'A1042',
    },
    fulokoja: {
      intake: 'February 2027 intake',
      capacity: 40,
      applicationKobo: 2_000_000,
      tuitionKobo: 38_000_000,
      facilitator: 'Dr Ngozi Okafor',
      candidate: 'Emeka Aniuno',
      candidateState: 'Anambra',
      student: 'Hauwa Suleiman',
      matric: 'B2071',
    },
    futo: {
      intake: 'March 2027 intake',
      capacity: 50,
      applicationKobo: 2_200_000,
      tuitionKobo: 40_000_000,
      facilitator: 'Dr Chinedu Nwachukwu',
      candidate: 'Amarachi Okeke',
      candidateState: 'Imo',
      student: 'Obinna Eze',
      matric: 'C3108',
    },
    kasu: {
      intake: 'April 2027 intake',
      capacity: 45,
      applicationKobo: 1_800_000,
      tuitionKobo: 35_000_000,
      facilitator: 'Dr Aisha Bello',
      candidate: 'Musa Ibrahim',
      candidateState: 'Kaduna',
      student: 'Zainab Abdullahi',
      matric: 'D4215',
    },
  };

  for (const inst of institutions) {
    const [programme] = await db
      .insert(s.programmes)
      .values({
        institutionId: inst.id,
        summary:
          'A twelve-month online diploma in Nigerian data protection law and practice, for lawyers, compliance officers and IT professionals moving into the DPO role.',
        entryRequirements:
          'A first degree in any discipline.\nNYSC discharge or exemption certificate.\nTwo years of relevant work experience is preferred but not required.',
      })
      .returning();

    const [cohort] = await db
      .insert(s.cohorts)
      .values({
        institutionId: inst.id,
        programmeId: programme.id,
        name: PER[inst.slug].intake,
        capacity: PER[inst.slug].capacity,
        applicationOpensAt: new Date(Date.now() - 30 * day),
        applicationClosesAt: new Date(Date.now() + 60 * day),
        startsAt: new Date(Date.now() + 90 * day),
        status: 'open',
      })
      .returning();

    await db.insert(s.feeItems).values([
      {
        institutionId: inst.id,
        kind: 'application',
        label: 'Application fee',
        amountKobo: PER[inst.slug].applicationKobo,
      },
      { institutionId: inst.id, cohortId: cohort.id, kind: 'acceptance', label: 'Acceptance fee', amountKobo: 5_000_000 },
      {
        institutionId: inst.id,
        cohortId: cohort.id,
        kind: 'tuition',
        label: 'Tuition, first semester',
        amountKobo: PER[inst.slug].tuitionKobo,
      },
      { institutionId: inst.id, cohortId: cohort.id, kind: 'library_levy', label: 'Library levy', amountKobo: 1_500_000 },
    ]);

    const modules = await db
      .insert(s.modules)
      .values([
        {
          institutionId: inst.id,
          programmeId: programme.id,
          semester: 1,
          code: 'DPP-101',
          title: 'The NDPA 2023 in practice',
          summary: 'The Act as it is enforced: scope, principles, the Commission, and what actually triggers action.',
          position: 1,
          published: true,
        },
        {
          institutionId: inst.id,
          programmeId: programme.id,
          semester: 1,
          code: 'DPP-102',
          title: 'Lawful basis and consent',
          summary: 'Choosing a basis and living with it. Why most consent in Nigerian practice would not survive scrutiny.',
          position: 2,
          published: true,
        },
        {
          institutionId: inst.id,
          programmeId: programme.id,
          semester: 2,
          code: 'DPP-201',
          title: 'Breach response and the 72-hour clock',
          summary: 'Detection, containment, scoping affected subjects, and notifying the Commission.',
          position: 3,
          published: false,
        },
      ])
      .returning();

    await db.insert(s.lessons).values([
      {
        institutionId: inst.id,
        moduleId: modules[0].id,
        title: 'What the Act actually covers',
        position: 1,
        body: [
          'The NDPA 2023 applies to the processing of personal data where the data subject or the',
          'controller is in Nigeria, and — importantly for anyone advising a multinational — where',
          'processing takes place in Nigeria regardless of where the controller sits.',
          '',
          'Read section 2 alongside the definitions in section 65 before reading anything else. Most',
          'arguments about whether the Act applies are really arguments about the definition of',
          'processing, and they end quickly once you have read it.',
        ].join('\n'),
      },
      {
        institutionId: inst.id,
        moduleId: modules[0].id,
        title: 'The Commission and its enforcement posture',
        position: 2,
        body: [
          'The Nigeria Data Protection Commission replaced NITDA as the regulator. Its powers include',
          'investigation, compliance orders and penalties calculated against annual gross revenue.',
          '',
          'The practical question for a DPO is not whether the Commission can act, but what brings a',
          'controller to its attention: a complaint, a breach notification, or a sectoral sweep.',
        ].join('\n'),
      },
      {
        institutionId: inst.id,
        moduleId: modules[1].id,
        title: 'Six bases, and why you usually do not want consent',
        position: 1,
        body: [
          'Consent is the most visible lawful basis and the least robust. It must be freely given,',
          'specific, informed and unambiguous, and it must be as easy to withdraw as to give.',
          '',
          'A controller who relies on consent for something it will do anyway has chosen a basis that',
          'can evaporate at any moment. Legitimate interest or contractual necessity is often the',
          'honest answer, and saying so is not a weaker position.',
        ].join('\n'),
      },
    ]);

    const [assessment] = await db
      .insert(s.assessments)
      .values({
        institutionId: inst.id,
        moduleId: modules[0].id,
        title: 'DPP-101 end of module test',
        kind: 'quiz',
        instructions:
          'Ten minutes, one attempt. Answer every question. The short answer is marked by your facilitator, so your final result is not immediate.',
        timeLimitMinutes: 10,
        attemptLimit: 1,
        passMark: 50,
        published: true,
      })
      .returning();

    await db.insert(s.questions).values([
      {
        institutionId: inst.id,
        assessmentId: assessment.id,
        position: 1,
        kind: 'mcq',
        prompt: 'Which body is the supervisory authority under the NDPA 2023?',
        options: [
          { key: 'a', text: 'NITDA' },
          { key: 'b', text: 'The Nigeria Data Protection Commission' },
          { key: 'c', text: 'The Federal Ministry of Justice' },
          { key: 'd', text: 'The Nigerian Communications Commission' },
        ],
        correctAnswer: 'b',
        marks: 2,
      },
      {
        institutionId: inst.id,
        assessmentId: assessment.id,
        position: 2,
        kind: 'true_false',
        prompt: 'Consent must be as easy to withdraw as it was to give.',
        correctAnswer: 'true',
        marks: 1,
      },
      {
        institutionId: inst.id,
        assessmentId: assessment.id,
        position: 3,
        kind: 'short_answer',
        prompt:
          'A client relies on consent for processing it would carry out regardless. Explain in two or three sentences why that is a poor choice of lawful basis.',
        marks: 5,
      },
    ]);

    // G-18's console needs someone to own it. The facilitator is assigned to
    // the modules, because holding the role is not the same as teaching one.
    const [facilitator] = await db
      .insert(s.users)
      .values({
        email: `facilitator@${inst.slug}.example.ng`,
        fullName: PER[inst.slug].facilitator,
        passwordHash,
        status: 'staff',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: s.users.id });
    await db
      .insert(s.memberships)
      .values({ userId: facilitator.id, institutionId: inst.id, role: 'facilitator' });
    // The Faculty page: a published demo profile, without a photograph.
    const FACULTY: Record<string, { title: string; bio: string }> = {
      unilag: { title: "Senior Lecturer, Faculty of Law, University of Lagos", bio: "Dr Yemi Sowande teaches the NDPA 2023 in practice and consent that holds up. Before joining the Faculty of Law she spent nine years as Data Protection Officer at a Lagos commercial bank, where she led the bank's first GAID compliance audit and its response to a card-data breach. She is a licensed DPCO and writes on lawful bases in Nigerian financial services. (Demo profile.)" },
      fulokoja: { title: "Lecturer, Department of Computer Science, Federal University Lokoja", bio: "Dr Ngozi Okafor teaches privacy by design and data protection impact assessments. Her research covers health-data systems in north-central Nigeria, and she has advised two state ministries of health on consent and record retention. She holds a doctorate in information systems and the CIPP/E. (Demo profile.)" },
      futo: { title: "Associate Professor, School of Information and Communication Technology, FUTO", bio: "Dr Chinedu Nwachukwu teaches breach response and the 72-hour clock. A former incident-response lead at a telecoms operator, he has handled notifications to the Nigeria Data Protection Commission and trains engineering teams on containment and evidence. He brings the engineer's view of what the Act asks for. (Demo profile.)" },
      kasu: { title: "Lecturer, Faculty of Law, Kaduna State University", bio: "Dr Aisha Bello teaches audit and the DPCO regime, and the rights data subjects hold. She practised in regulatory compliance for public-sector bodies in the north-west before joining KASU, and has supervised annual audit filings for several data controllers of major importance. (Demo profile.)" },
    };
    if (FACULTY[inst.slug]) {
      await db.insert(s.facilitatorProfiles).values({ userId: facilitator.id, ...FACULTY[inst.slug], published: true });
    }
    for (const m of modules) {
      await db
        .update(s.modules)
        .set({ facilitatorId: facilitator.id })
        .where(eq(s.modules.id, m.id));
    }

    await db.insert(s.announcements).values({
      institutionId: inst.id,
      cohortId: cohort.id,
      title: 'Module DPP-101 is open',
      body: 'The first module is published. Work through both lessons before the live session on Saturday.',
    });
  }

  /* -------------------------------------------------------------------- users */

  async function user(email: string, fullName: string, status: typeof s.users.$inferInsert.status) {
    const [row] = await db
      .insert(s.users)
      .values({ email, fullName, passwordHash, status, emailVerifiedAt: new Date() })
      .returning();
    return row;
  }

  const staff = [
    { email: 'registry@unilag.example.ng', name: 'Adaeze Okonkwo', inst: unilag, role: 'registry' as const },
    { email: 'admin@unilag.example.ng', name: 'Tunde Bakare', inst: unilag, role: 'institution_admin' as const },
    { email: 'registry@fulokoja.example.ng', name: 'Ojone Adejoh', inst: ful, role: 'registry' as const },
    { email: 'admin@fulokoja.example.ng', name: 'Abdullahi Salihu', inst: ful, role: 'institution_admin' as const },
    { email: 'registry@futo.example.ng', name: 'Chiamaka Iwu', inst: futo, role: 'registry' as const },
    { email: 'admin@futo.example.ng', name: 'Ikenna Duru', inst: futo, role: 'institution_admin' as const },
    { email: 'registry@kasu.example.ng', name: 'Fatima Yusuf', inst: kasu, role: 'registry' as const },
    { email: 'admin@kasu.example.ng', name: 'Sani Garba', inst: kasu, role: 'institution_admin' as const },
  ];

  for (const member of staff) {
    const u = await user(member.email, member.name, 'staff');
    // AUTH-08: staff TOTP is mandatory. The seed leaves it unconfirmed so the
    // enrolment screen is exercised on first login rather than skipped.
    await db.insert(s.memberships).values({ userId: u.id, institutionId: member.inst.id, role: member.role });
  }

  /**
   * LIB-05. The curator is a platform role, not an institution's: the corpus
   * is shared, and §5.7 is explicit that its licensing is a platform-level
   * responsibility rather than something each university decides for itself.
   * The membership rows exist because that is where roles live; the role is
   * in PLATFORM_ROLES, so it holds everywhere.
   */
  const curator = await user('curator@example.ng', 'Amina Yusuf', 'staff');
  for (const inst of institutions) {
    await db.insert(s.memberships).values({ userId: curator.id, institutionId: inst.id, role: 'curator' });
  }

  /**
   * SA-01. There was no super admin in the seed at all, which meant the one
   * role that provisions institutions had never been signed into — and the
   * console it lands on was a 404 nobody noticed.
   */
  const superAdmin = await user('platform@example.ng', 'Bisi Adewale', 'staff');
  for (const inst of institutions) {
    await db.insert(s.memberships).values({ userId: superAdmin.id, institutionId: inst.id, role: 'super_admin' });
  }

  const dpo = await user('dpo@example.ng', 'Ngozi Adeyemi', 'staff');
  for (const inst of institutions) {
    await db.insert(s.memberships).values({ userId: dpo.id, institutionId: inst.id, role: 'dpo' });
  }

  /* -------------------------------------------- candidates, one per tenant */

  for (const inst of institutions) {
    const [cohort] = await db
      .select()
      .from(s.cohorts)
      .where(eq(s.cohorts.institutionId, inst.id));

    const candidate = await user(
      `candidate@${inst.slug}.example.ng`,
      PER[inst.slug].candidate,
      'candidate',
    );
    await db.insert(s.memberships).values({ userId: candidate.id, institutionId: inst.id, role: 'candidate' });

    const [application] = await db
      .insert(s.applications)
      .values({
        institutionId: inst.id,
        cohortId: cohort.id,
        userId: candidate.id,
        reference: `APP-2026-${inst.slug.toUpperCase()}1`,
        status: 'submitted',
        submittedAt: new Date(Date.now() - 6 * day),
        personal: {
          fullName: PER[inst.slug].candidate,
          dob: '1994-04-12',
          gender: 'female',
          phone: '08031234567',
          address: '14 Association Road, Ikeja',
          stateOfOrigin: PER[inst.slug].candidateState,
          nationality: 'Nigerian',
          nokName: 'Folake Oyelaran',
          nokPhone: '08039876543',
        },
        education: {
          institution: 'Obafemi Awolowo University',
          degree: 'LLB',
          classOfDegree: '2:1',
          yearOfGraduation: '2017',
        },
        experience: {
          employer: 'Sterling Bank',
          role: 'Compliance analyst',
          years: '4',
          sponsorType: 'employer',
          statement: 'I handle DSARs in a regulated business and want the law behind the practice.',
        },
      })
      .returning();

    await db.insert(s.consentRecords).values(
      (['application_processing', 'post_programme_retention', 'alumni_directory', 'marketing'] as const).map(
        (purpose, i) => ({
          institutionId: inst.id,
          userId: candidate.id,
          purpose,
          granted: i < 3,
          noticeVersion: 1,
          purposeTextShown: 'Seeded consent record.',
        }),
      ),
    );

    // A settled application fee, so the registry queue has something real in it.
    await db.insert(s.transactions).values({
      institutionId: inst.id,
      userId: candidate.id,
      applicationId: application.id,
      reference: `APP-SEED${inst.slug.toUpperCase()}`,
      context: 'application',
      amountKobo: PER[inst.slug].applicationKobo,
      status: 'success',
      paidAt: new Date(Date.now() - 6 * day),
      subaccountCode: inst.paystackSubaccountCode,
      institutionShareKobo: 2_250_000,
      platformShareKobo: 250_000,
    });

    /* An enrolled student, so the learning surfaces have a subject. */
    const student = await user(
      `student@${inst.slug}.example.ng`,
      PER[inst.slug].student,
      'student',
    );
    await db.insert(s.memberships).values({ userId: student.id, institutionId: inst.id, role: 'student' });
    await db.insert(s.enrollments).values({
      institutionId: inst.id,
      userId: student.id,
      cohortId: cohort.id,
      matricNumber: `${inst.shortName}/DPP/2027/${PER[inst.slug].matric}`,
    });

    // An attempt waiting to be marked. The MCQ and true/false are already
    // scored; the short answer is why a person has to look at it.
    const [quiz] = await db
      .select()
      .from(s.assessments)
      .where(eq(s.assessments.institutionId, inst.id));
    const quizQuestions = await db
      .select()
      .from(s.questions)
      .where(eq(s.questions.assessmentId, quiz.id));

    const answers: Record<string, string> = {};
    for (const q of quizQuestions) {
      answers[q.id] =
        q.kind === 'short_answer'
          ? 'Because consent can be withdrawn at any moment, and a controller who would carry on processing regardless has chosen a basis that does not describe what it is actually doing.'
          : (q.correctAnswer ?? '');
    }

    await db.insert(s.submissions).values({
      institutionId: inst.id,
      assessmentId: quiz.id,
      userId: student.id,
      attempt: 1,
      answers,
      autoScore: quizQuestions
        .filter((q) => q.kind !== 'short_answer')
        .reduce((sum, q) => sum + q.marks, 0),
      submittedAt: new Date(Date.now() - 3 * day),
      status: 'submitted',
    });
  }

  /* --------------------------------------------------------------- DPO data */

  await db.insert(s.dataSubjectRequests).values([
    {
      institutionId: unilag.id,
      subjectEmail: 'former.applicant@example.ng',
      kind: 'erasure',
      detail: 'Rejected in the 2026 intake. Asks for the transcript and photograph to be deleted now.',
      routedTo: 'institution',
      status: 'in_progress',
      receivedAt: new Date(Date.now() - 22 * day),
      dueAt: new Date(Date.now() + 8 * day),
    },
    {
      subjectEmail: 'alumna@example.ng',
      kind: 'access',
      detail: 'Asks for everything held, including the audit trail of who has opened her file.',
      routedTo: 'platform',
      status: 'received',
      receivedAt: new Date(Date.now() - 28 * day),
      dueAt: new Date(Date.now() + 2 * day),
    },
  ]);

  console.log('');
  console.log('Seeded four tenants.');
  console.log('  http://unilag.localhost:3000   University of Lagos');
  console.log('  http://fulokoja.localhost:3000 Federal University Lokoja');
  console.log('  http://futo.localhost:3000     Federal University of Technology, Owerri');
  console.log('  http://kasu.localhost:3000     Kaduna State University');
  console.log('  http://localhost:3000          platform landing');
  console.log('');
  console.log(`Every seeded account uses the password: ${PASSWORD}`);
  console.log('  candidate@unilag.example.ng   submitted application');
  console.log('  student@unilag.example.ng     enrolled student');
  console.log('  registry@unilag.example.ng    registry officer (TOTP enrolment on first login)');
  console.log('  facilitator@unilag.example.ng teaching console at /teach, with work to mark');
  console.log('  admin@unilag.example.ng       institution admin console at /admin');
  console.log('  dpo@example.ng                DPO console at http://app.localhost:3000/dpo');
  console.log('  curator@example.ng            library curator at http://app.localhost:3000/curate');
  console.log('  platform@example.ng           super admin at http://app.localhost:3000/platform/tenants');
  console.log('');
  console.log('The FUL, FUTO and KASU accounts mirror these. Try reading a UNILAG record while signed in as FUL.');

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
