/**
 * The component set — UI/UX brief §5.
 *
 * Only two card types exist, deliberately (§5.4): a Record card on Manila for
 * filed artefacts, and a Panel on Paper for interface grouping. An interface
 * where everything is a rounded card teaches the user nothing.
 *
 * These are all Server Components. Nothing here ships JavaScript.
 */
import type { ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------- §5.1 buttons */

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'verified' | 'on-dark';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-authority text-surface hover:bg-authority-hover',
  secondary: 'bg-transparent text-ink-900 border border-ink-500 hover:bg-ink-900/6',
  tertiary: 'bg-transparent text-ink-700 underline underline-offset-2 hover:text-ink-900',
  danger: 'bg-danger text-surface hover:brightness-90',
  // §2.4 rule 2: a Signal-filled button takes Redaction text. Paper on Signal
  // is 3.12:1 and fails; Redaction on Signal is 5.49:1 and passes.
  verified: 'bg-verified-fill text-ink-900 hover:brightness-95',
  'on-dark': 'bg-surface text-ink-900 hover:bg-ink-100',
};

const BUTTON_SIZES = {
  // 48px is the default and the only size on mobile.
  default: 'h-12 px-5 text-base',
  dense: 'h-10 px-5 text-sm',
  // Desktop-only inline row actions. Padding keeps the touch target at 44px.
  inline: 'h-8 px-3 text-sm',
} as const;

export function Button({
  variant = 'primary',
  size = 'default',
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-sm font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  size = 'default',
  className,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <a
      className={cx(
        'inline-flex items-center justify-center rounded-sm font-semibold no-underline',
        'transition-colors',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

/* -------------------------------------------------------------- §5.2 inputs */

export function Field({
  label,
  name,
  inputId,
  helper,
  error,
  required,
  children,
}: {
  label: string;
  /** The form field name. Two forms on one page may share it. */
  name: string;
  /**
   * The DOM id, when it has to differ from the name. Ids are page-wide, so
   * two panels that both post a field called `note` would otherwise emit
   * duplicate ids — and both labels then point at whichever input came first,
   * which is a real screen-reader failure, not a cosmetic one.
   */
  inputId?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  const id = inputId ?? name;
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    // §4.1 vertical rhythm: 8px label→input, 6px input→helper, 24px between fields.
    <div className="mb-6">
      <label htmlFor={id} className="t-label mb-2 block text-ink-900">
        {label}
        {required ? (
          <span className="text-ink-500"> (required)</span>
        ) : (
          <span className="text-ink-500"> (optional)</span>
        )}
      </label>
      <div aria-describedby={cx(helperId, errorId) || undefined}>{children}</div>
      {helper && !error ? (
        <p id={helperId} className="t-body-sm mt-1.5 text-ink-500">
          {helper}
        </p>
      ) : null}
      {/* §5.2 error: never colour alone — a glyph and words carry the meaning. */}
      {error ? (
        <p id={errorId} className="t-body-sm mt-1.5 font-semibold text-danger">
          <span aria-hidden="true">▲ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const INPUT_BASE =
  'block w-full h-12 rounded-sm border border-ink-500 bg-surface px-3 text-base text-ink-900 placeholder:text-ink-500';

export function Input({
  invalid,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cx(
        INPUT_BASE,
        invalid && 'border-2 border-danger',
        // §5.2 read-only: Manila fill, no border — it reads as "on file",
        // consistent with the substrate rule.
        'read-only:border-transparent read-only:bg-record read-only:text-ink-700',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT_BASE, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'block w-full rounded-sm border border-ink-500 bg-surface p-3 text-base text-ink-900',
        className,
      )}
      rows={4}
      {...props}
    />
  );
}

/* --------------------------------------------------------------- §5.4 cards */

/**
 * Record card. Manila, and therefore reserved: an application, a submitted
 * document, a module, a library item, a certificate, an admission letter.
 * The 48×2px Oxblood rule above the title is the record mark.
 */
export function Record({
  title,
  meta,
  children,
  className,
  as: Tag = 'article',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: 'article' | 'div' | 'li';
}) {
  return (
    <Tag className={cx('rounded-md bg-record p-5', className)}>
      <div className="mb-3 h-0.5 w-12 bg-authority" aria-hidden="true" />
      {title ? <h3 className="t-h3 m-0 text-ink-900">{title}</h3> : null}
      {/* §2.4: secondary text on Manila is ink-700. ink-500 is 4.21:1 and fails. */}
      {meta ? <p className="t-body-sm mt-1 mb-0 text-ink-700">{meta}</p> : null}
      {children ? <div className="mt-4 text-ink-900">{children}</div> : null}
    </Tag>
  );
}

/** Panel. Paper, 1px ink-300 rule. A filter panel is not a record. */
export function Panel({
  title,
  children,
  className,
  actions,
}: {
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={cx('rounded-md border border-ink-300 bg-surface p-5', className)}>
      {title || actions ? (
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? <h2 className="t-h3 m-0 text-ink-900">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------ §5.6 feedback */

type BannerTone = 'info' | 'warning' | 'danger' | 'verified';

const BANNER_TONES: Record<BannerTone, { rule: string; tint: string; word: string; glyph: string }> =
  {
    // Alert backgrounds are the status hue at 8% over Paper, with a 3px left
    // rule at full strength and ink-900 body text. Never coloured text on tint.
    info: { rule: 'border-l-info', tint: 'bg-info/8', word: 'Note', glyph: '■' },
    warning: { rule: 'border-l-warning', tint: 'bg-warning/8', word: 'Attention', glyph: '▲' },
    danger: { rule: 'border-l-danger', tint: 'bg-danger/8', word: 'Problem', glyph: '▲' },
    verified: { rule: 'border-l-verified-fill', tint: 'bg-verified-fill/8', word: 'Confirmed', glyph: '●' },
  };

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
}) {
  const t = BANNER_TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-sm border-l-[3px] p-4 text-ink-900', t.rule, t.tint)}
    >
      <p className="t-label m-0 mb-1">
        <span aria-hidden="true">{t.glyph} </span>
        {title ?? t.word}
      </p>
      <div className="t-body-sm [&_p]:m-0">{children}</div>
    </div>
  );
}

/** §5.6 empty state: a heading naming what appears here, one sentence, an action. Never an illustration. */
export function EmptyState({
  heading,
  children,
  action,
}: {
  heading: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-ink-300 p-8 text-center">
      <h3 className="t-h3 m-0 text-ink-900">{heading}</h3>
      {children ? <p className="t-body-sm mx-auto mt-2 max-w-prose text-ink-700">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------------------- §5.5 product-specific parts */

/**
 * The verification seal. The one circular form in an otherwise rectilinear
 * system, and the product's signature. It goes only where something is
 * actually verified. The Signal ring is permitted on Paper only — on Manila it
 * is 2.44:1 and fails even the non-text threshold (§2.4 rule 3).
 */
export function Seal({ label, onPaper = true }: { label: string; onPaper?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-authority text-surface',
        onPaper ? 'ring-2 ring-verified-fill ring-offset-2 ring-offset-surface' : '',
      )}
      role="img"
      aria-label={label}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 12.5l5.2 5.2L20 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="square"
        />
      </svg>
    </span>
  );
}

/** A string a human might read aloud to a support agent. Always Plex Mono. */
export function DataString({
  value,
  size = 'sm',
  label,
}: {
  value: string;
  size?: 'sm' | 'lg';
  label?: string;
}) {
  return (
    <span className={size === 'lg' ? 't-data-lg' : 't-data'}>
      {label ? <span className="sr-only">{label}: </span> : null}
      {value}
    </span>
  );
}

/** Money is stored in kobo and rendered once, here. Never a float. */
export function Naira({ kobo }: { kobo: number }) {
  return (
    <span className="t-data tabular-nums">
      ₦{(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
    </span>
  );
}

type StepState = 'complete' | 'current' | 'queried' | 'blocked' | 'pending';

const STEP_STATE: Record<StepState, { dot: string; text: string; glyph: string }> = {
  complete: { dot: 'bg-authority text-surface', text: 'text-ink-900', glyph: '✓' },
  current: { dot: 'bg-authority text-surface', text: 'text-ink-900 font-semibold', glyph: '●' },
  queried: { dot: 'bg-warning text-surface', text: 'text-ink-900', glyph: '▲' },
  blocked: { dot: 'bg-danger text-surface', text: 'text-ink-900', glyph: '▲' },
  pending: { dot: 'border border-ink-500 text-ink-500', text: 'text-ink-500', glyph: '' },
};

/**
 * AP-01 status stepper. The current state is always ALSO stated in a sentence
 * above it, because a stepper alone is not a status — it shows sequence, not
 * meaning, and an anxious candidate needs the meaning.
 */
export function StatusStepper({
  sentence,
  steps,
}: {
  sentence: string;
  steps: { label: string; state: StepState; note?: string }[];
}) {
  return (
    <div>
      <p className="t-body-lg m-0 mb-5 text-ink-900">{sentence}</p>
      <ol className="m-0 flex list-none flex-col gap-4 p-0 md:flex-row md:gap-0">
        {steps.map((s, i) => {
          const v = STEP_STATE[s.state];
          return (
            <li key={s.label} className="flex flex-1 items-start gap-3 md:flex-col md:gap-2">
              <span
                className={cx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm',
                  v.dot,
                )}
                aria-hidden="true"
              >
                {v.glyph || i + 1}
              </span>
              <span className="md:pr-4">
                <span className={cx('t-body-sm block', v.text)}>{s.label}</span>
                {s.note ? <span className="t-caption block text-ink-700">{s.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * §5.3 the staff console band. Full-bleed Redaction, permanent, not
 * dismissible. It is the ambient signal that you are operating on other
 * people's data, and the logging notice inside it is chrome, not a banner.
 */
export function StaffBand({ institution, role }: { institution: string; role: string }) {
  return (
    <div className="bg-ink-900 text-surface">
      <div className="mx-auto flex h-14 max-w-[1600px] flex-wrap items-center justify-between gap-2 px-8">
        <span className="t-label">{institution}</span>
        <span className="t-caption text-surface/85">
          {role} · All access to applicant records is logged.
        </span>
      </div>
    </div>
  );
}

/** §5.5 licence badge. Two states, always with words, never colour alone. */
export function LicenceBadge({ downloadable }: { downloadable: boolean }) {
  return (
    <span className="t-body-sm inline-flex items-center gap-2">
      <span
        className={cx(
          'inline-block h-2 w-2 rounded-full',
          downloadable ? 'bg-verified-fill' : 'bg-ink-500',
        )}
        aria-hidden="true"
      />
      <span className={downloadable ? 'text-verified-text' : 'text-ink-700'}>
        {downloadable ? 'Download available' : 'Read at source'}
      </span>
    </span>
  );
}

/**
 * §5.5 redaction bar. Functional only. The real state is exposed as text for
 * assistive technology; the bar itself is decoration over nothing.
 */
export function Redacted({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-4 w-24 bg-ink-900" aria-hidden="true" />
      <span className="t-caption text-ink-700">{label}</span>
    </span>
  );
}
