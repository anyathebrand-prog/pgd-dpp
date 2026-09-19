import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { libraryItems } from '@/db/schema';
import { TopBar, Footer } from '@/components/shell';
import { ActionForm } from '@/components/form';
import { Field, Input, Panel, Select, Textarea } from '@/components/ui';
import { submitTakedown } from '@/modules/compliance/takedown';

/**
 * LB-05 takedown request (LIB-07).
 *
 * Public and unauthenticated. The person with a valid claim is a rights
 * holder, a court reporter, or someone who has found their own name in a
 * judgment we host — none of whom have an account here, and requiring one
 * would be a way of receiving fewer claims rather than of handling them.
 *
 * Reached from the footer of every page and from LB-02, and pre-filled when
 * it is reached from an item.
 */
export default async function TakedownPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item: itemId } = await searchParams;

  const [item] =
    itemId && /^[0-9a-f-]{36}$/i.test(itemId)
      ? await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1)
      : [];

  return (
    <>
      <TopBar />
      <main id="main" className="mx-auto max-w-[640px] px-4 py-10">
        <h1 className="t-h1 m-0 text-ink-900">Report an item in the library</h1>
        <p className="t-body mt-3 text-ink-700">
          Every item here is meant to be either a public document, an open-licensed one, or one we
          have permission to hold. If one of them is none of those, this is how to tell us — and
          you do not need an account.
        </p>

        <div className="mt-8 mb-10">
          <Panel title="What happens next">
            <ol className="t-body-sm m-0 list-decimal space-y-2 pl-5 text-ink-700">
              <li>You get a reference by email, immediately.</li>
              <li>A curator reviews the claim, and the Data Protection Officer is copied.</li>
              <li>
                If it is upheld the item is withdrawn, and its page says so rather than vanishing —
                a dead link teaches nobody anything.
              </li>
              <li>Either way, you are told the outcome at the address you give below.</li>
            </ol>
          </Panel>
        </div>

        <ActionForm action={submitTakedown} submitLabel="Submit this claim">
          {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

          <Field
            label="The item"
            name="itemDescription"
            inputId="itemDescription"
            required
            helper={
              item
                ? 'Taken from the item you came here from. Add anything that identifies it more precisely.'
                : 'The title, citation or URL — or a description good enough for a curator to find it.'
            }
          >
            <Input
              id="itemDescription"
              name="itemDescription"
              required
              defaultValue={item?.title ?? ''}
            />
          </Field>

          <Field label="Your name" name="claimantName" inputId="claimantName" required>
            <Input id="claimantName" name="claimantName" required autoComplete="name" />
          </Field>

          <Field
            label="Organisation"
            name="claimantOrganisation"
            inputId="claimantOrganisation"
            helper="If you are claiming on behalf of a publisher, court or company."
          >
            <Input id="claimantOrganisation" name="claimantOrganisation" autoComplete="organization" />
          </Field>

          <Field
            label="Email address"
            name="claimantEmail"
            inputId="claimantEmail"
            required
            helper="Where the reference and the outcome are sent. We use it for this claim and nothing else."
          >
            <Input
              id="claimantEmail"
              name="claimantEmail"
              type="email"
              required
              autoComplete="email"
            />
          </Field>

          <Field label="Basis of the claim" name="basis" inputId="basis" required>
            <Select id="basis" name="basis" required defaultValue="copyright">
              <option value="copyright">Copyright or licensing</option>
              <option value="personal_data">It contains personal data about me</option>
              <option value="inaccuracy">It is inaccurate or misattributed</option>
              <option value="other">Something else</option>
            </Select>
          </Field>

          <Field
            label="What is wrong"
            name="detail"
            inputId="detail"
            required
            helper="What the item is, what right it infringes, and — if you hold that right — how. A curator acts on this text."
          >
            <Textarea id="detail" name="detail" rows={7} required />
          </Field>

          {/*
            The declaration is not decoration. It is what separates a rights
            holder from someone using this form to remove material they find
            inconvenient, and it is why the form records a timestamp against it.
          */}
          <label className="t-body-sm mb-6 flex items-start gap-3 text-ink-900">
            <input
              type="checkbox"
              name="declaration"
              required
              className="mt-0.5 h-6 w-6 shrink-0 accent-[#6B2436]"
            />
            <span>
              I declare that the information in this claim is accurate, and that I am the rights
              holder or the data subject, or am authorised to act for them.
            </span>
          </label>
        </ActionForm>

        <p className="t-body-sm mt-10">
          <Link href="/trust" className="text-ink-700 underline underline-offset-2">
            How we handle data, and who is responsible for what
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
