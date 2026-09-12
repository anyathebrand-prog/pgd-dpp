import 'server-only';
import { headers } from 'next/headers';
import { db } from '@/db';
import { auditLog } from '@/db/schema';
import { clientIp } from './auth';
import { hashIp } from './crypto';

/**
 * AUTH-09 / CMP-14. Append-only: the application database role holds INSERT
 * and SELECT on this table and nothing else, so a staff member with full
 * application access still cannot edit the record of what they did.
 *
 * `subjectId` is the data subject whose record was touched. It is what makes
 * CMP-09 ("scope the affected data subjects within hours") answerable with a
 * single indexed query instead of a forensic exercise.
 */
export async function audit(entry: {
  action: string;
  institutionId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  entity?: string;
  entityId?: string;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
}) {
  const h = await headers();
  await db.insert(auditLog).values({
    action: entry.action,
    institutionId: entry.institutionId ?? null,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    subjectId: entry.subjectId ?? null,
    ipHash: hashIp(clientIp(h)),
    detail: entry.detail ?? {},
  });
}
