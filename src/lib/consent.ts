import 'server-only';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { privacyNotices } from '@/db/schema';

/**
 * CMP-05 / CMP-06 — granular consent, bound to the notice version in force.
 *
 * APP-02 is explicit that this is four separate decisions, not one bundled
 * "I agree". Two of them (retention beyond the programme, marketing) are
 * genuinely optional and the application must proceed without them; the
 * alumni directory one is what ALM-03 later depends on. The wording shown is
 * stored verbatim on the consent record, because an auditor asks what the
 * person actually read, not what the current copy says.
 */
export const CONSENT_PURPOSES = [
  {
    key: 'application_processing' as const,
    title: 'Processing this application',
    text:
      'The institution and the platform process the details and documents you submit in order to assess your application and, if you are admitted, to enrol you.',
    required: true,
    /** §6.4: this one is not really consent — it is necessary for the contract. */
    lawfulBasisNote: 'Necessary to take steps at your request before entering a contract.',
  },
  {
    key: 'post_programme_retention' as const,
    title: 'Keeping your record after the programme ends',
    text:
      'Your academic record is kept as the institution’s permanent student record. Supporting documents you uploaded are kept only for as long as the retention schedule allows, and are then deleted.',
    required: false,
    lawfulBasisNote: 'Legal obligation for the academic record; consent for anything beyond it.',
  },
  {
    key: 'alumni_directory' as const,
    title: 'Appearing in the alumni directory when you graduate',
    text:
      'Other alumni could see your name, institution, cohort year and anything you choose to add. Your profile stays private until you turn this on, and you can turn it off at any time.',
    required: false,
    lawfulBasisNote: 'Consent. Withdrawable without affecting anything else.',
  },
  {
    key: 'marketing' as const,
    title: 'Updates about other programmes and events',
    text:
      'Occasional email about future intakes, CPD sessions and events. Declining has no effect on your application.',
    required: false,
    lawfulBasisNote: 'Consent. Withdrawable at any time, and every message carries an unsubscribe link.',
  },
];

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]['key'];

export async function currentNoticeVersion(): Promise<number> {
  const [row] = await db
    .select({ version: privacyNotices.version })
    .from(privacyNotices)
    .orderBy(desc(privacyNotices.version))
    .limit(1);
  return row?.version ?? 1;
}
