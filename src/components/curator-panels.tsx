'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Field, Input, Select, Textarea } from './ui';
import type { ActionState } from './form';
import { saveItem, setItemStatus, uploadItemFile } from '@/modules/library/actions';

function Feedback({ state, title = 'Not saved' }: { state: ActionState; title?: string }) {
  if (state?.error) {
    return (
      <div className="mb-4">
        <Banner tone="danger" title={title}>
          <p>{state.error}</p>
        </Banner>
      </div>
    );
  }
  if (state?.notice) {
    return (
      <div className="mb-4">
        <Banner tone="verified" title="Done">
          <p>{state.notice}</p>
        </Banner>
      </div>
    );
  }
  return null;
}

type Licence = { id: string; code: string; name: string; allowsHosting: boolean };

/** CU-02 — metadata, and the licence that decides what may be done with it. */
export function ItemEditor({
  item,
  licenceOptions,
}: {
  item?: {
    id: string;
    collection: 'library' | 'resource_centre';
    title: string;
    citation: string;
    authors: string;
    jurisdiction: string;
    instrumentType: string;
    court: string;
    year: number | null;
    abstract: string;
    subjectAreas: string[];
    licenceId: string | null;
    sourceAttribution: string;
    externalUrl: string;
  };
  licenceOptions: Licence[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveItem, undefined);

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  const idFor = (field: string) => `item-${item?.id ?? 'new'}-${field}`;

  return (
    <form action={formAction}>
      <Feedback state={state} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

      <Field label="Title" name="title" inputId={idFor('title')} required>
        <Input id={idFor('title')} name="title" required defaultValue={item?.title ?? ''} />
      </Field>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Collection" name="collection" inputId={idFor('collection')} required>
          <Select
            id={idFor('collection')}
            name="collection"
            required
            defaultValue={item?.collection ?? 'library'}
          >
            <option value="library">E-Library — law and decisions</option>
            <option value="resource_centre">Resource Centre — research papers</option>
          </Select>
        </Field>
        <Field label="Citation" name="citation" inputId={idFor('citation')}>
          <Input id={idFor('citation')} name="citation" defaultValue={item?.citation ?? ''} />
        </Field>
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field label="Authors" name="authors" inputId={idFor('authors')}>
          <Input id={idFor('authors')} name="authors" defaultValue={item?.authors ?? ''} />
        </Field>
        <Field label="Year" name="year" inputId={idFor('year')}>
          <Input
            id={idFor('year')}
            name="year"
            inputMode="numeric"
            defaultValue={item?.year ?? ''}
          />
        </Field>
      </div>

      <div className="grid gap-x-6 md:grid-cols-3">
        <Field label="Jurisdiction" name="jurisdiction" inputId={idFor('jurisdiction')}>
          <Input
            id={idFor('jurisdiction')}
            name="jurisdiction"
            placeholder="Nigeria"
            defaultValue={item?.jurisdiction ?? ''}
          />
        </Field>
        <Field label="Instrument type" name="instrumentType" inputId={idFor('type')}>
          <Input
            id={idFor('type')}
            name="instrumentType"
            placeholder="Act, guidance, judgment"
            defaultValue={item?.instrumentType ?? ''}
          />
        </Field>
        <Field label="Court" name="court" inputId={idFor('court')}>
          <Input id={idFor('court')} name="court" defaultValue={item?.court ?? ''} />
        </Field>
      </div>

      <Field
        label="Subject areas"
        name="subjectAreas"
        inputId={idFor('subjects')}
        helper="Comma separated. These are the filters a student browses by."
      >
        <Input
          id={idFor('subjects')}
          name="subjectAreas"
          defaultValue={item?.subjectAreas.join(', ') ?? ''}
        />
      </Field>

      <Field label="Abstract" name="abstract" inputId={idFor('abstract')}>
        <Textarea id={idFor('abstract')} name="abstract" rows={4} defaultValue={item?.abstract ?? ''} />
      </Field>

      {/* The two blocking fields. §5.7 is the reason: a data protection
          programme distributing material it has no licence for is not
          survivable, and "where did this come from" is the first question a
          takedown claim asks. */}
      <div className="mt-8 border-t border-ink-300 pt-6">
        {/*
          Not HTML-required, deliberately. CU-02 blocks *publishing* without a
          licence, not the creation of a draft — a curator often records an
          item before they have established what may be done with it, and a
          form that refuses to save until they have decided pushes them into
          guessing. Marking it required here also silently blocked the submit
          with no message anyone could see.
        */}
        <Field
          label="Licence"
          name="licenceId"
          inputId={idFor('licence')}
          helper="Required before this can be published. It decides whether the item may be hosted at all, or only linked to."
        >
          <Select id={idFor('licence')} name="licenceId" defaultValue={item?.licenceId ?? ''}>
            <option value="">Not yet recorded</option>
            {licenceOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l.allowsHosting ? 'may be hosted' : 'link only'}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Source and provenance"
          name="sourceAttribution"
          inputId={idFor('source')}
          required
          helper="Where this copy came from, in words a stranger could check. Shown on the item."
        >
          <Input
            id={idFor('source')}
            name="sourceAttribution"
            required
            defaultValue={item?.sourceAttribution ?? ''}
          />
        </Field>

        <Field
          label="Link to the original"
          name="externalUrl"
          inputId={idFor('url')}
          helper="Required where the licence forbids hosting. Always useful."
        >
          <Input id={idFor('url')} name="externalUrl" defaultValue={item?.externalUrl ?? ''} />
        </Field>
      </div>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving' : item ? 'Save this item' : 'Create the item'}
      </Button>
    </form>
  );
}

/** CU-02 — the file, which the licence may forbid entirely. */
export function ItemFile({
  itemId,
  filename,
  hostingAllowed,
}: {
  itemId: string;
  filename: string | null;
  hostingAllowed: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    uploadItemFile,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  if (!hostingAllowed) {
    return (
      <Banner tone="info" title="This licence does not allow hosting">
        <p>
          Metadata, abstract and a link to the publisher — that is the whole of what this item can
          be. The upload is not hidden to be tidy; it is refused.
        </p>
      </Banner>
    );
  }

  return (
    <form action={formAction}>
      <Feedback state={state} title="Not attached" />
      <input type="hidden" name="itemId" value={itemId} />

      <p className="t-body-sm mt-0 mb-3 text-ink-700">
        {filename ? `${filename} is attached.` : 'No file yet.'} PDF, JPG or PNG, up to 5MB.
      </p>

      <Field label="File" name="file" inputId={`file-${itemId}`} required>
        <Input
          id={`file-${itemId}`}
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          required
        />
      </Field>

      <Button type="submit" size="dense" variant="secondary" disabled={pending} aria-busy={pending}>
        {pending ? 'Uploading' : filename ? 'Replace the file' : 'Attach the file'}
      </Button>
    </form>
  );
}

/** CU-02 — publish, take down, or send back to draft. */
export function ItemStatus({
  itemId,
  status,
  blockers,
}: {
  itemId: string;
  status: string;
  blockers: string[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setItemStatus,
    undefined,
  );

  useEffect(() => {
    if (state?.notice) router.refresh();
  }, [state?.notice, router]);

  return (
    <div>
      <Feedback state={state} title="Not changed" />

      {blockers.length > 0 && status !== 'published' ? (
        <div className="mb-4">
          <Banner tone="warning" title="Not ready to publish">
            <ul className="m-0 list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Banner>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {status !== 'published' ? (
          <form action={formAction}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="status" value="published" />
            <Button type="submit" size="dense" disabled={pending || blockers.length > 0}>
              Publish
            </Button>
          </form>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="status" value="taken_down" />
            <Button type="submit" size="dense" variant="secondary" disabled={pending}>
              Take it down
            </Button>
          </form>
        )}

        {status !== 'draft' ? (
          <form action={formAction}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="status" value="draft" />
            <Button type="submit" size="dense" variant="tertiary" disabled={pending}>
              Back to draft
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
