'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/**
 * A dropdown that opens into a checklist of the programme's modules.
 *
 * Not a <select>: one choice is too few (most facilitators could teach
 * several modules), and a native multi-select needs Ctrl-click, which
 * nobody discovers. The checkboxes stay in the form while the list is
 * closed (hidden, not removed), so a closed dropdown still submits what was
 * ticked; the button says what that is.
 */
export function ModulePicker({
  name,
  modules,
  id,
}: {
  name: string;
  modules: { title: string; body: string }[];
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);

  // Read the boxes rather than hold them in state, so the form's own
  // restore-after-error (which sets `checked` directly) is reflected too.
  const sync = () =>
    setChosen(
      [...(list.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? [])]
        .filter((b) => b.checked)
        .map((b) => b.value),
    );
  useEffect(() => {
    sync();
    const form = list.current?.closest('form');
    const later = () => window.setTimeout(sync, 0);
    form?.addEventListener('reset', later);
    const observer = new MutationObserver(later);
    if (list.current) observer.observe(list.current, { subtree: true, attributes: true });
    return () => {
      form?.removeEventListener('reset', later);
      observer.disconnect();
    };
  }, []);

  const summary =
    chosen.length === 0
      ? 'Choose one or more modules'
      : chosen.length === 1
        ? chosen[0]
        : `${chosen.length} chosen: ${chosen.join(', ')}`;

  return (
    <div>
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        // The field's label names the button; this is what is chosen.
        aria-describedby={`${id}-summary`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'motion-state flex min-h-12 w-full items-center justify-between gap-3 rounded-sm border border-ink-500 bg-ink-100/40 px-4 py-2 text-left text-base hover:border-ink-700',
          chosen.length === 0 ? 'text-ink-500' : 'text-ink-900',
        )}
      >
        <span id={`${id}-summary`} className="min-w-0 truncate">
          {summary}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-ink-700">
          {open ? '▲' : '▼'}
        </span>
      </button>
      <div
        ref={list}
        id={`${id}-list`}
        role="group"
        aria-label="Modules"
        onChange={sync}
        className={cx('mt-2 rounded-sm border border-ink-300 bg-record p-2', !open && 'hidden')}
      >
        {modules.map((m) => (
          <label
            key={m.title}
            className="motion-state flex cursor-pointer items-start gap-3 rounded-sm px-3 py-3 hover:bg-ink-100/60"
          >
            <input type="checkbox" name={name} value={m.title} className="mt-1 h-5 w-5 shrink-0 accent-[#6da5f2]" />
            <span>
              <span className="t-body-sm block font-semibold text-ink-900">{m.title}</span>
              <span className="t-caption block text-ink-700">{m.body}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
