'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, takedownRequests } from '@/db/schema';
import { humanCode } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { sendMail, takedownAcknowledgement, takedownNotice } from '@/lib/mail';
import { rateLimit } from '@/lib/ratelimit';
import type { FormState } from '../auth/actions';

const BASES = ['copyright', 'personal_data', 'inaccuracy', 'other'] as const;

const BASIS_LABEL: Record<(typeof BASES)[number], string> = {
  copyright: 'Copyright or licensing',
  personal_data: 'Personal data about me',
  inaccuracy: 'The item is inaccurate or misattributed',
  other: 'Something else',
};

/**
 * LB-05 (LIB-07).
 *
 * Unauthenticated, because a rights holder is not a user of this platform and
 * requiring them to become one would be a way of receiving fewer claims
 * rather than a way of handling them. §5.7 is blunt about why this matters: a
 * data protection programme distributing material it has no licence for is
 * not survivable, and the takedown route is the part of that promise anyone
 * outside can actually test.
 *
 * The claimant gets a reference immediately. "We'll look into it" with nothing
 * to quote is how a claim becomes a lawyer's letter.
 */
export async function submitTakedown(_prev: FormState, form: FormData): Promise<FormState> {
  const claimantName = String(form.get('claimantName') ?? '').trim();
  const claimantEmail = String(form.get('claimantEmail') ?? '').trim().toLowerCase();
  const claimantOrganisation = String(form.get('claimantOrganisation') ?? '').trim();
  const itemDescription = String(form.get('itemDescription') ?? '').trim();
  const itemId = String(form.get('itemId') ?? '').trim();
  const basis = String(form.get('basis') ?? '') as (typeof BASES)[number];
  const detail = String(form.get('detail') ?? '').trim();
  const declared = form.get('declaration') === 'on';

  if (claimantName.length < 2) return { error: 'Enter the name of the person making the claim.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(claimantEmail)) {
    return { error: 'Enter an email address we can reply to, in the form name@example.com.' };
  }
  if (itemDescription.length < 3) {
    return { error: 'Name the item, or describe it well enough that a curator can find it.' };
  }
  if (!BASES.includes(basis)) return { error: 'Choose the basis for the claim.' };
  if (detail.length < 20) {
    return { error: 'Say what the problem is. A curator has to be able to act on this.' };
  }
  if (!declared) {
    // The declaration is not a formality: it is what makes a knowingly false
    // claim something other than a free way to remove inconvenient material.
    return { error: 'Confirm the declaration before submitting.' };
  }

  if (!rateLimit(`takedown:${claimantEmail}`, 5, 24 * 3_600_000).allowed) {
    return {
      error:
        'Several claims have already been logged from this address in the last day. Those are being reviewed first.',
    };
  }

  // The item reference is optional and unverified from the browser, so it is
  // only stored once it matches something real.
  const [item] = itemId
    ? await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1)
    : [];

  const reference = `TD-${humanCode(8)}`;

  await db.insert(takedownRequests).values({
    reference,
    itemId: item?.id ?? null,
    itemDescription: item?.title ?? itemDescription,
    claimantName,
    claimantEmail,
    claimantOrganisation: claimantOrganisation || null,
    basis,
    detail,
  });

  await audit({
    action: 'library.takedown_received',
    entity: 'takedown_requests',
    detail: { reference, basis, itemId: item?.id ?? null },
  });

  await sendMail(takedownAcknowledgement(claimantEmail, reference));
  await sendMail(
    takedownNotice(
      process.env.DPO_EMAIL ?? 'dpo@example.ng',
      reference,
      BASIS_LABEL[basis],
      item?.title ?? itemDescription,
    ),
  );

  return { redirectTo: `/library/takedown/received?ref=${reference}` };
}
