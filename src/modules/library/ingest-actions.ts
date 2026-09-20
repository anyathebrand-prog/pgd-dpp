'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems, licences } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { planIngest, subjectsOf } from './ingest';
import type { FormState } from '../auth/actions';

/**
 * LIB-09 — bringing a sheet of items in as drafts.
 *
 * Two passes and the curator sees the first one. "Check the sheet" reports
 * what would happen without writing anything; "Bring them in" does it. For a
 * hundred rows at once that separation is the difference between a mistake
 * you can read and a mistake you have to undo.
 *
 * Everything lands as a draft. CU-02 makes licence and provenance blocking
 * for publication and this path does not get an exception — a bulk route that
 * could publish would be the way around the only rule the library has.
 */

async function licenceIndex() {
  const rows = await db.select().from(licences);
  return {
    codes: rows.map((l) => l.code.toUpperCase()),
    byCode: new Map(rows.map((l) => [l.code.toUpperCase(), l.id])),
  };
}

/** Dry run: says what it would do and writes nothing. */
export async function checkIngest(_prev: FormState, form: FormData): Promise<FormState> {
  await requireRole('curator', 'super_admin');

  const csv = String(form.get('csv') ?? '');
  if (csv.trim().length === 0) return { error: 'Paste a sheet first.' };

  const { codes } = await licenceIndex();
  const plan = planIngest(csv, codes);

  const problems = plan.problems.map((p) => `Line ${p.line}: ${p.problem}`).join('\n');
  return {
    notice: [
      `${plan.rows.length} ${plan.rows.length === 1 ? 'item' : 'items'} would be brought in as drafts.`,
      plan.problems.length > 0
        ? `${plan.problems.length} ${plan.problems.length === 1 ? 'row' : 'rows'} would be skipped:\n${problems}`
        : 'Nothing would be skipped.',
    ].join('\n\n'),
  };
}

export async function runIngest(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireRole('curator', 'super_admin');

  const csv = String(form.get('csv') ?? '');
  if (csv.trim().length === 0) return { error: 'Paste a sheet first.' };

  const { codes, byCode } = await licenceIndex();
  const plan = planIngest(csv, codes);

  if (plan.rows.length === 0) {
    return {
      error:
        plan.problems.length > 0
          ? `Nothing could be brought in. ${plan.problems[0].problem}`
          : 'There are no rows in that sheet.',
    };
  }

  /*
   * Titles already in the catalogue are skipped rather than duplicated.
   *
   * §5.7's target is a few hundred curated items, so the same statute arriving
   * twice from two sources is a live risk and a duplicate is worse than a
   * missing row: a reader cannot tell which of two identical entries is the
   * one with the right licence on it.
   */
  const titles = plan.rows.map((r) => r.values.title);
  const existing = await db
    .select({ title: libraryItems.title })
    .from(libraryItems)
    .where(inArray(libraryItems.title, titles));
  const already = new Set(existing.map((e) => e.title.toLowerCase()));

  const toCreate = plan.rows.filter((r) => !already.has(r.values.title.toLowerCase()));
  const skipped = plan.rows.length - toCreate.length;

  if (toCreate.length > 0) {
    await db.insert(libraryItems).values(
      toCreate.map((r) => ({
        title: r.values.title,
        citation: r.values.citation || null,
        authors: r.values.authors || null,
        jurisdiction: r.values.jurisdiction || null,
        instrumentType: r.values.instrumentType || null,
        court: r.values.court || null,
        subjectAreas: subjectsOf(r.values.subjectAreas),
        year: r.values.year ? Number(r.values.year) : null,
        abstract: r.values.abstract || null,
        externalUrl: r.values.externalUrl || null,
        licenceId: byCode.get(r.values.licence.toUpperCase()) ?? null,
        sourceAttribution: r.values.sourceAttribution,
        // Never published from here. A curator opens each one at CU-02.
        status: 'draft' as const,
      })),
    );
  }

  await audit({
    action: 'library.bulk_ingested',
    actorId: me.userId,
    actorRole: 'curator',
    entity: 'library_items',
    detail: {
      created: toCreate.length,
      duplicatesSkipped: skipped,
      rowsRefused: plan.problems.length,
    },
  });

  const parts = [`${toCreate.length} ${toCreate.length === 1 ? 'item' : 'items'} brought in as drafts`];
  if (skipped > 0) parts.push(`${skipped} already in the catalogue`);
  if (plan.problems.length > 0) {
    parts.push(`${plan.problems.length} ${plan.problems.length === 1 ? 'row' : 'rows'} refused`);
  }

  // The outcome travels in the URL: the queue below is about to re-render
  // with the new drafts in it.
  return { redirectTo: `/curate?ingested=${encodeURIComponent(parts.join(', '))}` };
}
