'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Banner, Button, Textarea, cx } from './ui';
import type { ActionState } from './form';
import { deleteHighlight, saveHighlight, updateNote } from '@/modules/library/reading-actions';

/**
 * LB-03 — the page itself, and the margin (LIB-03).
 *
 * The offsets that anchor a highlight are computed from the rendered text, so
 * the runs below must contain exactly the page's characters and nothing else:
 * no injected whitespace, no decorative elements between them. That is why the
 * marked and unmarked runs are siblings in one element rather than paragraphs
 * with padding — a stray newline in the markup would shift every offset after
 * it by one.
 */

type Run = { text: string; marked: boolean };

/** Characters before `node` within `root`, counting only text. */
function offsetWithin(root: Node, node: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

export function ReaderPage({
  itemId,
  pageStart,
  runs,
}: {
  itemId: string;
  pageStart: number;
  runs: Run[];
}) {
  const router = useRouter();
  const textRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ start: number; end: number; quote: string } | null>(
    null,
  );
  const [state, formAction, saving] = useActionState<ActionState, FormData>(
    saveHighlight,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) {
      setPending(null);
      router.refresh();
    }
  }, [state?.notice, router]);

  function onSelect() {
    const selection = window.getSelection();
    const root = textRef.current;
    if (!selection || selection.isCollapsed || !root) return;

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const start = offsetWithin(root, range.startContainer, range.startOffset);
    const end = offsetWithin(root, range.endContainer, range.endOffset);
    if (end <= start) return;

    setPending({
      start: pageStart + start,
      end: pageStart + end,
      quote: selection.toString(),
    });
  }

  return (
    <div>
      {state?.error ? (
        <div className="mb-4">
          <Banner tone="danger" title="Not saved">
            <p>{state.error}</p>
          </Banner>
        </div>
      ) : null}

      {/*
        One element, no injected whitespace: the offsets are computed from
        exactly these characters.
      */}
      <div
        ref={textRef}
        onMouseUp={onSelect}
        onTouchEnd={onSelect}
        className="t-read measure-read whitespace-pre-wrap text-ink-900"
      >
        {runs.map((run, i) =>
          run.marked ? (
            <mark key={i} className="bg-record text-ink-900 underline decoration-authority decoration-2 underline-offset-4">
              {run.text}
            </mark>
          ) : (
            <span key={i}>{run.text}</span>
          ),
        )}
      </div>

      {pending ? (
        <div className="mt-6 rounded-sm border border-ink-500 p-4">
          <p className="t-caption mt-0 mb-2 text-ink-700">Selected</p>
          <p className="t-body-sm mt-0 mb-4 text-ink-900">
            “{pending.quote.length > 200 ? `${pending.quote.slice(0, 200)}…` : pending.quote}”
          </p>

          <form action={formAction}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="startOffset" value={pending.start} />
            <input type="hidden" name="endOffset" value={pending.end} />
            <input type="hidden" name="quote" value={pending.quote} />

            <label htmlFor="reader-note" className="t-label mb-2 block text-ink-900">
              A note on this passage (optional)
            </label>
            <Textarea id="reader-note" name="note" rows={3} />

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="submit" size="dense" disabled={saving} aria-busy={saving}>
                {saving ? 'Saving' : 'Save highlight'}
              </Button>
              <Button
                type="button"
                size="dense"
                variant="tertiary"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <p className="t-caption mt-6 mb-0 text-ink-700">
          Select any passage to highlight it and keep a note against it.
        </p>
      )}
    </div>
  );
}

/** The margin: every highlight on this document, with its note. */
export function ReadingNotes({
  itemId,
  notes,
}: {
  itemId: string;
  notes: { id: string; quote: string; note: string | null; page: number }[];
}) {
  if (notes.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-ink-500 p-5">
        <p className="t-body-sm m-0 text-ink-700">
          Nothing highlighted yet. What you mark here stays on this document and follows you
          between sessions.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="t-h4 mt-0 mb-4 text-ink-900">
        Your notes ({notes.length})
      </h2>
      <ul className="m-0 grid list-none gap-4 p-0">
        {notes.map((note) => (
          <li key={note.id} className="border-t border-ink-300 pt-4">
            <NoteRow itemId={itemId} note={note} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteRow({
  itemId,
  note,
}: {
  itemId: string;
  note: { id: string; quote: string; note: string | null; page: number };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [edit, editAction, editPending] = useActionState<ActionState, FormData>(
    updateNote,
    undefined,
  );
  const [removal, removeAction, removing] = useActionState<ActionState, FormData>(
    deleteHighlight,
    undefined,
  );

  useEffect(() => {
    if (edit?.notice) {
      setEditing(false);
      router.refresh();
    }
  }, [edit?.notice, router]);

  useEffect(() => {
    if (removal?.redirectTo) router.push(removal.redirectTo);
  }, [removal?.redirectTo, router]);

  return (
    <div>
      <p className="t-caption mt-0 mb-1 text-ink-700">
        <Link
          href={`/library/${itemId}/read?note=${note.id}`}
          className="text-ink-700 underline underline-offset-2"
        >
          Page {note.page}
        </Link>
      </p>
      <p className={cx('t-body-sm mt-0 mb-2 text-ink-900')}>
        “{note.quote.length > 160 ? `${note.quote.slice(0, 160)}…` : note.quote}”
      </p>

      {editing ? (
        <form action={editAction}>
          <input type="hidden" name="noteId" value={note.id} />
          <label htmlFor={`note-${note.id}`} className="sr-only">
            Your note on this passage
          </label>
          <Textarea id={`note-${note.id}`} name="note" rows={3} defaultValue={note.note ?? ''} />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="submit" size="dense" disabled={editPending} aria-busy={editPending}>
              {editPending ? 'Saving' : 'Save note'}
            </Button>
            <Button type="button" size="dense" variant="tertiary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {edit?.error ? (
            <p className="t-body-sm mt-2 mb-0 font-semibold text-danger">
              <span aria-hidden="true">▲ </span>
              {edit.error}
            </p>
          ) : null}
        </form>
      ) : (
        <>
          {note.note ? (
            <p className="t-body-sm measure mt-0 mb-2 text-ink-700">{note.note}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="dense" variant="tertiary" onClick={() => setEditing(true)}>
              {note.note ? 'Edit note' : 'Add a note'}
            </Button>
            <form action={removeAction}>
              <input type="hidden" name="noteId" value={note.id} />
              <Button
                type="submit"
                size="dense"
                variant="tertiary"
                disabled={removing}
                aria-busy={removing}
              >
                {removing ? 'Removing' : 'Remove'}
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
