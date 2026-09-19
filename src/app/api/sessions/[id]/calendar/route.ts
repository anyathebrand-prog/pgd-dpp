import { eq } from 'drizzle-orm';
import { withTenant } from '@/db';
import { liveSessions } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireInstitution } from '@/lib/tenant';

/**
 * LRN-07's calendar invite.
 *
 * An .ics file rather than a Google Calendar link, because the students this
 * is for are on Outlook at work, Google at home and a Nigerian carrier's mail
 * app on the phone, and .ics is the one thing all three understand.
 *
 * The join link is deliberately NOT in the invite. Attendance (LRN-10) is
 * recorded at the moment we hand over the link, and an .ics sitting in an
 * inbox with the URL inside it would route around that — the invite says
 * where to go on this platform, and the platform hands over the link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const institution = await requireInstitution();

  const [session] = await withTenant(institution.id, (tx) =>
    tx.select().from(liveSessions).where(eq(liveSessions.id, id)).limit(1),
  );
  if (!session) return new Response('Not found', { status: 404 });

  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ends = new Date(session.startsAt.getTime() + session.durationMinutes * 60_000);

  // Folded at 75 octets is the spec; in practice every client copes with
  // plain lines, and a description with a newline in it does not.
  const escape = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  const proto = process.env.APP_PROTOCOL ?? 'http';
  const url = `${proto}://${institution.slug}.${process.env.APP_ROOT_DOMAIN ?? 'localhost:3000'}/live`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PGD-DPP//Live session//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${session.id}@pgd-dpp`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(session.startsAt)}`,
    `DTEND:${stamp(ends)}`,
    `SUMMARY:${escape(session.title)}`,
    `DESCRIPTION:${escape(
      `${session.description ?? ''}\n\nJoin from ${url} — the link is handed to you there, which is also how your attendance is recorded.`.trim(),
    )}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(session.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="session-${session.id.slice(0, 8)}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
