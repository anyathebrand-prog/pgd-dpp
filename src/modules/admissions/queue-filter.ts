import { eq, inArray, type SQL } from 'drizzle-orm';
import { applications } from '@/db/schema';

/**
 * RG-01's status filter, shared with RG-06 so that "export this view" exports
 * exactly the view.
 *
 * It lived inline on the queue page and got `all` wrong: `all` fell through to
 * the needs-action branch, so the filter labelled "Everything" showed only the
 * applications waiting on the registry. Sharing it is also what makes the
 * export trustworthy — two copies of a filter are two chances to disagree
 * about which people a file contains.
 */
export const ACTIONABLE = ['submitted', 'under_review', 'documents_queried'] as const;

const KNOWN = [
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
] as const;

export function statusFilter(status: string | undefined): SQL | undefined {
  if (status === 'all') return undefined;
  if (status && (KNOWN as readonly string[]).includes(status)) {
    return eq(applications.status, status as (typeof KNOWN)[number]);
  }
  return inArray(applications.status, [...ACTIONABLE]);
}

export function statusLabel(status: string | undefined) {
  if (status === 'all') return 'every application';
  if (status && (KNOWN as readonly string[]).includes(status)) return `${status.replace(/_/g, ' ')} applications`;
  return 'applications needing action';
}
