import { cx } from './ui';

/**
 * One facilitator on the Faculty page, and the same card as the preview a
 * facilitator sees while editing, so what they approve is what is shown.
 *
 * The photograph is a rounded rectangle, not a circle: the verification seal
 * is the product's one circular form (brief §0). Without a photograph, the
 * person's initials stand in, never a stock silhouette.
 */
export function FacultyCard({
  name,
  title,
  bio,
  universities,
  photoUrl,
  className,
}: {
  name: string;
  title: string | null;
  bio: string | null;
  universities: string[];
  photoUrl: string | null;
  className?: string;
}) {
  const initials = name
    .replace(/^(Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (
    <article className={cx('hairline flex h-full flex-col rounded-lg bg-record p-6', className)}>
      <div className="flex items-start gap-5">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={`Photograph of ${name}`}
            width={112}
            height={140}
            loading="lazy"
            decoding="async"
            className="h-[140px] w-[112px] shrink-0 rounded-md object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-[140px] w-[112px] shrink-0 items-center justify-center rounded-md bg-[linear-gradient(135deg,#184098,#1f6adc)] text-3xl font-semibold text-ink-900"
          >
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="t-h3 m-0 text-ink-900">{name}</h3>
          {title ? <p className="t-body-sm mt-1 mb-0 text-ink-700">{title}</p> : null}
          {universities.length > 0 ? (
            <p className="t-caption mt-3 mb-0 text-accent">{universities.join(' · ')}</p>
          ) : null}
        </div>
      </div>
      {bio ? <p className="t-body-sm mt-5 mb-0 whitespace-pre-line text-ink-700">{bio}</p> : null}
    </article>
  );
}
