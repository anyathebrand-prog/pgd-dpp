/**
 * Shared between server and client code, so this file deliberately carries no
 * `server-only` import and touches no database.
 */

/** APP-04. The five things registry needs before it can assess anyone. */
export const REQUIRED_DOCUMENTS = [
  { kind: 'degree_certificate' as const, label: 'Degree certificate', hint: 'PDF or a clear photograph' },
  { kind: 'transcript' as const, label: 'Academic transcript', hint: 'All pages, in one file if possible' },
  { kind: 'nysc_certificate' as const, label: 'NYSC certificate or exemption', hint: 'PDF, JPG or PNG' },
  {
    kind: 'passport_photo' as const,
    label: 'Passport photograph',
    hint: 'Recent, plain background, face clearly visible',
  },
  {
    kind: 'id_document' as const,
    label: 'Photo identification',
    hint: "Driver's licence, voter card, national ID or passport",
  },
];

export const APPLICATION_STEPS = [
  { href: '/apply/personal', label: 'Personal details', key: 'personal' as const },
  { href: '/apply/education', label: 'Education history', key: 'education' as const },
  { href: '/apply/experience', label: 'Work and sponsor', key: 'experience' as const },
  { href: '/apply/documents', label: 'Documents', key: 'documents' as const },
  { href: '/apply/consent', label: 'Consent', key: 'consent' as const },
  { href: '/apply/review', label: 'Review and submit', key: 'review' as const },
];
