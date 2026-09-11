# Product Requirements Document
## Multi-Institutional LMS — Post Graduate Diploma in Data Protection & Privacy

| | |
|---|---|
| **Working name** | PGD-DPP Platform *(name TBD)* |
| **Version** | 0.3 — Tech stack added |
| **Date** | 11 September 2026 |
| **Author** | Victor (Product) |
| **Status** | Open for iteration — assumptions marked **[ASSUMPTION]**, decisions needed marked **[DECISION]**, settled calls marked **[LOCKED]** |

**Changes in v0.3:** added Section 7 (Technical Architecture & Stack), including the data residency constraint and a Laravel alternative. Subsequent sections renumbered.

**Changes in v0.2:** enrollment flow locked to admission-gated; Alumni Community locked to national network with per-school channels; Section 6 (NDPA/GAID compliance) substantially expanded with tier classification, statutory clocks, and a build-facing requirements table.

---

## 1. Overview

### 1.1 What we're building
A shared, multi-tenant learning and admissions platform that lets **multiple Nigerian universities** run a Post Graduate Diploma in Data Protection & Privacy on one system. Candidates apply and enroll online, pay via Paystack, study through the platform, and graduate into a standing alumni community. Alongside the coursework sits a **Resource Centre** (research papers) and an **E-Library** (books, articles, legislation, judgments and legal precedent in data protection and privacy).

### 1.2 Why it matters
- Nigeria's data protection regime is now enforced in earnest. The NDPA 2023 and the GAID 2025 (effective 19 September 2025) create real, recurring demand for qualified DPOs and compliance officers.
- Individual universities cannot each afford to build admissions + LMS + digital library infrastructure for one programme. A shared platform amortises that cost across institutions.
- No consolidated Nigerian repository of data protection legal materials currently exists. The E-Library is a defensible moat, not a side feature.

### 1.3 Product principles
1. **The platform must be exemplary on data protection.** We are teaching privacy while processing credentials, passport photographs and payment data. Any compliance gap is an existential credibility failure.
2. **Multi-tenant from day one, not retrofitted.** Every table, file path, permission and payout is tenant-scoped.
3. **Low-bandwidth first.** Students on 3G in Awka must be able to use this.
4. **The university owns the academics; we own the rails.** We do not set curriculum or award credentials — institutions do.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target (12 months post-launch) |
|---|---|---|
| Institutions onboarded | Live tenants running ≥1 cohort | 5 universities |
| Enrollment funnel works | Application start → paid enrollment conversion | ≥ 35% |
| Payment reliability | Paystack transactions reconciled without manual intervention | ≥ 99.5% |
| Learning completion | Students completing ≥ 80% of modules in a cohort | ≥ 70% |
| Library value | Monthly active users touching E-Library / Resource Centre | ≥ 60% of enrolled students |
| Alumni retention | Alumni logging in ≥ once per quarter post-graduation | ≥ 40% |
| Support load | Password/login tickets per 100 active students per month | < 3 |

---

## 3. Users & Roles

| Role | Description | Scope |
|---|---|---|
| **Candidate** | Prospective student, pre-admission | Self |
| **Student** | Admitted, paid, enrolled | Self, within one institution + cohort |
| **Alumni** | Graduated student | Self + alumni community, retained library access |
| **Facilitator / Lecturer** | Delivers modules, grades | Assigned courses within one institution |
| **Admissions / Registry Officer** | Reviews applications, verifies credentials, admits | One institution |
| **Institution Admin** | Configures programme, fees, cohorts, staff, branding | One institution |
| **Librarian / Content Curator** | Manages E-Library and Resource Centre catalogue | Platform-wide or institution-scoped |
| **Platform Super Admin** | Tenant provisioning, billing, global config | All tenants |
| **Data Protection Officer (DPO)** | Handles data subject requests, breach log, audit | Platform-wide (statutory role) |

---

## 4. Multi-Tenancy Model

**[DECISION]** Recommended: **single application, shared database, tenant-scoped rows** with strict row-level security, plus tenant-isolated object storage prefixes for documents. Cheapest to operate; acceptable if RLS is enforced at the database layer, not just in application code.

Each tenant (university) gets:
- Its own subdomain (`unilag.platform.ng`) or path, plus logo, colours, and letterhead for admission letters and certificates
- Its own programme configuration: entry requirements, fee schedule, cohort calendar, module structure, grading scheme
- Its own Paystack subaccount for settlement
- Its own staff accounts and permissions
- Its own applicant/student data, invisible to other tenants

**Shared across all tenants:** the E-Library catalogue, the Resource Centre, platform-level analytics, and (optionally) the Alumni Community.

**[LOCKED]** The Alumni Community is **one national network with per-school channels**. All alumni share a single directory, jobs board and main forum across every institution; each university additionally gets its own private channel and events space scoped to its own graduates. University affiliation and cohort year appear on every profile. This keeps the network effect while giving each institution something it can point to as "theirs" during the sales conversation.

---

## 5. Feature Requirements

### 5.1 Application & Onboarding

**Flow (recommended):**

```
Discover programme → Create account (email + OTP verify) → Complete application
  → Upload credentials + passport photo → Pay application fee → Submit
  → Registry review → Admitted / Rejected / Waitlisted → Admission letter issued
  → Accept offer → Pay tuition (cart/checkout) → Enrolled → Matric number issued
```

**[LOCKED] — Admission-gated.** Two separate payment events, with the academic gate between them:

1. **Application fee** — non-refundable, charged at submission. Blocks spam applications and funds registry review effort. Set per institution.
2. **Registry review** — credentials verified, decision recorded, offer issued or declined.
3. **Acceptance + tuition** — payable only after an offer is issued and accepted. Enrollment and matric number are created on successful settlement.

Build implications this locks in:
- Two distinct cart contexts, not one. A candidate cannot reach the tuition checkout without an `Admitted` + `OfferAccepted` state.
- Offer expiry: an admission offer lapses if acceptance fee is unpaid within *N* days (institution-configurable, default 14). Lapsed offers free the cohort seat.
- Cohort capacity is enforced at offer issuance, not at payment — otherwise you oversell seats.
- Refund policy only needs to cover tuition edge cases (withdrawal, cohort cancelled), since the application fee is non-refundable and disclosed as such before payment.
- A rejected candidate's documents enter the retention/purge schedule (see CMP-10) — this is the dominant data protection exposure in the funnel, because rejected applicants outnumber admitted ones and nobody remembers to delete their files.

**Requirements:**

| ID | Requirement | Priority |
|---|---|---|
| APP-01 | Candidate creates an account with email + password, verified by emailed OTP or magic link before the application form opens | Must |
| APP-02 | Application form captures: full name, DOB, gender, phone, address, state of origin, nationality, NIN **[DECISION — do we actually need NIN? It is high-risk data; only collect if a university mandates it]**, next of kin, prior institution(s), degree(s), class of degree, year of graduation, work experience, sponsor details | Must |
| APP-03 | Form auto-saves as draft; candidate can leave and return | Must |
| APP-04 | Document upload: degree certificate, transcript, NYSC certificate, passport photograph, ID. Accepts PDF/JPG/PNG, max 5MB each, client-side compression before upload | Must |
| APP-05 | Passport photo validated for minimum resolution and aspect ratio; cropping tool provided in-browser | Should |
| APP-06 | Candidate selects institution and cohort/intake at the start; institution choice drives fees, requirements and branding thereafter | Must |
| APP-07 | Application status tracker visible to candidate: Draft → Submitted → Under Review → Documents Queried → Admitted / Rejected | Must |
| APP-08 | Registry officer can query a specific document (e.g. "transcript unreadable") and the candidate is notified to re-upload that item only | Should |
| APP-09 | Bulk export of applicant data (CSV) for the institution's own records | Should |
| APP-10 | Admission letter generated as branded PDF with unique verification code | Must |

**Explicit consent capture at APP-02:** granular checkboxes, not one bundled "I agree". Separate consent for (a) processing of application data, (b) retention post-programme, (c) inclusion in alumni directory, (d) marketing communications. Consent records timestamped and versioned against the privacy notice text in force at the time.

---

### 5.2 Payments & Checkout (Paystack)

| ID | Requirement | Priority |
|---|---|---|
| PAY-01 | Cart/checkout supporting fee line items: application fee, acceptance fee, tuition, ID card, library levy, examination fee | Must |
| PAY-02 | Paystack Inline / hosted checkout — **no card data ever touches our servers or database** | Must |
| PAY-03 | **Enrollment is confirmed by the `charge.success` webhook, never by the browser callback.** The callback only redirects; the webhook is the source of truth | Must |
| PAY-04 | Webhook signature verified (HMAC SHA512 with secret key); handler is idempotent against duplicate deliveries | Must |
| PAY-05 | Multi-split payments via Paystack Transaction Splits: institution subaccount receives its share, platform receives its commission, automatically at settlement. Split can be percentage or flat, and `bearer_type` determines who absorbs Paystack's fee | Must |
| PAY-06 | Each institution's Paystack subaccount is created and stored (subaccount code) during tenant onboarding; account name must be verified against the resolved bank name | Must |
| PAY-07 | Automated receipt (PDF) emailed on success, with a payment reference and downloadable from the student portal forever | Must |
| PAY-08 | Reconciliation dashboard for institution admins: expected vs settled, per cohort, per fee type | Should |
| PAY-09 | Installment plans — tuition split into 2–3 tranches with access gating on tranche 2 | Should (Phase 2) |
| PAY-10 | Failed/abandoned payment recovery: transaction held for 24h, one reminder email with resume link | Should |
| PAY-11 | Manual/offline payment reconciliation (bank transfer with proof upload, admin marks as paid) — many Nigerian sponsors pay by transfer | Should |
| PAY-12 | Refund workflow with approval chain and audit trail | Could |

**Currency:** NGN only at launch. Splits cannot mix currencies.

---

### 5.3 Authentication, Accounts & Security

**Pushing back on one thing in the brief:** the plan to *generate a password and email it to the student* should not ship. A password sitting in an inbox in plaintext is a permanent, unrotatable credential leak, it cannot be reconciled with NDPA's "appropriate technical measures" standard, and it will be the first thing an auditor or a rival DPO points at. It is also an embarrassing look for a *data protection* programme.

**Recommended instead:**

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | On enrollment, the system emails a **single-use activation link** (cryptographically random token, 24h expiry) — the student sets their own password | Must |
| AUTH-02 | Password policy: minimum 10 characters, must contain letters and numbers (alphanumeric requirement per brief), symbols encouraged; blocklist of common passwords; no forced periodic rotation | Must |
| AUTH-03 | Passwords hashed with Argon2id (or bcrypt cost ≥ 12). Never logged, never emailed, never visible to admins | Must |
| AUTH-04 | Forgot password: email-based reset, single-use token, 30-minute expiry, invalidated on use or on a new request. Response message identical whether or not the account exists (no user enumeration) | Must |
| AUTH-05 | CAPTCHA on registration, login (after 3 failed attempts), and password reset. Use hCaptcha or Cloudflare Turnstile — lighter on bandwidth and more privacy-respecting than reCAPTCHA, which sends data to Google and complicates the cross-border transfer story | Must |
| AUTH-06 | Rate limiting: 5 login attempts per account per 15 minutes, then progressive lockout; IP-level throttling on reset requests | Must |
| AUTH-07 | Session management: httpOnly secure cookies, 30-day "remember me" max, active session list with "sign out everywhere" | Must |
| AUTH-08 | Optional 2FA (TOTP) for staff accounts; **mandatory** for Registry, Institution Admin, Super Admin and DPO roles | Must |
| AUTH-09 | Full audit log of authentication events and all staff access to student records, retained 12 months | Must |
| AUTH-10 | Account lifecycle: Candidate → Student → Alumni, with permissions changing at each transition, and a Suspended state | Must |

*If the generated-password approach is retained regardless:* password must be ≥ 12 characters from a CSPRNG, flagged as temporary, forced change on first login, and expired after 72 hours unused.

---

### 5.4 University Portal Integration (SSO)

**[ASSUMPTION — highest-risk item in this document.]** "Login from their university portal" assumes universities have an identity provider we can federate with. Most Nigerian university portals are bespoke PHP applications with no SAML or OIDC endpoint. Validate this with two or three target institutions *before* engineering commits.

Tiered approach, degrade gracefully:

| Tier | Institution capability | Our implementation |
|---|---|---|
| **1** | University runs SAML 2.0 or OIDC IdP (or Microsoft 365 / Google Workspace for Education) | Full federated SSO. Student clicks portal link, lands authenticated. Just-in-time provisioning on first login |
| **2** | University portal can generate a signed handoff | Signed JWT deep-link: portal signs `{student_id, email, institution_id, exp}` with a shared secret (or asymmetric key), we verify, mint session. Short expiry (≤ 120s), replay protection via nonce |
| **3** | No integration capability | Branded tile/link on the university portal pointing to our tenant subdomain; student logs in natively. Account linking by verified institutional email |

| ID | Requirement | Priority |
|---|---|---|
| SSO-01 | Tier 3 works at launch for every tenant | Must |
| SSO-02 | Tier 2 signed handoff available and documented for integration | Must |
| SSO-03 | Tier 1 OIDC/SAML support | Should (Phase 2) |
| SSO-04 | Identity linking: one human, one platform account, even if they hold accounts at two institutions | Should |
| SSO-05 | Integration guide + sandbox credentials published for university IT teams | Must |

---

### 5.5 Learning Delivery

Scope deliberately kept lean at v1 — the differentiator is admissions + library, not video features.

| ID | Requirement | Priority |
|---|---|---|
| LRN-01 | Programme → Semester → Module → Lesson hierarchy, configurable per institution | Must |
| LRN-02 | Lesson content: video (streamed, adaptive bitrate), PDF/slide attachments, rich text | Must |
| LRN-03 | Progress tracking per student, per module, with resume-where-you-left-off | Must |
| LRN-04 | Quizzes and assessments: MCQ, true/false, short answer, file-upload assignments. Timed, with attempt limits | Must |
| LRN-05 | Gradebook per cohort; facilitator grades assignments with feedback; student sees results | Must |
| LRN-06 | Announcements and cohort-level discussion forum | Should |
| LRN-07 | Live session integration (Zoom/Meet link embedding + calendar invite) | Should |
| LRN-08 | Certificate of completion — branded per institution, unique verification code, public verification URL | Must |
| LRN-09 | Downloadable content for offline study where the institution permits it | Should |
| LRN-10 | Attendance/participation log for accreditation evidence (NUC requirements) | Should |

---

### 5.6 Resource Centre (Research Papers)

| ID | Requirement | Priority |
|---|---|---|
| RES-01 | Searchable catalogue of research papers in data protection and privacy | Must |
| RES-02 | Full-text search plus filters: topic, jurisdiction, year, author, document type | Must |
| RES-03 | Download where licensing permits; otherwise link out to publisher/DOI | Must |
| RES-04 | Students and faculty can submit their own papers; curator approves before publication | Should |
| RES-05 | Citation export (APA, Harvard, BibTeX) | Should |
| RES-06 | Saved searches, bookmarks, and personal reading list | Should |
| RES-07 | Download/view counts per item for curation decisions | Could |

---

### 5.7 E-Library

**Critical constraint the brief needs to absorb:** we cannot "search online and collect all books and articles" on data protection and host them. Most academic books and journal articles are copyrighted, and a data protection programme distributing pirated PDFs is not survivable — reputationally or legally.

**What we can legitimately hold:**

| Content class | Status | Handling |
|---|---|---|
| Nigerian legislation (NDPA 2023, GAID 2025, NDPR 2019 archive, sectoral regulations) | Government works, freely reproducible | Host in full, with full-text search |
| Nigerian court judgments and tribunal decisions on privacy/data protection | Public record | Host in full, annotated with headnotes |
| NDPC guidance, notices, enforcement decisions, CAR templates | Public | Host in full |
| Foreign instruments (GDPR, Convention 108+, ECOWAS Supplementary Act, African Union Malabo Convention, Kenya/Ghana/South Africa statutes) | Public | Host in full |
| Foreign case law (CJEU, EDPB decisions, ICO enforcement) | Public / open licence | Host or deep-link |
| Open-access journal articles (SSRN, arXiv, DOAJ, CC-licensed) | Permitted | Host copy where licence allows, otherwise link with metadata |
| Commercial textbooks and paywalled journals | **Not permitted** | Metadata + abstract + link-out only, or negotiate institutional licence |
| Faculty-authored works | Permitted with author licence | Host, with a signed contributor agreement |

| ID | Requirement | Priority |
|---|---|---|
| LIB-01 | Unified search across all content classes, with full-text search inside hosted documents | Must |
| LIB-02 | Faceted filters: jurisdiction, instrument type, year, court, subject area, availability (downloadable vs link-out) | Must |
| LIB-03 | In-browser document reader with highlighting and personal notes | Should |
| LIB-04 | Citation graph: a judgment shows which statutes it interprets and what has cited it | Could (Phase 3, but this is the killer feature long-term) |
| LIB-05 | Curator console for ingesting documents, tagging metadata, and recording the licence/provenance of every single item | Must |
| LIB-06 | Every item carries a visible source attribution and licence statement | Must |
| LIB-07 | DMCA-style takedown process and contact | Must |
| LIB-08 | Alumni retain library access (this is the core alumni value proposition, and a plausible paid subscription later) | Must |
| LIB-09 | Bulk ingestion tooling for the initial corpus | Should |

**[DECISION]** Who curates the initial corpus and what is the day-one volume target? Recommendation: 300–500 high-quality items at launch, curated by a qualified DP practitioner, not 50,000 scraped files.

---

### 5.8 Alumni Community

| ID | Requirement | Priority |
|---|---|---|
| ALM-01 | Automatic transition Student → Alumni on programme completion | Must |
| ALM-02 | Alumni profile: name, institution, cohort year, current role, employer, specialisation, LinkedIn. **Visibility controlled by the alumnus, default private** | Must |
| ALM-03 | Searchable alumni directory, national in scope, filterable by institution, cohort, specialisation and location (opt-in only — inclusion requires the consent captured at APP-02 or later) | Must |
| ALM-04 | Discussion forum with national topic channels (enforcement updates, DPO practice, job leads) | Should |
| ALM-05 | Jobs/opportunities board — DPO and compliance roles, national | Should |
| ALM-06 | Events: webinars, CPD sessions, annual meetup, with RSVP | Should |
| ALM-10 | **Per-school channels:** each institution gets a private channel and events space visible only to its own alumni, moderated by that institution's admin. Alumni see the national space plus their own school's space | Must |
| ALM-11 | Institution admins can broadcast to their own alumni only; platform admins can broadcast nationally. Both respect unsubscribe | Must |
| ALM-12 | Cross-institution visibility is directory-level by default: an alumnus of School A sees School B graduates in the directory (where opted in) but not inside School B's private channel | Must |
| ALM-07 | Mentorship pairing: alumni to current students | Could |
| ALM-08 | Moderation tools, reporting, and a code of conduct | Must |
| ALM-09 | Alumni newsletter / broadcast, with unsubscribe honoured | Should |

**Scope warning:** a community is a product, not a feature. v1 should be directory + forum + jobs board only. Do not build a social network.

---

### 5.9 Administration

- **Institution Admin console:** programme setup, fee schedule, cohort calendar, staff management, branding, Paystack subaccount, application review queue, reports
- **Platform Super Admin console:** tenant provisioning, global library curation, platform-wide analytics, feature flags, billing to institutions
- **DPO console:** data subject request log (access, rectification, erasure, portability, objection) with statutory clock, breach register, consent records, retention schedule execution, processing activity record

---

## 6. Compliance Requirements (NDPA 2023 / GAID 2025)

> **Framing.** This is a platform that trains Data Protection Officers. Its own compliance posture is a sales asset, not overhead — an institution's registrar will ask, and a rival will look. Treat this section as product requirements, not legal appendix. Every obligation below should have a screen, a job, or a log behind it.

### 6.1 Regulatory landscape

The Nigeria Data Protection Act 2023 is the governing statute. The **General Application and Implementation Directive (GAID) 2025**, issued by the NDPC on 20 March 2025 and effective **19 September 2025**, is the operative implementation instrument — it repealed the NDPR 2019 and its 2020 Implementation Framework. Everything below is built against the NDPA + GAID pair.

The GAID applies extraterritorially: an entity does not need to be physically located in Nigeria to be caught, if it targets Nigerian data subjects. That matters if any part of the stack or any partner institution sits offshore.

### 6.2 Our classification — DCPMI tiering

GAID sorts Data Controllers and Processors of Major Importance into three levels, driven by the number of data subjects processed over a six-month window (and by sector designation), with the general trigger sitting at more than 200 data subjects:

| Tier | Volume band (as reported in commentary on Schedule 7) | Registration | CAR |
|---|---|---|---|
| **Ultra-High Level (UHL)** | 50,000+ data subjects | Register once | File CAR annually |
| **Extra-High Level (EHL)** | 10,000 – 49,999 | Register once | File CAR annually |
| **Ordinary-High Level (OHL)** | 2,500 – 9,999 | **Renew annually** | Exempt from annual CAR |

**Our realistic position:** at 5 institutions in year one we are likely in the low thousands of data subjects — **OHL**, possibly below the DCPMI threshold on volume alone. But commentary on GAID places education/government bodies inside the designated sectors, and we process credentials and passport photographs at scale. **[LOCKED]** Register regardless, in year one, and model the cost of climbing to EHL as institutions are added. Treat tier as a metric we actively monitor, not a one-off assessment.

> **Do not treat the numbers above as settled.** Secondary sources report the Schedule 7/10 bands inconsistently (particularly around the 2,500–10,000 boundary and the EHL fee steps). Confirm our exact classification and fee against the Schedules with a licensed DPCO before budgeting. Source text: https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf

**Filing mechanics to budget for:**
- CAR must be filed **through a licensed Data Protection Compliance Organisation (DPCO)** — this is an external cost, not an internal task
- Deadline for UHL/EHL filers is **31 March** each year (moved from the old 15 March)
- Entities established after 12 June 2023 file their first CAR within **15 months** of incorporation
- Late filing attracts an administrative penalty of **50% of the applicable CAR fee**
- Reported filing fees run from ₦100,000 up to ₦1,000,000 depending on tier and volume — a step change from the NDPR-era ₦10,000–₦20,000

### 6.3 Controller / processor allocation — **[LOCKED]**

This drives the contracts, the registration burden, and who answers when a student complains. Allocation:

| Data domain | Controller | Processor | Notes |
|---|---|---|---|
| Applications, credentials, passport photos, admission decisions | **Institution** | Platform | It is the university's admissions process; they decide who is admitted and on what basis |
| Academic records, grades, certificates | **Institution** | Platform | Institution awards the credential |
| Payment records | **Joint**, split by purpose | Paystack (independent controller for its own AML/KYC obligations) | Institution controls fee assessment; platform controls its own commission records |
| Platform accounts, authentication, session and audit logs | **Platform** | — | Our infrastructure, our security obligation |
| E-Library and Resource Centre usage | **Platform** | — | Our service |
| Alumni Community profiles and content | **Platform** | — | Cross-institution by design; a single institution cannot control it |
| Platform-level analytics | **Platform** | — | Must be aggregated/pseudonymised before leaving tenant scope |

Consequences to build and paper:
- A **Data Processing Agreement with each institution** covering: scope and purpose, our processing instructions, sub-processor list and change notification, security measures, breach notification to the institution (we notify them promptly — their 72-hour clock to the NDPC runs from their awareness), assistance with data subject requests, audit rights, and deletion/return on exit
- An **exit and portability clause**: if a university leaves, it gets a full structured export of its data within a defined window and we then purge. Build the export; a promise without a working export button is a broken clause
- We cannot reuse institution-controlled application data for platform purposes (e.g. marketing the alumni community) without a lawful basis of our own — which is why alumni inclusion has its own consent (see 6.5)

### 6.4 Lawful basis mapping

Every processing activity gets a documented basis. No activity ships without a row here.

| Processing activity | Lawful basis | Notes |
|---|---|---|
| Account creation and authentication | Contract | Necessary to deliver the service |
| Application form data and credential documents | Contract (steps prior to entering a contract) + legal obligation where NUC/registry rules apply | Not consent — consent is withdrawable and we cannot un-admit someone |
| Passport photograph | Contract | Used for ID card, exam identity, certificate. Not used for facial recognition — if that ever changes it becomes a different, higher-risk question |
| NIN, if collected | Legal obligation **only where an institution can cite one** | **[DECISION]** Default to NOT collecting NIN. It is high-value identity data, it raises our breach blast radius sharply, and nothing in the enrollment flow needs it. If a university insists, they must state the legal requirement in writing and it is stored encrypted, masked in all UIs, and never exported |
| Payment processing | Contract + legal obligation (financial records retention) | Card data never touches us — Paystack hosted |
| Course delivery, progress, grading | Contract | |
| Certificate issuance and public verification | Contract + legitimate interest | Verification page shows only name, programme, institution, cohort, status — nothing more |
| Alumni directory inclusion | **Consent** | Freely withdrawable, separately captured, default off |
| Marketing and newsletters | **Consent** | Separate from alumni directory consent |
| Security logging, fraud prevention | Legitimate interest | Documented balancing test |
| Product analytics | Legitimate interest, pseudonymised | No cross-tenant identification |

### 6.5 Consent management

- Granular, unbundled checkboxes — never one blanket "I agree to everything"
- Each consent record stores: purpose, timestamp, the **version of the privacy notice in force**, the capture mechanism, and the IP/user agent
- Privacy notices are versioned documents in the system, not static HTML edited in place. Changing the notice mints a new version; existing consents remain bound to the version they were given against
- Withdrawal is as easy as granting: a single privacy settings screen, one toggle per purpose, effective immediately, logged
- Withdrawal of alumni directory consent removes the profile from search within minutes, not on a nightly job

### 6.6 Data subject rights and grievances

Rights to support in-product: access, rectification, erasure, restriction, portability, objection, and the right not to be subject to solely automated decision-making.

| Requirement | Spec |
|---|---|
| **Self-service first** | Most requests should never become tickets. A student can download their own data, correct their own profile, and export their academic record without asking anyone |
| **DSR console** | Requests that need human handling enter a queue with a statutory clock. Response window: **30 days**, with the countdown visible and escalating alerts at day 20 and day 27 |
| **Routing by controller** | A request touching institution-controlled data is routed to that institution's registry with our assistance; a request touching platform-controlled data is handled by our DPO. The student sees one interface and does not need to know the difference |
| **Identity verification** | Before fulfilling, verify the requester — but do not demand more identity data than we already hold |
| **SNAG handling** | GAID introduces the **Standard Notice to Address Grievance**: a data subject can serve a standardised grievance notice (Article 40(2) / Schedule 2 form). We must log it, respond substantively — either accepting the violation and stating remedial action, or explaining why no violation occurred — and record the outcome. Unresolved, the subject may escalate to the NDPC or sue. Build a SNAG intake and response template into the DPO console |
| **Investigation readiness** | If the NDPC opens an investigation it issues a notice with a response expectation around 21 days. Evidence (logs, RoPA, consent records, DPIA) must be exportable in days, not reconstructed from scratch |
| **Erasure vs academic record** | Erasure cannot override statutory/academic retention. The product must be able to explain the refusal clearly and record it, not silently ignore the request |

### 6.7 Breach management

- Notify the **NDPC within 72 hours** of becoming aware of a personal data breach (NDPA s.40)
- Where the breach is likely to result in high risk to data subjects, notify **affected individuals without undue delay**, in plain language, with what they should do
- Maintain a **breach register** covering every incident, including those below the notification threshold, with cause, scope, remediation, and the reasoning for notify/do-not-notify
- Product requirements: breach register in the DPO console; a pre-drafted notification template; the ability to query "which data subjects were in scope of this incident" quickly (this is an engineering requirement — if we cannot answer it in hours, the 72-hour clock beats us); an incident severity rubric; documented on-call escalation path
- Notification to a partner institution must be **immediate**, since their own 72-hour clock starts when they become aware
- Run a tabletop breach exercise before launch and annually thereafter

### 6.8 Retention schedule

The single biggest quiet risk in the funnel: **rejected applicants' documents**. They outnumber admitted students and nobody ever remembers to delete them.

| Data class | Retention | Then |
|---|---|---|
| Rejected/abandoned application documents (certificates, transcripts, photo, ID) | **[DECISION]** default 12 months from decision — confirm against institution appeal windows | Hard delete files; retain a minimal anonymised record for statistics |
| Draft applications never submitted | 6 months from last edit | Hard delete |
| Admitted student application documents | Duration of study + institution-defined archive period | Transfer to institution archive or delete |
| Academic records, grades, certificates | Long-term per NUC/institution policy | Retained; this is the legitimate exception to erasure |
| Payment and financial records | Per Nigerian tax/financial record requirements | Retained, access-restricted |
| Authentication and security audit logs | 12 months | Rolling delete |
| Alumni profile | Until consent withdrawn or account closed | Deleted on withdrawal |
| Backups | 30 days | Deletion requests must propagate to backups on expiry — document this; a deletion that lives forever in a backup is not a deletion |

Purge must run as an **automated scheduled job with a report**, not a manual quarterly chore. The DPO console shows what is due for purge and what was purged.

### 6.9 Cross-border transfers

Personal data may leave Nigeria only where the destination provides an adequate level of protection comparable to the NDPA, or another recognised safeguard or derogation applies.

Audit every vendor in the stack against this: hosting, object storage, CDN, transactional email, video hosting, CAPTCHA, analytics, error monitoring, customer support tooling.

**[DECISION]** Recommendation: host primary application data and uploaded documents in-region where a credible provider exists, or in a jurisdiction we can document as adequate — and pick a CAPTCHA and analytics vendor that does not quietly export student data (this is partly why AUTH-05 specifies Turnstile/hCaptcha over reCAPTCHA). Maintain a **transfer register**: vendor, data categories, destination, safeguard relied on, date assessed.

### 6.10 Security measures (the "appropriate technical measures" evidence base)

- Encryption at rest for all PII and uploaded documents; TLS 1.2+ in transit
- Document access exclusively via **short-lived signed URLs** — no public bucket objects, ever. A leaked permanent URL to a folder of transcripts and passport photos is the archetypal Nigerian edtech breach
- Row-level tenant isolation enforced at the database layer, not just in application code
- Least-privilege RBAC; a registry officer sees applicants for their institution and cohort only
- Mandatory 2FA for all staff roles (per AUTH-08)
- Immutable audit log of every staff read/write on student records — who, what, when, why
- Quarterly access review: every staff account re-attested or revoked
- Annual penetration test; dependency scanning in CI
- Secrets in a managed vault, never in the repository
- Documented offboarding: staff or institution exit revokes access same-day

### 6.11 DPIA

A DPIA is required before launch and before any materially new processing. Scope it to cover: large-scale processing of educational data, identity documents and photographs; a multi-tenant architecture where isolation failure is the primary risk; automated eligibility screening if we ever add it; and the alumni community's cross-institution visibility. Re-run it when we add SSO, when we add a tenant with materially different processing, and when the tier classification changes.

### 6.12 Build-facing requirements

| ID | Requirement | Priority |
|---|---|---|
| CMP-01 | Register with the NDPC as a DCPMI in the correct tier; renew or file CAR per the tier's obligation; track the 31 March deadline | Must |
| CMP-02 | Appoint a DPO, publish contact details on the site, register the DPO with the Commission, and guarantee autonomy and resourcing. DPO compiles a **semi-annual data protection report** forming part of the RoPA | Must |
| CMP-03 | Complete and document a DPIA before launch; re-run on material change | Must |
| CMP-04 | Maintain a Record of Processing Activities as a living document, exportable on demand | Must |
| CMP-05 | Versioned, layered privacy notices; consent bound to the version in force | Must |
| CMP-06 | Granular consent capture and a self-service withdrawal screen; full consent audit trail | Must |
| CMP-07 | Data subject rights console with 30-day statutory clock, routing by controller, and self-service export/correction for students | Must |
| CMP-08 | SNAG intake, response template and outcome log in the DPO console | Must |
| CMP-09 | Breach register plus 72-hour notification workflow; ability to scope affected data subjects within hours | Must |
| CMP-10 | Retention schedule implemented as automated purge jobs with reporting; rejected-applicant documents purged on schedule | Must |
| CMP-11 | Cross-border transfer register; every vendor assessed and documented | Must |
| CMP-12 | DPAs executed with every vendor and every institution, with sub-processor change notification | Must |
| CMP-13 | Encryption at rest and in transit; short-lived signed URLs for all document access | Must |
| CMP-14 | Database-layer tenant isolation, least-privilege RBAC, immutable staff access audit log | Must |
| CMP-15 | Privacy by default in the Alumni Community — profiles private unless opted in; per-school channels invisible across institutions | Must |
| CMP-16 | One-click compliance evidence export (RoPA, consent records, DPIA, audit logs, breach register) for DPCO audit and NDPC investigation | Should |
| CMP-17 | Annual staff data protection training with completion tracking; quarterly access re-attestation | Should |
| CMP-18 | Public-facing trust/compliance page: privacy notice, DPO contact, registration status, sub-processor list | Should |

### 6.13 Launch gate

The platform does not go live until: DPIA complete and signed off; DPO appointed and registered; NDPC registration submitted; institutional DPA executed with the pilot university; retention purge jobs tested with real deletion verified; signed-URL document access verified with no public objects; penetration test findings at high severity or above closed; and the breach tabletop exercise run.

---

## 7. Technical Architecture & Stack

**[ASSUMPTION]** This section assumes a small team (2–4 engineers) shipping Phase 1 in roughly eight weeks, and no existing codebase to inherit. If any of that is wrong — particularly if there's an existing stack or the team is PHP-native — see 7.9.

### 7.1 Architecture shape

**A modular monolith, not microservices.** One deployable application with clear internal module boundaries (`admissions`, `payments`, `learning`, `library`, `community`, `compliance`). At five institutions and low thousands of users, microservices buy distributed-systems problems and no benefit. Boundaries are enforced in code so that a service can be extracted later if the library or video workload demands it.

Two things sit outside the main app from day one:
- **A webhook receiver** for Paystack — must respond fast and stay up even during an app deploy
- **A job worker** for purges, document processing, email, and certificate generation

### 7.2 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| **Language** | TypeScript, end to end | One language across app, workers and scripts; largest hiring pool in Lagos after PHP |
| **App framework** | Next.js (App Router) | Server-rendered pages keep the JS bundle small, which matters more on a 3G connection than developer ergonomics do. Middleware handles subdomain→tenant resolution cleanly |
| **UI** | Tailwind CSS + shadcn/ui + Radix primitives | Accessible components out of the box (WCAG 2.1 AA is a stated requirement); fully themeable per tenant via CSS variables |
| **Database** | PostgreSQL | Row-Level Security is the single most important technical requirement in this build (CMP-14). Postgres does tenant isolation at the database layer natively; almost nothing else does |
| **DB access** | Drizzle ORM | Thin, SQL-transparent, does not fight RLS policies or hide what a query actually runs. Prisma is acceptable but obscures the SQL you need to reason about for RLS |
| **Auth** | Auth.js (v5) with a Postgres adapter, or Supabase Auth | Covers email/password, activation links, reset tokens, sessions and TOTP 2FA. Avoid US-billed per-MAU auth SaaS — the unit economics break against Naira tuition |
| **SSO (Phase 2/3)** | BoxyHQ Jackson (self-hosted SAML→OIDC bridge) | Purpose-built for exactly our problem: a handful of institutions each with a different, bespoke IdP. Self-hosted, so no per-connection SaaS fee per university |
| **Payments** | Paystack, integrated directly | No payment abstraction layer. One provider, used properly |
| **Object storage** | Cloudflare R2 (S3-compatible) | **Zero egress fees.** Students downloading PDFs and library documents all month is exactly the pattern that makes S3 bills ugly. Presigned URLs satisfy CMP-13 |
| **Video** | Cloudflare Stream or Bunny Stream | Adaptive bitrate transcoding handled for us; both are cheap and have African PoPs. Do not self-host video |
| **Search** | Postgres full-text (`tsvector`) at v1 → Typesense for the E-Library | Postgres FTS is enough for course content and a few hundred library items. Typesense earns its place once the corpus grows and faceted legal search matters (LIB-02) |
| **Document processing** | Worker running `pdfplumber`/Apache Tika, plus Tesseract OCR | **Nigerian judgments are overwhelmingly scanned PDFs.** Without OCR, "full-text search inside hosted documents" (LIB-01) silently fails on the most valuable content in the library |
| **PDF generation** | Playwright rendering HTML templates | Certificates, admission letters, receipts. HTML templates mean designers can iterate without touching code |
| **Jobs & queues** | pg-boss (Postgres-backed) | Purge jobs, webhook retries, email, OCR, certificate batches. No Redis to run, back up or secure. Graduate to BullMQ + Redis only if throughput demands it |
| **Transactional email** | Resend or Postmark, on a dedicated sending domain | Deliverability is a funnel requirement, not a nicety — an activation email in spam is a lost enrollment. SPF, DKIM and DMARC configured before launch |
| **CAPTCHA** | Cloudflare Turnstile | Per AUTH-05: light on bandwidth, no Google data export to justify under CMP-11 |
| **CDN / WAF / DNS** | Cloudflare | Also gives us rate limiting at the edge and bot protection on the application form |
| **Error monitoring** | Sentry, EU region, with PII scrubbing configured | Scrub before send — student data must not leak into stack traces |
| **Product analytics** | PostHog, self-hosted or EU-hosted | Privacy-respecting and self-hostable, which keeps CMP-11 simple. No Google Analytics |
| **CI/CD** | GitHub Actions | Lint, typecheck, test, dependency scan, migrate, deploy |
| **Testing** | Vitest (unit) + Playwright (E2E) | E2E coverage is mandatory on the two payment paths and the RLS isolation tests |
| **IaC** | Terraform, if self-hosting infrastructure | Skip if fully managed |

### 7.3 Hosting and data residency — the hard constraint

Section 6.9 requires that we know where student data physically lives. This is the awkward part of the stack, and it should be decided deliberately rather than by default.

**There is no major managed-Postgres provider with a Nigerian region.** Notably, **Supabase does not currently offer an African region** — `af-south-1` (Cape Town) is a long-standing open request, and Supabase has said it is not supported for new projects. Verify this at signup, since it may have changed, but plan on the assumption that it hasn't.

Three viable options:

| Option | Shape | Trade-off |
|---|---|---|
| **A — Managed, offshore** | Supabase/Neon in London or Frankfurt; Vercel for the app with the function region set as close as available | Fastest to ship, lowest ops burden. **Requires a documented cross-border transfer basis and a tolerable ~150ms+ baseline latency to Lagos.** Perfectly defensible if papered properly |
| **B — Self-managed, in-continent** | Postgres on AWS `af-south-1` (Cape Town) via RDS; app on ECS/Fargate in the same region | Materially better latency, much stronger residency story, real DevOps cost. Still not Nigeria |
| **C — Nigerian datacentre** | Local provider (Lagos facilities exist via Digital Realty/MainOne, Layer3, Galaxy Backbone) | Strongest compliance and sales story — "your students' data never leaves Nigeria" is a closing line with a registrar. Weakest tooling, highest ops burden, thinnest managed-service ecosystem |

**[DECISION] Recommendation: start on A, architect for B.** Ship Phase 1 on managed infrastructure with the transfer basis documented in the DPIA, but keep the stack provider-portable — plain Postgres, S3-compatible storage, containerisable app — so migrating in-continent is a deployment change, not a rewrite. Revisit before the second institution signs, because the residency question *will* come up in that sales conversation.

Object storage is easier: R2 is S3-compatible, so residency there is a config decision that can move independently of the database.

### 7.4 Multi-tenancy implementation

- **Tenant resolution:** Next.js middleware maps subdomain → `institution_id`, injected into request context. Never read tenant from a query parameter or client-supplied header
- **Isolation:** every tenant-scoped table carries `institution_id NOT NULL` with an RLS policy keyed to a session variable set per request (`SET LOCAL app.institution_id`). The application connects as a role that **cannot bypass RLS**. Migrations and the job worker use a separate elevated role, used deliberately and logged
- **The non-negotiable test:** an automated E2E suite that authenticates as School A staff and attempts to read School B records through every endpoint. It runs in CI on every commit. A tenant leak in a data protection product is the one bug that ends the company
- **Storage isolation:** object keys namespaced `institutions/{id}/applications/{applicant_id}/...`, access exclusively via short-lived presigned URLs
- **Shared tables** (library, national alumni content) are explicitly exempted from RLS and documented as such, so the exemption is a decision rather than an oversight

### 7.5 Payments implementation

- Webhook receiver is a **separate deployable**, verifying the HMAC SHA512 signature before parsing the body
- Every webhook is written to an `inbound_events` table keyed on Paystack's event ID **before** any business logic — idempotency and replay come free, and reconciliation has an audit trail
- Business logic runs in a job, not inline in the HTTP handler, so a slow enrollment side-effect never causes Paystack to see a timeout and retry
- Transaction splits configured per institution at tenant onboarding; the subaccount code is stored against the institution record
- A nightly reconciliation job compares our transaction table against the Paystack API and flags drift for the admin dashboard (PAY-08)
- **Never** confirm enrollment from the browser callback (PAY-03)

### 7.6 Document and media pipeline

Upload → client-side compression (a phone camera photo of a transcript is 6MB and does not need to be) → presigned direct-to-R2 upload, bypassing our server → job enqueued → virus scan (ClamAV) → thumbnail/preview generation → OCR and text extraction for library items → indexed. Originals immutable; every access via time-limited signed URL and logged for CMP-14.

### 7.7 Alternative stack — if the team is Laravel-native

The Nigerian developer market is deep in PHP, and a stack the team can actually maintain beats a fashionable one they can't. Laravel maps onto this product cleanly:

Laravel 11 + Inertia/Vue or Livewire · Postgres (still Postgres — RLS is the requirement, not the ORM) · Laravel Queues on Redis or database driver · Laravel Cashier not applicable, so direct Paystack integration · `stancl/tenancy` or hand-rolled tenant scoping **backed by Postgres RLS, not just Eloquent global scopes** (application-level scoping alone does not satisfy CMP-14) · Scout + Typesense for search · same choices for R2, Cloudflare, email and video.

**[DECISION]** Pick based on who is actually writing the code, and commit. The compliance and isolation requirements are stack-agnostic; the enforcement mechanism must be the database in either case.

### 7.8 Deliberately not using

| Not using | Why |
|---|---|
| Moodle / Canvas / existing LMS | Multi-tenant admissions with split payments and a legal library is the product. The LMS part is the small part. Bending Moodle to this shape costs more than building it |
| Microservices | Wrong scale, wrong team size, wrong stage |
| MongoDB or any non-relational primary store | Loses RLS, loses transactional integrity on payments, loses the relational shape this domain obviously has |
| Per-MAU auth SaaS (Clerk, Auth0) | USD per-user pricing against Naira tuition, plus a third-party identity provider complicates the residency and processor story |
| Google Analytics / reCAPTCHA | Data export we would have to justify under CMP-11, on a product whose credibility rests on not doing that |
| Blockchain credentials at v1 | Out of scope (Section 10). Certificate verification via a signed public URL solves the actual problem today |

### 7.9 Environments

`local` (Docker Compose, seeded with a two-tenant fixture so isolation bugs surface in development) → `staging` (Paystack test keys, anonymised data only, never a copy of production PII) → `production`. Database migrations version-controlled and forward-only. Secrets in a managed vault, never in the repository, rotated on staff offboarding.

---



## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | Page interactive < 3s on a 3G connection; search results < 1s |
| **Mobile** | Mobile-first responsive. A majority of Nigerian students will apply on a phone. Document upload must work well from a phone camera |
| **Bandwidth** | Aggressive image compression, lazy loading, video quality selector including an audio-only option, downloadable PDFs for offline reading |
| **Availability** | 99.5% uptime; scheduled maintenance outside 06:00–23:00 WAT |
| **Scale** | 10,000 concurrent users at peak (application deadlines and exam periods are spiky — plan for 10x baseline) |
| **Storage** | Object storage for documents with lifecycle policies; CDN for video and static assets |
| **Backups** | Daily automated backups, 30-day retention, quarterly restore test |
| **Accessibility** | WCAG 2.1 AA |
| **Email deliverability** | Dedicated sending domain with SPF/DKIM/DMARC — activation and reset emails landing in spam will destroy the funnel |
| **Browser support** | Latest two versions of Chrome, Safari, Firefox, Edge; Opera Mini graceful degradation |

---

## 9. Analytics & Instrumentation

Track at minimum: application funnel by step and drop-off point, payment success/failure by channel, time-to-admission-decision, login method distribution, module completion rates, library search queries returning zero results (this drives curation), support ticket categories.

---

## 10. Out of Scope for v1

- Mobile native apps (responsive web only)
- AI tutoring, chatbots or automated grading
- Blockchain credential minting (note: CopaServe's "Verify. Mint." positioning may make this a Phase 3 shared component)
- Peer-to-peer video, proctored remote exams
- Multi-currency and international student payments
- Programmes other than the PGD in Data Protection & Privacy
- Full accreditation/NUC reporting integration

---

## 11. Phased Roadmap

**Phase 1 — Admissions & Payments (Weeks 1–8)**
Tenant model, application flow, document upload, Paystack checkout with splits, account activation, auth and security, registry review console, admission letters. *Done = one university can take an applicant from discovery to paid enrollment.*

**Phase 2 — Learning (Weeks 9–16)**
Course structure, content delivery, assessments, gradebook, certificates, Tier 2/3 portal integration. *Done = a cohort can complete a semester and be certified.*

**Phase 3 — Knowledge & Community (Weeks 17–24)**
Resource Centre, E-Library with initial curated corpus, alumni community, SSO Tier 1, reconciliation and reporting.

---

## 12. Risks & Open Questions

| # | Risk / Question | Impact | Mitigation / Owner |
|---|---|---|---|
| 1 | University portals cannot support SSO | High | Validate with 3 institutions before Phase 2; Tier 3 fallback ships by default |
| 2 | Copyright exposure from E-Library content | High | Licence provenance recorded per item; open-access and public-record only at launch |
| 3 | ~~Admission-gate vs open-enrollment unresolved~~ **Resolved: admission-gated.** Residual risk is registry review turnaround time becoming the funnel bottleneck | Medium | SLA per institution on review time; automated nudges to registry; status transparency to candidate |
| 4 | Controller/processor allocation — allocation now set (6.3), but the institutional agreement is unsigned | High | Legal review of the DPA template; pilot institution signs before build completes |
| 4b | Rejected-applicant documents accumulate un-purged | High | CMP-10 automated purge with reporting; tested before launch |
| 5 | Emailed plaintext passwords | High | Replace with activation links (AUTH-01) |
| 6 | Institutional sales cycle in Nigerian universities is slow and political | High | Anchor on one flagship institution; use accreditation and NDPC alignment as the wedge |
| 7 | NUC accreditation requirements for online PGD delivery not yet mapped | Medium | Confirm with the pilot institution's registry |
| 8 | Paystack settlement disputes between platform and institutions | Medium | Automated splits + transparent reconciliation dashboard |
| 9 | Library curation is ongoing editorial cost, not a one-off build | Medium | Budget a part-time curator; enable faculty contribution |
| 10 | Product has no name yet | Low | Naming and brand sprint |

---

## 13. Appendix — Core Entities

`Institution` · `Programme` · `Cohort` · `Application` · `Document` · `User` · `Role` · `Enrollment` · `FeeSchedule` · `Transaction` · `Split` · `Module` · `Lesson` · `Assessment` · `Submission` · `Grade` · `Certificate` · `LibraryItem` · `Licence` · `AlumniProfile` · `ConsentRecord` · `DataSubjectRequest` · `AuditLog`

Every student-facing entity carries `institution_id` and is enforced at the row level.

---

## 14. Sources Referenced

- NDPA 2023 GAID 2025, full text (NDPC): https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf
- Paystack Multi-split Payments: https://paystack.com/docs/payments/multi-split-payments/
- Paystack Transaction Split API: https://paystack.com/docs/api/split/

*Secondary commentary consulted for tier bands, CAR deadlines and fees — to be verified against the Schedules by a licensed DPCO before anything in Section 6.2 is treated as final:*

- Synoptic analysis of the GAID 2025 (Lexology): https://www.lexology.com/library/detail.aspx?g=b58668ad-aac0-4149-b8df-565ae6c3ac7c
- Navigating the NDPA-GAID: a guide for businesses (Mondaq): https://www.mondaq.com/nigeria/privacy-protection/1693812/navigating-the-nigeria-data-protection-act-general-application-and-implementation-directive-ndpa-gaid-a-guide-for-businesses
- Key updates from the GAID 2025 (Afriwise): https://www.afriwise.com/blog/key-updates-from-the-nigeria-data-protection-act---general-application-and-implementation-directive-2025
- GAID 2025: what every business needs to know (Manifield Solicitors): https://manifieldsolicitors.com/nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025-what-every-business-needs-to-know-about-nigerias-data-protection-directive/
