# PGD-DPP Platform

A multi-tenant admissions and learning platform letting several Nigerian universities run a Post
Graduate Diploma in Data Protection & Privacy on one system.

Built to the three specs in [`docs/`](docs/): the [PRD](docs/01-prd.md), the
[app flow](docs/03-app-flow.md), and the [UI/UX brief](docs/04-ui-ux-brief.md).

---

## Running it

Needs Node 20+ and a PostgreSQL 16 on port 5433. Two ways to get one.

**With Docker:**

```bash
cp .env.example .env          # defaults work for local development as-is
npm install
npm run db:up                 # Postgres 16 in a container
npm run db:reset              # push schema, apply RLS, seed two tenants
npm run dev
```

**Without Docker** — `npm run pg:start` drives real PostgreSQL 16 binaries out of
`node_modules` (`@embedded-postgres/windows-x64`) into a `.pgdata/` directory in the project. No
system install, no administrator rights, same port, same `.env`:

```bash
cp .env.example .env
npm install
npm run pg:start              # initdb on first run, then start
npm run db:reset
npm run dev
```

`npm run pg:stop`, `pg:status` and `pg:destroy` do what they say. This path exists because Docker
is not always available — on the machine this was built on, WSL2 had no distro provisioned and
EnterpriseDB's download host returns 403, which rules out winget, Chocolatey and the portable zip
at the same time.

Then:

| URL | What it is |
|---|---|
| http://localhost:3000 | Platform landing (PB-01) |
| http://unilag.localhost:3000 | University of Lagos tenant |
| http://fulokoja.localhost:3000 | Federal University Lokoja tenant |
| http://app.localhost:3000/dpo | DPO console |

`*.localhost` subdomains resolve without any hosts-file editing in Chrome, Edge and Firefox. If
your environment cannot do wildcard DNS, every route also works under `/t/{slug}/...` — that path
prefix is rewritten by the middleware and no route handler knows the difference.

### Seeded accounts

Password for all of them: `Passw0rd-seed-2026`

| Account | Console | Where to sign in |
|---|---|---|
| `candidate@unilag.example.ng` | The application funnel, `/apply` | `unilag.localhost:3000/login` |
| `student@unilag.example.ng` | Student dashboard, `/dashboard` | `unilag.localhost:3000/login` |
| `facilitator@unilag.example.ng` | Teaching and grading, `/teach` | `unilag.localhost:3000/login` |
| `registry@unilag.example.ng` | Admissions queue, `/admin/applications` — **2FA** | `unilag.localhost:3000/login` |
| `admin@unilag.example.ng` | Institution admin, `/admin` — **2FA** | `unilag.localhost:3000/login` |
| `dpo@example.ng` | DPO console, `/dpo` — **2FA** | `app.localhost:3000/login` |
| `curator@example.ng` | Library curation, `/curate` | `app.localhost:3000/login` |

The `fulokoja` accounts mirror these. **Sign in as FUL staff and try to reach a UNILAG record** — that is
what the two-tenant fixture is for.

Nothing here needs a working mailbox: every seeded account is already verified and has a password.

### Reading the email that was not sent

With no `RESEND_API_KEY`, messages are written to `.mail/` rather than sent — deliberately, so the
OTP, activation and reset flows work locally without a provider and without the classic accident of
mailing real candidates from a developer's machine. That is also why signing up with your own Gmail
address produces no email.

```bash
npm run mail                      # the most recent message, whoever it was for
npm run mail -- you@gmail.com     # the most recent one for that address
npm run mail -- you@gmail.com 5   # the last five
```

Codes expire after fifteen minutes; the script says so rather than letting a stale one look like a
broken login. To send for real, set `RESEND_API_KEY` and `MAIL_FROM` in `.env`.

### Getting past 2FA on staff accounts

AUTH-08 requires a second factor for registry, institution admin, super admin and DPO accounts, and
that is not relaxed in development — it would stop being tested if it were. On first login the
account lands on the setup screen, which prints the key for any authenticator app. If you would
rather not reach for your phone:

```bash
npm run totp -- registry@unilag.example.ng
```

That reads the secret the server already stored and does the RFC 6238 maths a phone would do, so no
part of the login path is skipped. On a first login, leave the setup screen open, run it, and paste
the code.

### Paying without Paystack keys

`PAYSTACK_SIMULATE=1` is set by default. Checkout goes to a local stand-in that signs a
`charge.success` payload and posts it to the real webhook route, so signature verification,
idempotency and settlement all run exactly as they will in production. Emails go to `.mail/` as
text files when `RESEND_API_KEY` is unset.

---

## The four things this codebase is careful about

### 1. Tenant isolation is enforced by Postgres, not by the ORM

Every tenant-scoped table carries `institution_id NOT NULL` with an RLS policy keyed to
`current_setting('app.institution_id')`. The application connects as `pgd_app`, which is
**`NOBYPASSRLS`**; migrations, the seed and the worker use a separate owner role, deliberately.

`withTenant()` in [`src/db/index.ts`](src/db/index.ts) is the only request-path entry point. It
opens a transaction, issues `SET LOCAL app.institution_id`, and runs your query — transaction-scoped
so a pooled connection cannot leak one tenant's setting into the next request.

`npm run db:rls` applies the policies and **fails the build** if any table is neither tenant-scoped
nor on the documented `SHARED_TABLES` exemption list.

Carrying `institution_id` does not by itself make a table tenant-scoped, and `SHARED_TABLES` wins.
Several shared tables record it as *provenance* rather than as an isolation key — which tenant a
session was opened against, which tenant an audit entry touched, which institution an alumnus
graduated from. Policing that column on `sessions` would mean no session ever resolves, because
`currentPrincipal` runs before any tenant context exists.

Three request-path reads are cross-tenant by design and go through `readAcrossTenants(reason, fn)`,
which takes a mandatory reason and is a deliberately short, enumerated list: public certificate
verification, signed document access, and the DPO console. Everything else uses `withTenant` —
including `/programmes`, which aggregates across institutions as a series of per-tenant reads
rather than one unscoped query.

```bash
npm run test:isolation
```

That suite authenticates as the RLS-bound role and tries to reach the other tenant by explicit id,
by unfiltered count, through a join from a shared table, by insert, update, delete, and by moving a
row across tenants. It also asserts `FORCE ROW LEVEL SECURITY` (without it, the owner silently
bypasses its own policies — and in development the app often *is* the owner), and that `audit_log`
rejects UPDATE and DELETE.

### 2. A payment is confirmed by the webhook, never by the browser

[`/api/webhooks/paystack`](src/app/api/webhooks/paystack/route.ts) reads the **raw** body (the HMAC
is over exact bytes), verifies the SHA512 signature in constant time, writes the event to
`inbound_events` keyed on Paystack's event id **before** any business logic, and only then settles.
The unique index on that key is what makes retries and replays harmless.

[`settleTransaction`](src/modules/payments/settle.ts) is the single place a payment becomes real and
the only place an enrollment and matriculation number are created. The browser callback
(`/pay/pending/{ref}`) polls for the verdict and decides nothing.

### 3. Compliance is schema, not documentation

| Requirement | Where it lives |
|---|---|
| CMP-06 granular consent | Four separate decisions, each row storing the wording shown and the notice version in force. Append-only — changing a consent writes a new row |
| CMP-07 30-day clock | `data_subject_requests.due_at`, with escalation at day 20 and 27. Public intake at `/dpo/request`, queue at `/dpo/requests`, fulfilment at `/dpo/requests/{id}`. Erasure that collides with an academic record is refused with a recorded reason — the action rejects it, not just the UI |
| CMP-07 self-service | `/account/privacy/export` hands a student everything held about them, assembled by the same code that shows the DPO what is held, so the two cannot drift |
| CMP-09 72-hour breach clock | `breaches.discovered_at`; affected subjects scoped via the indexed `audit_log.subject_id` |
| CMP-10 retention | `documents.purge_after`, set at the moment a rejection is recorded, executed by `npm run worker -- purge` — which verifies the object was actually deleted before marking the row purged. `/dpo/retention` separates a failed purge from one that never ran, because those need different responses |
| CMP-13 signed URLs | No object is ever public. [`/api/files`](src/app/api/files/route.ts) requires a valid unexpired signature **and** a session **and** ownership or a staff role — a forwarded link is not authorisation |
| C-06 extended time | Assessment timing is essential, so WCAG 2.2.1's exception applies — but the resolution is to build the accommodation anyway. A facilitator grants extra minutes per student from the grading queue, `submitAttempt` adds them to the deadline, and the student is told they have it |
| CMP-14 immutable audit | The app role holds INSERT and SELECT on `audit_log` and nothing else |

Two deliberate departures from the brief, both flagged in the PRD itself:

- **No emailed passwords.** AUTH-01's activation link instead. A password in an inbox is a
  permanent, unrotatable credential leak.
- **No NIN collected.** APP-02 raised it as a `[DECISION]`; nothing in admissions needs it, so it is
  not collected unless a specific university mandates it, at which point it becomes a
  tenant-configured field with its own lawful basis and its own RoPA line.

### 4. The design system is semantic, and enforced

Institution branding is validated and **blocked**, not warned about. A brand colour has to reach
4.5:1 against the page or it cannot be saved, and the screen offers the nearest passing shade of
the same hue rather than pushing an institution toward a colour they will not recognise. §2.5 is
explicit — "do not warn-and-allow" — because the platform's accessibility compliance cannot depend
on a university administrator's colour taste. `tests/contrast.test.ts` checks the maths against
every ratio published in §2.4.


"The Case File": **Paper** is interface, **Manila** is the record. Manila appears if and only if the
thing on screen is a filed artefact. There are exactly two card types — `Record` (Manila) and
`Panel` (Paper) — and the distinction is the hierarchy.

**Signal** (`#0E9B94`) means verified, confirmed, cleared, and nothing else. It is never a text
colour on Paper or Manila (use `--verified-text`), a Signal-filled button takes Redaction text not
Paper, and Signal never touches Manila — all three fall out of the contrast matrix in §2.4.

No shadows, no gradients, 2–4px radius throughout, with exactly one circular form: the verification
seal.

**Motion answers an action.** Three durations (120ms state, 180ms sheet, 240ms page) on one easing
curve, and nothing exceeds 240ms. No hover lift, no scroll-triggered entrances, no skeleton
shimmer, no decorative loops — partly taste, partly because paint is expensive on the low-end
Android this audience actually uses. The redacted mark on the landing page is the single piece of
motion nobody triggered, and it exists once.

Under `prefers-reduced-motion` transforms go and the hero renders resolved, but progress
indicators that carry meaning **stay** — the payment bar becomes a static full bar paired with an
`aria-live` status line, because removing feedback is not an accommodation. `tests/motion.test.ts`
scans the source and fails on anything from §9's not-permitted list.

Fonts follow the §3.5 budget — Plex Sans 400/600 preloads; Literata loads only on reading surfaces
(lesson player, library reader, privacy notice); Plex Mono is used only for strings a person might
read aloud to a support agent.

---

## Layout

```
src/
  app/                     routes, grouped by the app-flow screen IDs
    api/webhooks/paystack  the separate-deployable webhook receiver
  components/              the §5 component set
  db/
    schema.ts              §13 entities; SHARED_TABLES is the RLS exemption list
    apply-rls.ts           creates the app role, writes the policies, guards the schema
    seed.ts                the two-tenant fixture
  lib/                     tenant, auth, crypto, storage, paystack, audit, consent
  modules/                 admissions · payments · learning · auth
  middleware.ts            host → tenant, and it strips client-asserted tenant headers
  worker/                  purge · lapse-offers · reconcile
tests/isolation.test.ts    §7.4 "the non-negotiable test"
```

## Commands

```bash
npm run dev                 npm run build           npm run typecheck
npm run db:up               npm run db:reset        npm run db:rls
npm run pg:start            npm run pg:stop         npm run pg:status     npm run pg:destroy
npm run test                npm run test:isolation   npm run test:e2e
npm run worker -- purge     npm run worker -- lapse-offers    npm run worker -- reconcile
npm run mail                npm run totp -- <email>
```

---

## Known limitations

`/t/{slug}` path-based tenancy is browse-only: server actions return absolute destinations like
`/apply`, which lose the tenant prefix. Subdomains are the supported mechanism.

A handful of links point at screens that are not built yet — `/account`, `/alumni`,
`/library/takedown`, `/admin/payouts`, `/admin/programme`, `/dpo/evidence` and `/dpo/snag`. They
404 rather than misbehave.

**Assessment authoring is read-only.** FC-02 creates and orders lessons and publishes modules, but
quizzes are seeded rather than built in the UI. Video is absent entirely — §7.2 puts it on
Cloudflare Stream, so FC-02 shows no transcode state because there is no transcode.

**Fee versioning is an open product question (app flow G-19).** Changing a fee changes what
candidates mid-application are charged at checkout. Anyone who has already paid is unaffected —
`transaction_lines` snapshots the amount taken — and the fee screen states how many people are
exposed before you save, but there is no mechanism to honour a quote. The PRD does not settle
this, so neither does the code.

## Testing against a production build

`next dev` and `next start` share the `.next` directory. Running them together lets the dev server
rewrite chunks underneath live production requests, which produces spurious 500s with stack traces
pointing at route handlers that are not involved in the request at all. That cost real time to
diagnose once, so the production config deliberately starts no server of its own:

```bash
npm run build
npx next start -p 3100      # and nothing else touching .next
npm run test:e2e:prod       # the same funnel suite, against the real build
```

## One rule worth knowing before editing an action

**Server actions never call `redirect()`.** They return `{ redirectTo }` and the client navigates —
`ActionForm` and `ActionButton` both do this. A server-side `redirect()` from an action runs the
action correctly, commits its writes, and then lands the router on `/`. Rather than remember which
call sites are affected, every action in the codebase follows the same rule. `redirect()` remains
correct during *page* render, which is how `requireUser`, `requireRole` and `requireInstitution`
work.

## What is not built

Scope was Phase 1 end-to-end plus the Phase 2 learning core. Deliberately left as schema and stubs:

- **E-Library and Resource Centre** (LIB-*, RES-*) — tables, licences and seed corpus exist;
  the search UI, reader, OCR pipeline and curator console do not
- **Alumni community** (ALM-*) — `alumni_profiles` exists with `directory_visible` defaulting to
  false per CMP-15; the directory, forum, jobs board and per-school channels do not
- **SSO Tier 1 and 2** (SSO-02, SSO-03) — Tier 3 works, which is what SSO-01 requires at launch
- **Institution admin screens** IA-02 to IA-09 — fees, cohorts and branding are seeded and
  editable in SQL, not yet through a console
- **Facilitator authoring** FC-01 to FC-03 — grading exists as `gradeSubmission`, without its UI
- **PDF generation** — certificates and admission letters exist as records with verification codes
  and a working public verification page; the Playwright-rendered PDF is not wired
- **Virus scanning and OCR** — `documents.scan_status` is modelled and enforced at read time
  (an `infected` file is never served), but no ClamAV worker runs yet

Against the PRD's own launch gate (§6.13), the outstanding items are organisational rather than
architectural: DPIA sign-off, DPO registration, the institutional DPA, and a penetration test. The
retention purge and signed-URL access the gate names are implemented and testable today.
