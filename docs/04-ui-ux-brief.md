# UI/UX Design Brief
## Multi-Institutional LMS — Post Graduate Diploma in Data Protection & Privacy

| | |
|---|---|
| **Document** | 04 — UI/UX Design Brief |
| **Version** | 1.0 |
| **Date** | 11 September 2026 |
| **Source of truth** | PRD v0.3 · App Flow v1.0 (96 screens) |
| **Palette source** | Supplied brand palette — Redaction, Oxblood, Manila, Paper, Signal |
| **Type** | Literata · IBM Plex Sans · IBM Plex Mono |

Every contrast ratio in this document has been calculated, not estimated. Where a supplied colour cannot be used as it appears in the reference, it is flagged in §12 rather than quietly adjusted.

---

## 1. Experience Goal & Visual Direction

### 1.1 The job the interface has to do

Three audiences use this product and they want opposite things from it.

**Candidates** are anxious. They are uploading their degree certificate and a photograph of their face to a website, then paying a non-refundable fee to an institution they may never have visited. Every screen in the admissions funnel is answering one question: *is my application safe and where has it got to?* Anxiety is reduced by legibility and by status that is never ambiguous — not by reassuring illustration.

**Students and alumni** are practising professionals reading dense legal material — statutes, judgments, NDPC guidance — often at night, on a phone, on a bad connection. They need long-form reading comfort and search that gets out of the way.

**Staff** — registry officers, facilitators, curators, the DPO — are operating on other people's personal data, at volume, under statutory clocks. Their screens need density, scanability, and a constant ambient reminder that every action is logged.

### 1.2 Direction — "The Case File"

The product's subject matter is the **record**: documents submitted, verified, filed, retained, and eventually destroyed. The visual system is built from that vocabulary rather than from generic edtech.

Two substrates carry the entire hierarchy:

- **Paper** `#F7F4EE` is the working surface. Every page sits on it. It carries interface, not content.
- **Manila** `#E3D9C4` is **the record**. Manila appears if and only if the thing on screen is a filed artefact — an application, a submitted document, a module, a library item, a certificate, an admission letter. It is semantic, not decorative.

That single rule does most of the design work. A user learns within one session that manila means *this is a thing on file about me, or about someone*. It must not be spent on decoration.

**Redaction** `#14110F` is ink — and, at full-bleed, the chrome of staff consoles, so that operating on other people's data looks and feels different from using your own account.

**Oxblood** `#6B2436` is institutional authority: primary actions, section rules, seals, letterheads. It is the colour of the decision being made.

**Signal** `#0E9B94` is reserved with unusual strictness: it means **verified, confirmed, cleared** and nothing else. A confirmed payment, a valid certificate, a granted consent, a cleared licence. It never decorates. Because it appears so rarely, it carries real weight when it does.

### 1.3 What this system deliberately avoids

No shadows. No gradients. No glassmorphism. No uniform rounded card kit. Hierarchy comes from **substrate + hairline rule + spacing**, which is how physical documents do it, and which also happens to be the cheapest thing to render on a low-end Android over 3G.

Border radius is near-square throughout (2–4px), with exactly one exception — the verification seal is a circle. That single round form in an otherwise rectilinear system is the memorable element. Spend the boldness there and keep everything else quiet.

### 1.4 Voice

Plain, specific, unhurried. Errors state what happened and what to do. Status states where a thing actually is. Sentence case everywhere, including buttons. A button names its outcome — *Submit and pay*, not *Continue*; *Set password*, not *Submit* — and the same verb survives into the confirmation.

Never apologise in an error. Never use exclamation marks in the admissions funnel; a candidate who has just paid ₦25,000 does not want cheerfulness, they want a reference number.

---

## 2. Colour System

### 2.1 Core tokens (supplied)

| Token | Hex | Name | Role |
|---|---|---|---|
| `--ink` | `#14110F` | Redaction | All primary text; staff console chrome; redaction bars |
| `--authority` | `#6B2436` | Oxblood | Primary actions, institutional marks, section rules, seals |
| `--record` | `#E3D9C4` | Manila | Surface of any filed artefact — **semantic, never decorative** |
| `--surface` | `#F7F4EE` | Paper | Default page substrate |
| `--verified` | `#0E9B94` | Signal | Verification and confirmation states **only** |

### 2.2 Derived neutrals (extension — required, none supplied)

| Token | Hex | Contrast on Paper | Use |
|---|---|---|---|
| `--ink-900` | `#14110F` | 17.13:1 | Body text, headings |
| `--ink-700` | `#3A342F` | 11.2:1 | Secondary headings, staff table text |
| `--ink-500` | `#6B635A` | 5.38:1 | Secondary text, **input borders**, icon strokes |
| `--ink-300` | `#A79E90` | 2.41:1 | Decorative rules and dividers **only — never a control boundary** |
| `--ink-100` | `#D8D2C7` | — | Disabled fills, skeleton blocks, table zebra on Paper |

> `--ink-300` fails the 3:1 non-text threshold. It may separate content. It may **never** be the visible boundary of an input, button, checkbox or focusable control. Those use `--ink-500` or darker.

### 2.3 Status tokens (extension — required, none supplied)

The supplied palette has no error, warning or informational colour, and Oxblood cannot serve as "danger" because it is the primary action colour.

| Token | Hex | On Paper | Use |
|---|---|---|---|
| `--danger` | `#C0281F` | 5.39:1 | Destructive actions, validation errors, failed payment, breach alerts |
| `--warning` | `#8A5B00` | 5.35:1 | Offer expiring, SLA approaching, document queried, purge overdue |
| `--verified-text` | `#0A6F6A` | 5.47:1 | Any **text** meaning confirmed/verified |
| `--verified-fill` | `#0E9B94` | 3.12:1 | Seal fills, confirmed badges, progress fills — **never text on Paper** |
| `--info` | `#3A342F` | 11.2:1 | Neutral system messages — deliberately no new hue |

Alert backgrounds are the status hue at 8% over Paper, with a 3px left rule in the full-strength hue and `--ink-900` body text. Never coloured text on a coloured tint.

### 2.4 Contrast matrix (calculated)

| Foreground | on Paper | on Manila | on Redaction | on Oxblood | on Signal |
|---|---|---|---|---|---|
| Redaction `#14110F` | **17.13** ✓ | **13.42** ✓ | — | 1.73 ✗ | **5.49** ✓ |
| Paper `#F7F4EE` | — | 1.28 ✗ | **17.13** ✓ | **9.91** ✓ | 3.12 ✗ |
| Oxblood `#6B2436` | **9.91** ✓ | **7.77** ✓ | 1.73 ✗ | — | 2.66 ✗ |
| Signal `#0E9B94` | 3.12 ✗ | 2.44 ✗ | **5.49** ✓ | 2.66 ✗ | — |
| ink-500 `#6B635A` | **5.38** ✓ | 4.21 ✗ | 3.18 ✗ | — | — |

**The three rules that fall out of this matrix and are not negotiable:**

1. **Signal is never a text colour on Paper or Manila.** Use `--verified-text` `#0A6F6A` for any verified wording.
2. **A Signal-filled button takes Redaction text, not white.** Paper on Signal is 3.12:1 and fails. Redaction on Signal is 5.49:1 and passes.
3. **Signal never touches Manila** at 2.44:1 — it fails even the 3:1 non-text threshold. The reference card's teal ring around an oxblood seal on a manila field is a genuine failure (see §12, C-02). The seal sits on Paper, or the ring becomes Oxblood.

Note also `--ink-500` on Manila is 4.21:1 — it fails for body text. **Secondary text on a manila record card uses `--ink-700`, not `--ink-500`.**

### 2.5 Tenant theming — constrained

PRD §4 and IA-06 give every institution its own logo and colours. An uncontrolled tenant colour destroys both the semantic system and the contrast guarantees.

**Tenant-overridable:** `--tenant-brand` — used in exactly four places: the institution mark in the header, the header identity band, the admission-letter and certificate letterhead, and the institution card on PB-02.

**Never overridable:** every semantic token above. Primary action stays Oxblood across all tenants. Verified stays Signal. Manila stays the record surface. A registry officer moving between institutions must not have to relearn what a colour means, and the platform's contrast compliance cannot depend on a university administrator's colour taste.

**IA-06 must validate and block.** The branding screen runs a live contrast check against Paper and against its own foreground, and refuses to save a colour that fails 4.5:1 — with a plain explanation and a nearest-passing suggestion. Do not warn-and-allow. (See §12, C-04.)

---

## 3. Typography

### 3.1 Families and roles

| Family | Role | Why |
|---|---|---|
| **IBM Plex Sans** | All interface — navigation, forms, buttons, tables, labels, dashboards | Neutral, institutional, excellent at small sizes, wide weight range. Reads as public-sector infrastructure, which is correct here |
| **Literata** | Long-form reading only — library reader (LB-03), lesson rich text (ST-03), privacy notice (PB-06), admission letter and certificate | A screen-reading serif with real optical sizing. Gives legal and academic text the register it deserves and visibly separates *content* from *interface* |
| **IBM Plex Mono** | Genuine data only — verification codes, payment references, matriculation numbers, legal citations, timestamps, audit-log entries, OTP fields | Character disambiguation matters when someone is reading a payment reference to a support agent over the phone |

**Plex Mono is not a styling device.** It does not go on small labels, eyebrows, or metadata for texture — that is the commonest tell of a templated interface. If the string is not something a person might need to transcribe or verify character by character, it is Plex Sans.

The Literata/Plex Sans split is doing real work: on LB-03 and ST-03 the user is reading *someone else's document*, and it should not look like the chrome around it.

### 3.2 Type scale

Base 16px. Desktop values; mobile overrides in §3.3.

| Token | Size | Weight | Line height | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `display` | 44px / 2.75rem | 600 | 1.1 | -0.02em | Plex Sans | PB-01 hero only |
| `h1` | 32px / 2rem | 600 | 1.2 | -0.015em | Plex Sans | Page titles |
| `h2` | 24px / 1.5rem | 600 | 1.25 | -0.01em | Plex Sans | Section headings |
| `h3` | 20px / 1.25rem | 600 | 1.3 | 0 | Plex Sans | Card and panel headings |
| `h4` | 17px / 1.0625rem | 600 | 1.35 | 0 | Plex Sans | Sub-sections, form group headings |
| `body-lg` | 18px | 400 | 1.6 | 0 | Plex Sans | Lead paragraphs, marketing body |
| `body` | 16px | 400 | 1.6 | 0 | Plex Sans | Default UI text, form values |
| `body-sm` | 14px | 400 | 1.5 | 0 | Plex Sans | Helper text, table cells, dense staff UI |
| `label` | 14px | 600 | 1.3 | 0 | Plex Sans | Field labels — **sentence case, not uppercase** |
| `caption` | 12px | 400 | 1.45 | 0.005em | Plex Sans | Timestamps, footnotes, licence lines |
| `read` | 19px | 400 | **1.75** | 0 | Literata | Library reader, lesson prose, privacy notice |
| `read-h` | 26px | 600 | 1.3 | -0.01em | Literata | Headings inside reading surfaces |
| `data` | 15px | 400 | 1.4 | 0.02em | Plex Mono | References, codes, citations |
| `data-lg` | 22px | 500 | 1.3 | 0.04em | Plex Mono | Matric number, verification code on PB-07 |

**Deliberate omission:** there is no uppercase tracked-out label token. Small caps labels above every field are template chrome and they hurt legibility for the exact population most likely to be on a small screen. Labels are sentence case at 600 weight; hierarchy comes from weight and spacing.

### 3.3 Mobile overrides (≤767px)

`display` → 32px · `h1` → 26px · `h2` → 21px · `h3` → 18px · `read` → 18px/1.7 · `data-lg` → 19px. Body sizes do not shrink. **Nothing in the product renders below 14px on mobile**, including captions, which step up to 13px.

### 3.4 Measure

- Plex Sans body: 60–72 characters
- Literata reading surfaces: 66–78 characters (serif tolerates slightly more)
- Form column: 640px max regardless of viewport — a 1400px-wide input is unusable
- Staff data tables are exempt and may run full container width

### 3.5 Loading strategy — a real constraint

Three families against a <3s-on-3G budget (PRD §8) is a genuine tension. Required:

- Variable WOFF2 only, Latin subset, `font-display: swap`
- **Preload only** Plex Sans 400 and 600 — the two faces needed for first paint on every screen
- **Literata loads only on reading surfaces** (LB-03, ST-03, PB-06, and PDF generation). It is not part of the global bundle
- **Plex Mono is subset to digits, uppercase A–Z, hyphen, slash and colon** — the entire character set our data strings need. This takes it to a few kilobytes
- Fallback stacks chosen for similar metrics so reflow on swap is minimal

Total web-font budget: **≤110KB** on the application funnel, ≤180KB on reading surfaces.

---

## 4. Spacing, Grid, Containers, Responsive

### 4.1 Spacing scale

4px base: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`. Nothing off-scale.

Vertical rhythm inside forms: 8px label→input, 6px input→helper, 24px between fields, 40px between field groups, 64px before the action bar.

### 4.2 Grid

| Breakpoint | Width | Columns | Gutter | Margin |
|---|---|---|---|---|
| `xs` | 360–479 | 4 | 16 | 16 |
| `sm` | 480–767 | 4 | 16 | 24 |
| `md` | 768–1023 | 8 | 20 | 32 |
| `lg` | 1024–1279 | 12 | 24 | 40 |
| `xl` | ≥1280 | 12 | 24 | 48 |

**360px is the design baseline, not 375.** A large share of this audience is on a budget Android. Every screen is drawn at 360 first and must work there without horizontal scroll.

### 4.3 Containers

| Container | Max width | Used for |
|---|---|---|
| `marketing` | 1200px | PB-01 to PB-05 |
| `app` | 1120px | Student and alumni surfaces |
| `form` | 640px | Application steps, checkout, all auth screens |
| `reading` | 720px | LB-03, ST-03, PB-06 |
| `console` | fluid, 32px margins | Staff tables and consoles — density beats symmetry here |

### 4.4 Radius and elevation

`--radius-sm: 2px` (inputs, buttons, chips) · `--radius-md: 4px` (cards, panels, modals) · `--radius-full` (verification seal and status dots **only**).

**There are no shadows in this system.** Separation is achieved by substrate change (Paper → Manila), a 1px `--ink-300` rule, or spacing. Modals and sheets are the single exception: a `rgba(20,17,15,0.45)` scrim, no shadow on the panel itself, which sits on Paper with a 1px `--ink-500` border.

---

## 5. Components

### 5.1 Buttons

| Variant | Fill | Text | Border | Contrast | Use |
|---|---|---|---|---|---|
| Primary | Oxblood | Paper | none | 9.91:1 | The one forward action per screen |
| Secondary | transparent | ink-900 | 1px ink-500 | 17.13:1 | Alternative paths |
| Tertiary | transparent | ink-700, underlined | none | 11.2:1 | Low-weight actions, in-text |
| Danger | `--danger` | Paper | none | 5.39:1 | Destructive only, always confirmed |
| Verified | Signal | **Redaction** | none | 5.49:1 | Rare — only where the action *is* verification |
| On-dark primary | Paper | Redaction | none | 17.13:1 | Staff console dark band |

Heights: 48px (default, and the only size on mobile) · 40px (dense staff tables) · 32px (inline table row actions, desktop only). Minimum horizontal padding 20px. Minimum touch target 44×44 always, achieved with padding where the visual height is smaller.

No icon-only buttons without an accessible name. No arrow glyph appended to button text.

### 5.2 Inputs

Height 48px, 1px `--ink-500` border, `--radius-sm`, Paper fill, 12px horizontal padding, `body` text, label above at `label`, helper below at `body-sm` in `--ink-500`.

- **Focus:** 2px Paper inner ring + 3px Redaction outer ring (see §6). Works on Paper, Manila and Redaction surfaces identically
- **Error:** border `--danger` 2px, message below in `--danger` with a warning glyph — never colour alone
- **Filled and valid:** no green tick. Validation success is silent; only verification uses Signal
- **Read-only:** Manila fill, no border, `--ink-700` text — reads as "on file", consistent with the substrate rule
- **Locked:** read-only plus a short reason and a route to request change (required by ST-14)

Specialist inputs:
- **Code field** (AU-02, AU-08): 6 separate 48×56px cells, Plex Mono `data-lg`, auto-advance, paste-whole-code support
- **Consent row** (AP-07): a full-width Manila row, 44px switch on the right, purpose title at `h4`, plain-language purpose beneath, notice-version link at `caption`. Unset state is visibly unset, not a grey that reads as off-but-maybe-on
- **Document slot** (AP-05): see §5.5
- **Search** (LB-01, RC-01): 56px tall, leading magnifier, clear control, submit on enter, result count announced

### 5.3 Navigation

**Student / alumni:** top bar 64px on Paper with a 1px bottom rule. Tenant mark left, primary nav centre-left, account menu right. Mobile: 56px bar plus a 5-item bottom tab (Dashboard, Programme, Library, Alumni, Account).

**Application funnel:** no global nav. A step rail replaces it — 7 steps, numbered (legitimately, it is a sequence), current step in Oxblood, completed steps with a tick, incomplete steps in `--ink-500`. Desktop: vertical rail left of the form. Mobile: horizontal scroll strip pinned under the header showing "Step 3 of 7" plus the step name.

**Staff consoles:** a full-bleed Redaction band, 56px, spanning the top of every staff screen, with Paper text and the institution name. This is the ambient signal that you are operating on other people's data. Inside it, permanently, at `caption`: *All access to applicant records is logged.* Not a dismissible banner — chrome.

**Tenant switcher** (AU-10, G-07): in the account menu, showing institution and role. Switching reloads to the equivalent screen in the new tenant where one exists, otherwise that tenant's home.

### 5.4 Cards

Only two card types exist. This is deliberate — an interface where everything is a rounded card teaches nothing.

**Record card (Manila).** Any filed artefact. `--radius-md`, Manila fill, no border, 20px padding. Title at `h3`. A 2px Oxblood rule, 48px wide, sits above the title as the record mark. Metadata at `body-sm` in `--ink-700` (not `--ink-500` — see §2.4). Used for: application summary, module, library item, certificate, admission letter, submitted document, alumni profile.

**Panel (Paper).** Interface grouping — filters, settings, summaries, stats. `--radius-md`, Paper fill, 1px `--ink-300` rule, 20px padding. Never Manila; a filter panel is not a record.

### 5.5 Product-specific components

**Verification seal.** The one circular form in the system. 64px (56px mobile), Oxblood fill, Paper glyph, Signal 2px ring **on Paper surfaces only**. Appears on PB-07 valid state, ST-12, the certificate, the admission letter. It is the product's signature — do not put it anywhere that is not actually verified.

**Status stepper** (AP-01). Horizontal on desktop, vertical on mobile. States: complete (Oxblood, tick), current (Oxblood, filled dot, label at 600), queried (`--warning`, alert glyph), blocked (`--danger`), pending (`--ink-500`, hollow). The current state is also stated in a sentence above the stepper, because a stepper alone is not a status.

**Document slot** (AP-05). Manila tile, 100px tall, 2px dashed `--ink-500` when empty. States: empty with document name and format hint · uploading with a determinate bar in Oxblood · compressing · scanning · complete with thumbnail, filename, size and Replace/Remove · rejected with the specific reason (too large / wrong format / unreadable / virus detected) · queried with a `--warning` left rule and the registry officer's note verbatim.

**Payment pending** (PY-02). Full-viewport-height centred panel. An indeterminate progress bar in Oxblood, never a spinner that could read as an error state. Reference in Plex Mono `data-lg`, selectable, with a copy control. Copy is explicit: money has left the account, no further action is needed, the tab may be closed. `aria-live="polite"` announces the transition. **This screen must never show `--danger` while polling** (see §12, C-07).

**Offer countdown** (AP-10). Days remaining at `h2` with the expiry date in full beneath — never a ticking seconds timer. `--ink-700` above 48 hours, `--warning` below. Never `--danger`: the offer is not an error.

**Licence badge** (LB-02). Two states only, always with text, never colour alone: *Download available* (Signal dot + `--verified-text`) and *Read at source* (`--ink-500` dot + `--ink-700`).

**SLA clock** (DP-02, DP-03). Days remaining as a Plex Mono numeral. `--ink-700` >10 days, `--warning` ≤10, `--danger` ≤3 or overdue. Overdue rows get a 3px `--danger` left rule and sort to the top.

**Redaction bar.** A solid Redaction block over withheld content. **Functional only** — masked NIN, unrevealed alumni fields, minimised data on PB-07. Marked `aria-hidden` with the real state exposed as text ("National Identification Number — stored, not displayed"). It is permitted once as a brand device on PB-01, where nothing is being hidden from anyone. It appears nowhere else decoratively (see §12, C-03).

### 5.6 Feedback

**Inline validation** on blur, never on keystroke. **Banner alerts**: 8% status tint, 3px status left rule, `--ink-900` text, glyph plus a word naming the status. **Toasts** for reversible confirmations only, 5s, bottom-centre mobile / bottom-right desktop, never for errors, never for anything a user must read. **Modals** only for irreversible decisions — decline offer, sign out everywhere, delete a record, issue a decision — with the consequence stated in the body and the verb repeated on the button. **Empty states** carry a heading naming what will appear here, one sentence, and the action that starts it; never an illustration. **Skeletons** are static `--ink-100` blocks matching final layout. **No shimmer animation** — it is decorative and costs paint on the exact devices we are optimising for.

---

## 6. Interaction States

Every interactive element implements all applicable states. No element ships with fewer.

| State | Treatment |
|---|---|
| Default | As specified per component |
| Hover (pointer only) | Primary: Oxblood → `#571C2C`. Secondary: 6% ink wash. Rows: Manila 40% wash. No transform, no shadow, no scale |
| Focus-visible | **2px Paper inner ring + 3px Redaction outer ring, 2px offset.** Identical everywhere; works on Paper, Manila and Redaction alike. Never removed, never replaced with colour alone |
| Active | 2% darker fill, no displacement |
| Disabled | `--ink-100` fill, `--ink-500` text, `not-allowed` cursor. **Never the only signal** — always paired with visible text saying what is missing |
| Loading | Label replaced with an indeterminate bar; width locked to prevent reflow; `aria-busy` |
| Error | Status border, message below, glyph, `aria-describedby` |
| Success | Silent for ordinary saves; Signal only where the meaning is *verified* |
| Read-only | Manila fill, no border |
| Locked | Read-only plus reason plus route to request change |
| Selected | 2px Oxblood left rule plus Manila fill |
| Drag-over (upload) | Border → 2px solid Oxblood, tile → Manila |
| Offline-queued | `--warning` left rule, "Saved on this device, will sync" |

**Disabled is the most abused state in this product.** AP-08 disables *Submit and pay* until the application is complete. A disabled button with no explanation fails WCAG 3.3.1. The button must always be accompanied by a list of exactly what is outstanding, each item a jump link to that step.

---

## 7. Composition Guidance — Core Screens

### PB-01 Platform landing

```
┌────────────────────────────────────────────────┐
│ [mark]                          Verify  Log in │
├────────────────────────────────────────────────┤
│                                                │
│  Post Graduate Diploma in                      │
│  ███████████ and Privacy        ← redaction    │
│                                   brand moment │
│  One application. Five universities.           │
│  [ Browse programmes ]                         │
│                                                │
├────────────────────────────────────────────────┤
│ Institution cards — Manila, 3-up               │
└────────────────────────────────────────────────┘
```

The hero is the type treatment itself: the headline partially redacted, resolving on scroll to reveal "Data Protection". This is the single orchestrated motion moment in the entire product (§9). Nothing else on the marketing site animates on entry. No stock photography of students with laptops.

### PB-07 Certificate verification

Paper. Centred, 480px. Verification seal at top. Four facts only — name, programme, institution, cohort — each as `label` plus `body`. The code echoed in Plex Mono. Valid, revoked and not-found are three visually distinct outcomes, each stated in words. **Revoked is not styled as an error** — it is a factual outcome, `--ink-700`, not `--danger`.

### AU-03 Log in

`form` container, 640px, vertically centred, Paper. Tenant mark and institution name above the fields — a student needs to know which university they are logging into. Password field, then *Forgot password*, then a full-width primary. SSO button, where the tenant has it, sits **above** the fields with a rule and the word "or" — it is the faster path for the people who have it.

### AP-01 Application dashboard

```
┌──────────────────────────────────────────────┐
│ [tenant mark]  University of X    [account]  │
├──────────────────────────────────────────────┤
│ Your application                             │
│ ─── (oxblood rule)                           │
│ Under review since 4 September.              │
│ ①──②──③──④──⑤   ← stepper                   │
│                                              │
│ ┌── MANILA ──────────────────────────────┐   │
│ │ ▌ PGD Data Protection · Jan 2027 intake│   │
│ │ Application fee paid · ₦15,000          │   │
│ │ Ref PSK_8H2K19M                         │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ [ Primary action — state dependent ]         │
└──────────────────────────────────────────────┘
```

One record card, one status sentence, one primary action. If a document query is open it takes a `--warning` banner directly beneath the stepper and the primary action becomes *Re-upload transcript*. The candidate should never have to hunt for what to do next.

### AP-02 to AP-04 Form steps

Step rail left (desktop) or strip (mobile). Single column, 640px, one question group per section with an `h4` heading. Autosave indicator sits at the bottom of the rail, at `caption`, stating the last saved time in words — *Saved 2 minutes ago* — not a spinner. Action bar is sticky at the bottom on mobile, static on desktop: *Save and continue* primary, *Back* secondary.

### AP-05 Document upload

Vertical list of Manila document slots, one per required document, each with the document name as `h4`. A completion count above — *3 of 5 uploaded*. The 5MB limit and accepted formats are stated **before** the first upload, not discovered on failure. On mobile the primary control is *Take a photo*, with *Choose file* secondary, because that is the actual behaviour.

### AP-07 Consent

Paper, 640px. A short paragraph naming the controller and linking the notice version. Then four consent rows. Rows (a) and (b) — which rest on contract, not consent — render as **information rows with the lawful basis stated**, visually distinct from rows (c) and (d), which are real switches. This is a design consequence of gap G-02 and must be confirmed before build (§12, C-05).

### PY-01 / PY-05 Checkout

Manila record card listing line items, right-aligned amounts in Plex Mono, a 1px rule above the total, total at `h3`. Non-refundable statement sits **directly above the primary button**, at `body-sm` in `--ink-900` — not in a footnote, not greyed. Bank-transfer alternative as a secondary action, not hidden in a link.

### ST-01 Student dashboard

Continue-where-you-left-off as the first element: a Manila record card with module name, lesson title, progress bar and a primary *Continue*. Below, in a 2-column desktop grid: upcoming deadlines, announcements. Progress is shown as a proportion with words — *6 of 14 lessons* — not only a bar.

### ST-03 Lesson player

Video full-width to 840px, Paper surround. Quality selector including **audio-only**, visible not buried in a settings menu. Lesson prose below in Literata at `read`, 720px measure. Attachments as small Manila rows. Sticky *Mark complete and continue* at the bottom on mobile.

### ST-05 Assessment in progress

Stripped chrome — no navigation, no sidebar. Timer top-right, `data` mono, `--ink-700`, turning `--warning` under 5 minutes. Save state permanently visible. One question per screen on mobile, scrolling list on desktop with a question-number rail.

### LB-01 Library search

Filters in a left Paper panel (desktop) or a full-screen sheet behind a *Filters* button showing the active count (mobile). Results as Manila record rows: title at `h3`, citation in Plex Mono `caption`, jurisdiction and year, licence badge right-aligned. Full-text snippets with matches in 600 weight — **not colour-highlighted**, since colour-only emphasis fails. Result count and active filters stated in a sentence above the list.

### LB-03 Document reader

Reading container 720px, Literata `read`, Paper. All chrome collapses to a thin top bar. Highlighting uses a Manila wash, not yellow. Notes in a right panel on desktop, a bottom sheet on mobile. Where OCR has not run, a `--warning` banner states plainly that text selection is unavailable for this scanned document.

### RG-01 / RG-02 Registry queue and review

Redaction console band. Dense table at `body-sm`, 44px rows, zebra in `--ink-100`, sortable, oldest first by default. Status as a text chip, never a bare colour dot.

RG-02 splits 60/40: document viewer left with zoom and rotate, application data right as labelled pairs. The verification checklist is a persistent right rail. *Make decision* is the only primary; *Query a document* is secondary. When a query is open, the decision button is disabled **with the reason stated inline**.

### DP-01 DPO console

The only screen where numbers lead. Four Paper panels: open requests with soonest deadline, open SNAGs, open breaches, purge jobs due. Each states a count at `h1` and the worst-case clock beneath. Anything overdue takes a `--danger` left rule and sorts first. If everything is clear, say so in a sentence — an empty compliance console is good news and should read as such.

### System states SY-01 to SY-06

Paper, centred, 480px. A heading naming what happened in plain words, one sentence of explanation, one primary action, a reference code in Plex Mono where support may need it. No illustrations. SY-02 names nothing about what was requested and is logged as a security event.

---

## 8. Mobile Behaviour

- **360px baseline.** Every screen drawn here first.
- **Thumb zone.** Primary actions in the bottom third. Sticky action bars on all form and checkout screens — the button is never below the fold of a long form.
- **Sheets, not modals.** Full-screen bottom sheets with an explicit *Close*. No dismiss-by-tapping-outside for anything with unsaved state.
- **Tables become record cards.** No horizontal scrolling tables anywhere, including staff screens. Registry officers on mobile get a card list with the three fields that matter for triage.
- **Camera first on AP-05.** *Take a photo* is the primary control. Compression happens before the size check with a visible "Preparing your file" state, so a 6MB phone photo never produces a size error.
- **Cropping (AP-06)** supports pinch-zoom and drag with 44px handles.
- **Sticky context.** Step number and total remain visible while scrolling a form.
- **Offline banner** is persistent, not a toast, and states what is queued.
- **Video defaults to the lowest quality tier** and lets the user raise it. Never autoplay.
- **Staff consoles are desktop-first and say so** — see §12, C-09.

---

## 9. Motion

Durations: 120ms (state change) · 180ms (sheet, accordion) · 240ms (page transition). Easing `cubic-bezier(0.2, 0, 0.2, 1)`. Nothing exceeds 240ms.

**Motion answers an action.** Permitted: sheets sliding, accordions opening, step transitions, upload progress, the indeterminate payment bar, validation messages fading in over 120ms.

**Not permitted:** entrance animations on scroll, staggered card reveals, hover scale or lift, parallax, skeleton shimmer, animated counters, decorative loops, and — specifically — any animated "redaction reveal" inside the product. The redacted hero on PB-01 is the single non-user-triggered motion moment in the entire system, and it exists once.

**Reduced motion** (`prefers-reduced-motion: reduce`): all transforms removed, opacity transitions capped at 100ms, the PB-01 hero renders in its resolved state with no animation. Progress indicators that carry meaning are **never removed** — the PY-02 payment bar becomes a static bar plus a text status line that updates via `aria-live`. Removing feedback is not an accessibility accommodation.

---

## 10. Accessibility Requirements

Target: **WCAG 2.1 AA** (PRD §8), with the 2.2 additions noted where they bear on this product.

- **Contrast.** Text 4.5:1, large text 3:1, non-text and boundaries 3:1. The §2.4 matrix is authoritative. `--ink-300` never bounds a control; Signal never carries text.
- **Colour is never the only signal.** Every status pairs a hue with a glyph and a word. This matters most on AP-01, LB-02, DP-01 and the registry queue.
- **Focus.** Visible on every focusable element, never suppressed. The two-tone ring is mandatory because the product has light, mid and dark surfaces.
- **Keyboard.** Every flow completable without a pointer, including AP-06 cropping (arrow-key nudge and numeric fields as a fallback) and the LB-03 reader. Logical order. Skip-to-content on every page. Focus trapped in modals and returned on close.
- **Touch targets.** 44×44 minimum, 48×48 on primary actions. 8px minimum between adjacent targets.
- **Forms.** Programmatic labels, `aria-describedby` for helper and error text, errors listed at the top of the step and linked to fields (WCAG 3.3.1), autocomplete attributes on name, email, phone and address.
- **Status changes announced.** `aria-live="polite"` on: PY-02 payment confirmation, upload progress and completion, autosave, search result counts, DSR clock changes. `aria-live="assertive"` only for assessment time warnings.
- **Reflow.** Usable at 320px CSS width and at 200% zoom with no horizontal scroll and no loss of function, including staff tables.
- **Reading surfaces.** User-adjustable text size on LB-03 and ST-03, respecting browser settings. Line height ≥1.5, paragraph spacing ≥2× font size.
- **Media.** Captions on all video (LRN-02), transcripts where available, no autoplay, keyboard-operable player.
- **Redaction bars** are `aria-hidden`; the true state is exposed as text. A screen reader user must never encounter silence where sighted users see a bar.
- **Language.** `lang` declared; Nigerian English content, `en-NG`.
- **Timed assessments** (ST-05) rely on the WCAG 2.2.1 essential-timing exception. This must be documented, extended time must be configurable per student for accommodations, and a warning must arrive with ≥5 minutes remaining (see §12, C-06).

---

## 11. Always / Never

**Always**

- Manila means *this is a record*. If it is not a filed artefact, it is Paper.
- Signal means *verified*. If nothing has been verified, no teal.
- State status in a sentence, not only in a stepper, chip or colour.
- Disclose a non-refundable charge directly above the button that charges it.
- Pair a disabled primary action with a list of what is missing and how to fix it.
- Give staff screens the Redaction band and the standing access-is-logged line.
- Name the outcome on the button, and repeat the same verb in the confirmation.
- Draw at 360px first.
- Calculate contrast before committing a colour pairing.

**Never**

- Signal as a text colour on Paper or Manila, or Paper text on a Signal fill.
- Signal adjacent to Manila as a boundary, ring or indicator.
- `--ink-300` as the border of anything focusable.
- Shadows, gradients, glass, or a uniform rounded-card treatment.
- The verification seal anywhere nothing has been verified.
- Redaction bars as decoration inside the product.
- A spinner or any `--danger` styling on PY-02 while a payment is confirming.
- Uppercase tracked-out labels, mono type on non-data strings, or an arrow glyph on buttons.
- A destructive action without a confirmation naming the consequence.
- Illustrations in empty or error states.
- Horizontal scrolling tables on mobile.
- Tenant branding applied to any semantic token.

---

## 12. Flagged Conflicts

Each needs a decision. Nothing here has been silently resolved.

| # | Conflict | Where | Severity | Recommendation |
|---|---|---|---|---|
| **C-01** | **Signal fails contrast for text.** `#0E9B94` on Paper is 3.12:1 and Paper on Signal is 3.12:1 — both fail 4.5:1. A teal button with white text, the most obvious use of a brand accent, is not usable. | Palette vs WCAG AA | **High** | Signal is a fill and seal colour only. `--verified-text` `#0A6F6A` (5.47:1) carries verified wording. Signal fills take Redaction text. |
| **C-02** | **The reference card's teal ring on Manila is 2.44:1** — it fails even the 3:1 non-text threshold, so the verification seal as drawn is not perceivable to low-vision users. | Supplied palette reference | **High** | Seal sits on Paper, not Manila; or the ring becomes Oxblood on manila surfaces. |
| **C-03** | **The redaction motif teaches the wrong model.** In a product whose credibility rests on handling data correctly, a decorative black bar over a heading implies something is withheld when it is not — and risks a student believing real data is hidden when it is displayed. | Brand device vs product meaning | **High** | Functional use only inside the product; one permitted brand instance on PB-01. Confirm before applying anywhere else. |
| **C-04** | **Tenant branding vs the semantic palette.** IA-06 lets institution admins set colours. Unconstrained, that breaks both the meaning system and every contrast guarantee in §2.4. | PRD §4, IA-06 | **High** | Constrain to `--tenant-brand` in four locations; validate at save and **block** failing colours rather than warning. |
| **C-05** | **The consent screen cannot be four equal toggles.** §6.4 puts application processing on contract, not consent, so rows (a) and (b) are not refusable. Presenting them as switches is the exact dark pattern an auditor looks for. | PRD §6.4 vs AP-07 · App Flow G-02 | **High** | Two information rows stating the lawful basis, two genuine switches. Resolve G-02 first. |
| **C-06** | **Timed assessments conflict with WCAG 2.2.1.** ST-05 enforces a time limit that users cannot extend. | LRN-04 vs WCAG 2.2.1 | **Medium** | Rely on the essential-timing exception, document it, and build per-student extended-time accommodation into the facilitator console. |
| **C-07** | **PY-02 can look like failure.** A spinner plus an unresolved state, on a screen a candidate reaches straight after money leaves their account, invites a second payment. | App Flow PY-02 | **Medium** | Indeterminate progress bar in Oxblood, never a spinner. No `--danger` styling while polling. Copy states money has left and no action is needed. |
| **C-08** | **Oxblood and `--danger` share a red family.** Primary action and destructive action are both red-ish, which is a learnability risk for the registry officer clicking *Confirm decision* next to *Reject*. | Palette | **Medium** | Danger always carries a glyph and an explicit verb, and destructive actions are never adjacent to the primary. Consider a distinct destructive placement rather than a distinct hue. |
| **C-09** | **Staff consoles are specified as desktop-first, but registry review will happen on phones.** RG-02's 60/40 document viewer has no viable 360px form. | §4.3, RG-02 | **Medium** | Declare RG-02 desktop-only for v1 and give mobile a triage-and-query view without full document verification, rather than shipping an unusable cramped layout. |
| **C-10** | **Three font families vs the 3s/3G budget.** Literata, Plex Sans and Plex Mono at full character sets exceed a reasonable font budget for this audience. | Type vs PRD §8 | **Medium** | The §3.5 loading strategy is mandatory, not advisory. If the budget is missed, drop Literata from lesson prose and keep it for the library reader only. |
| **C-11** | **The offer countdown is time pressure on a payment decision.** Designed carelessly it becomes a dark pattern on a ₦-denominated commitment. | AP-10 | **Low** | Days and a full expiry date, never a ticking clock. `--warning` at most, never `--danger`. State plainly what happens if it lapses and whether the next intake is open. |
| **C-12** | **Manila's semantics collapse if overused.** The moment a filter panel or a stats box is manila, the substrate rule stops teaching anything. | System-wide | **Low** | Enforce in review: manila is a filed artefact, full stop. |
