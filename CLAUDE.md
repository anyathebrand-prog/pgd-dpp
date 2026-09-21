# Working in this repo

A multi-tenant admissions and learning platform for a Post Graduate Diploma in Data Protection &
Privacy, run by several Nigerian universities on one system.

## The specs are the source of truth

Three documents in [`docs/`](docs/) drive this build, and they win over general guidance:

| Document | Governs |
|---|---|
| [`docs/01-prd.md`](docs/01-prd.md) | Requirements, the compliance regime, the stack, what is out of scope |
| [`docs/03-app-flow.md`](docs/03-app-flow.md) | 96 screens with IDs, states, and flagged gaps |
| [`docs/04-ui-ux-brief.md`](docs/04-ui-ux-brief.md) | The visual system, down to contrast ratios |

Requirement IDs (`APP-04`, `PAY-03`, `CMP-10`) and screen IDs (`AP-05`, `DP-03`, `IA-06`) are used
throughout the code in comments. When changing behaviour, cite the ID you are working to.

### On the design skills in `.claude/skills/`

Those are general-purpose UI/UX references and they are **subordinate to
[`docs/04-ui-ux-brief.md`](docs/04-ui-ux-brief.md)**. Where they disagree, the brief wins — it is a
commissioned design system for this product, not a default.

Concretely: the brief's §0 ("Night Desk", the 2026 redesign after flowninja.com) sets a navy
surface, off-white ink, gradient display headings, 6–20px corners and pill buttons. There are still
**no shadows**, still only two card types, and §9's motion rules are unchanged. §0 changed token
*values*, not token *meanings*: keep using `surface`, `ink-*`, `record`, `authority` by what they
mean, never by what colour they currently are. Reach for the skills for things the brief does not cover — motion choreography, chart
types, icon selection — not to restyle what it already settled.

### The landing page is the one marketing surface

[`src/app/page.tsx`](src/app/page.tsx) (PB-01) and the `landing-*` components are held to §9 by
*surface*, not by taste. The hero may rise into place on load and the claim under it may rotate;
everywhere a student, facilitator or registrar works, §9's ban stands unchanged. What stays banned
on PB-01 too: hover lift and scale, parallax, shimmer, spinners, animated counters, and any
entrance triggered by scrolling. The 240ms ceiling applies there as well — delays included.
[`tests/motion.test.ts`](tests/motion.test.ts) enforces the line, so widening it is a visible edit.

## Rules that are not obvious from the code

**Server actions never call `redirect()`.** They return `{ redirectTo }` and the client navigates;
`ActionForm` and `ActionButton` both handle it. A server-side redirect from an action runs the
action, commits its writes, and then lands the router on `/`. `redirect()` is still correct during
*page* render — that is how `requireUser`, `requireRole` and `requireInstitution` work.

**A confirmation cannot live inside the row it is confirming.** When an action removes an
item from a list — approving a payment, deciding a submission, certifying a graduate — anything
that re-renders that list unmounts the component holding the "done" message before its effect
runs, and the item simply vanishes. `revalidatePath` does it, and so does revalidating a
*sibling* path that shares a layout. Push the outcome into the URL and let the page render it:
it survives the refresh and a reload. This has been rediscovered three times.

**Tenant data goes through `withTenant()`.** Row-level security is enforced by Postgres, not the
ORM, so a query without tenant context correctly returns nothing — which looks like an empty page
rather than an error. Three request-path reads are cross-tenant by design and go through
`readAcrossTenants(reason, fn)`; adding a fourth needs an argument, not a convenient import.

**Run `npm run db:rls` after every `drizzle-kit push`.** A push that recreates a table drops its
policies with it, and nothing warns you: the app keeps working, and `tests/isolation.test.ts`
is what notices. Note that suite is destructive when RLS is off — its "cannot delete another
tenant's rows" case really does delete them, which is the proof it exists to provide and also a
reason to `npm run db:reset` afterwards.

**Carrying `institution_id` does not make a table tenant-scoped.** `SHARED_TABLES` wins. Several
shared tables record it as provenance — which tenant a session was opened against, which
institution an alumnus graduated from. Policing it on `sessions` means no session ever resolves.

**`--record` (Manila before §0, raised navy now) means "this is a filed artefact".** An application, a document, a module, a
certificate. It is semantic, not decorative — a filter panel is never Manila. **Signal
(`--verified`) means verified and nothing else**, is never text on Paper or Manila, and a
Signal-filled button takes Redaction text.

**Do not run `next build` against a running `next dev`.** They share `.next`, and the dev server
rewrites chunks underneath live production requests. That produces spurious 500s with stack traces
naming route handlers that took no part in the request. `playwright.prod.config.ts` starts no
server for this reason.

## Commands

```bash
npm run dev                 npm run build            npm run typecheck
npm run pg:start            npm run db:reset         npm run db:rls
npm run test                npm run test:e2e         npm run test:e2e:prod
npm run worker -- purge     npm run worker -- lapse-offers    npm run worker -- reconcile
npm run mail                npm run totp -- <email>
```

No `RESEND_API_KEY` means mail lands in `.mail/` instead of a mailbox; `npm run mail` reads it.
Staff 2FA is not relaxed locally — `npm run totp -- <email>` computes the code from the stored
secret, so the login path is exercised rather than bypassed.

Local runs on `unilag.localhost:3000` and `fulokoja.localhost:3000` — two seeded tenants, deliberately,
so isolation bugs surface in development. Seeded accounts and the rest of the setup are in the
[README](README.md).

## Testing expectations

New behaviour gets covered. The suites are `tests/` (vitest, against a real Postgres with real RLS
policies) and `e2e/` (Playwright, at the 360px design baseline). Nothing is mocked in either —
every interesting failure in this product lives in a seam that a mock would paper over.

Two suites are load-bearing and should not be weakened to make a change pass:
`tests/isolation.test.ts` (a tenant leak is the one bug that ends the company) and
`tests/payments.test.ts` (settlement is the only code that creates an enrolment).
