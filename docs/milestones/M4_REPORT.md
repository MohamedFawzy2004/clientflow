# ClientFlow Milestone M4 Report

**Milestone:** M4 — Proposal workflow · **Date:** 2026-10-25 · **Branch:** `feat/m4-proposals` (PR #52, stacked on M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest` (Node 24, Postgres 17.6 service, Playwright Chromium).

## Decisions taken with the owner before building

1. **Client acceptance runs in a signed-in portal**, not through a one-time link. Spec §1.1 forbids "a bare shared URL as authorization", which my M3 proposal had missed. M4 therefore includes minimal client organizations, CLIENT users and a portal (ADR-027).
2. **Acceptance is shown as operational approval**, not an e-signature (FR-Q11, ADR-029).
3. **Tax:** VAT 14% by default, on tax-exclusive prices, editable per proposal (ADR-028).

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Service catalog · proposals per deal with `P-0001` references · numbered versions, immutable once submitted (API + DB triggers) · exact totals with explained discount and VAT · internal review (submit / approve / request changes) · send to the client portal · client organizations and portal invitations · portal list and proposal view · accept / decline / request changes, atomic and idempotent · accepted proposal wins the deal and converts the lead · print view · role-area guards (`/app` vs `/portal`) |
| **FAILED (found and fixed during M4)** | 2 product defects and 3 test-code mistakes, all fixed and re-run (see _Open bugs_ → "Fixed in M4")                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **NOT RUN**                            | Printed/saved-as-PDF output (print CSS checked by eye in the app, not by an automated test) · screen-reader walkthrough · Firefox/Safari · 200% zoom · real email delivery                                                                                                                                                                                                                                                                                                                                                |
| **DEFERRED**                           | Server-generated PDF file (FR-Q06, M5) · deal-to-project handoff (FR-Q10, M6) · denied-access log for cross-organization portal requests (T-ACL-02, M7) · archive client organization / resend portal invitation screens · per-line tax rates · proposal templates                                                                                                                                                                                                                                                        |

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** FR-Q01, FR-Q02, FR-Q03, FR-Q04, FR-Q05, FR-Q07, FR-Q08, FR-Q09, FR-Q11, US-08, US-09, T-PROP-01, T-PROP-02, T-PROP-03. FR-D05 now also covers the normal path: WON by client acceptance.
- **Progressed, still partial:**
  - FR-Q06 (print view, not a PDF file);
  - FR-X01 (organizations, not projects);
  - FR-F10 and SEC-14 (proposals done, invoices in M9);
  - SEC-15 (deals and proposals done);
  - T-ACL-02 (proposal isolation done, denied-access log not yet).
- **Not started on purpose:** FR-Q10 (M6). M4 records the accepted version on the deal for it.

## Implemented files / API routes / migrations

**Migration** `20261025090000_proposals`. It adds the tables `client_organizations`, `service_catalog`, `proposals`, `proposal_versions`, `proposal_items` and `proposal_reviews`, plus three columns: `client_org_id` on users, contacts and invitations, `agencies.proposal_seq`, and `deals.accepted_proposal_version_id`.

Hand-written SQL:

- **Checks:**
  - CLIENT ⇔ organization, on users and invitations;
  - amount and rate ranges, and supported currencies;
  - `total = subtotal − discount + tax`;
  - no SENT version without `approved_at`;
  - a hash is required once a version leaves draft;
  - client reviews carry a hash.
- **Partial unique indexes:**
  - one version in preparation per proposal;
  - one SENT per proposal;
  - one ACCEPTED per proposal;
  - one client decision per version.
- **Triggers:**
  - immutable non-draft versions;
  - items editable only on drafts;
  - append-only reviews.

`prisma migrate diff` against the schema is empty.

**API routes** (new in M4, under `/api/v1`):

| Method     | Path                                                         | Access                                              | Notes                                                                  |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------- |
| GET / POST | `/services` · PATCH `/services/:id` · POST `/:id/archive`    | `services.read` / `services.manage` (Owner, Admin)  | Versioned edits                                                        |
| GET / POST | `/proposals` · GET `/proposals/:id[/versions/:no]`           | `proposals.read.*` / `proposals.write` + deal scope | Create from an open deal                                               |
| PUT        | `/proposals/:id/draft`                                       | `proposals.write` + scope                           | Whole-draft replace; totals computed on the server; 409 if not a draft |
| POST       | `/proposals/:id/submit` · `/send` · `/revise`                | `proposals.write` + scope                           | Row-locked, versioned                                                  |
| POST       | `/proposals/:id/review`                                      | `proposals.approve` (Owner, Admin, Sales manager)   | APPROVE or REQUEST_CHANGES (comment required)                          |
| POST       | `/contacts/:id/client-org` · GET `/client-orgs/:id`          | `portal.manage` (Owner, Admin, Sales manager)       |                                                                        |
| POST       | `/client-orgs/:id/invitations[/:id/revoke]`                  | `portal.manage`                                     | One-time link shown once and emailed                                   |
| POST       | `/client-orgs/:id/users/:id/deactivate\|reactivate`          | `portal.manage`                                     | Ends the person's sessions                                             |
| GET / POST | `/portal/proposals[/:id]` · `/portal/proposals/:id/decision` | `portal.access` (CLIENT only), own organization     | Decision needs the content hash shown                                  |

**Key files:**

- Contracts: `packages/contracts/src/proposals.ts`.
- API modules: `apps/api/src/modules/{proposals,portal,client-orgs,services}/*`.
- Web: `apps/web/src/features/{proposals,services,portal}/*`, `apps/web/src/features/leads/ClientPortalCard.tsx`, `apps/web/src/components/proposals/proposal-ui.tsx`, `apps/web/src/app/PortalShell.tsx`.
- Tests: `apps/api/tests/{proposals,proposal-math}.test.ts`, `apps/web/tests/proposals.test.tsx`, `e2e/m4.spec.ts`.

## Screenshot / UI review evidence

`docs/milestones/m4-screenshots/` (captured by `npm run e2e:screenshots` against the real API):

- `editor-1440.png` and `editor-360.png`;
- `portal-proposal-1440.png` and `portal-proposal-360.png`;
- `proposal-accepted-1440.png`.

Checks:

- **No horizontal overflow at 360px** is asserted on the editor and the portal proposal. Line items become stacked rows on phones instead of a scrolling table.
- axe reports **no serious/critical** violations on the services page, the editor, the lead page with the portal card, and the portal proposal.
- Reviewing the screenshots found no layout defects. In the full-page 360px editor capture, the sticky save bar and a toast overlap the content: that comes from capturing sticky elements in a full-page screenshot.

In the browser pane on the dev database, I signed in as the sales manager and created a proposal from a seeded deal. The editor opened with VAT 14% and a 30-day expiry, and the catalog offered only EGP services for the EGP deal.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                             | GitHub Actions |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                    | **PASS**       |
| `npm test` (real Postgres)                    | **PASS**, **210 tests** (+37): proposals 27, proposal math 9, role × endpoint matrix now 48 endpoints × 8 roles (CLIENT added) + signed out | **PASS**       |
| `npm run test:web`                            | **PASS**, **41 tests** (+8 proposal and portal tests)                                                                                       | **PASS**       |
| `npx playwright test` (Edge)                  | **PASS**, **24 tests** (M1 7 + M2 5 + M3 5 + M4 7), twice in a row (normal run and screenshot run)                                          | **PASS**       |
| `npm run build`                               | **PASS** (JS 782 kB, 226 kB gzip)                                                                                                           | **PASS**       |
| gitleaks 8.24.3 (Docker)                      | **PASS**: no leaks in the 4 M4 code commits. One earlier run was **NOT RUN** because Docker was stopped; the later run covers that commit   | **PASS**       |

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. **Catalog:** the owner adds the service "Discovery workshop", EGP 12,000 per day.
2. **Draft:** a salesperson creates the lead "Hany Fawzi" (Fawzi Logistics) and the deal "Fleet app", then clicks **Create proposal** (P-0001). The draft has:
   - 2 days of the workshop and 10 hours of "Build" at 850;
   - a 10% discount;
   - an exclusion and an internal note.

   The preview shows **VAT 14% of EGP 29,250.00** and a total of **EGP 33,345.00**. After saving, the server returns the same numbers.

3. **Review:** the salesperson submits. They have no Approve button. The owner approves.
4. **Portal setup:** sending is blocked with "Client portal not set up". The owner sets up the portal from the lead page and invites `hana.fawzi@fawzi.test`; the one-time link is shown once.
5. **Client joins:** in a fresh 360px browser, Hana opens the link. The page reads "E2E Studio client portal … review proposals for Fawzi Logistics". She chooses a password and lands in an empty portal. Opening `/app/deals` sends her back to `/portal`, and `GET /api/v1/proposals` returns **403**.
6. **Send:** the owner sends the version ("Ready to send to 1 portal user at Fawzi Logistics").
7. **Client decides:**
   - Hana sees the scope, the exclusion and the exact total. The internal note is **not** on the page.
   - Accept stays disabled until she ticks "I have read version 1".
   - She accepts and sees "You accepted this version" plus a dated acceptance line.
8. **Result:** the owner sees the deal **won**, with a link to "P-0001 version 1". The lead is now a **Customer**, and the proposal shows "Accepted by the client".
9. **Isolation:** another salesperson gets "Proposal not found" (API **404**), and staff get **403** on the portal API.

## Authorization and negative testing evidence

All by direct API requests against Postgres:

- **Matrix:**
  - 48 endpoints × 8 roles, from a hand-written table; CLIENT is allowed only `/auth/me` and the three portal endpoints.
  - Denied calls leave proposals, versions, services, organizations and portal users unchanged.
  - Signed out, every endpoint returns 401.
- **Scope:** another salesperson gets 404 on the proposal, an empty list, and 422 when creating a proposal on someone else's deal.
- **Portal isolation:**
  - another organization's user gets 404 on view and on decision, and an empty list;
  - a proposal that was approved but never sent is invisible;
  - the portal JSON contains no `internalNotes`, `reviews` or staff names;
  - the sent email links to the portal and contains no amounts or scope.
- **Mass assignment:** a draft body with `totalMinor`, `currency` or `status` gets 422, and nothing changes.
- **Immutability (T-PROP-01):**
  - editing a submitted version returns 409;
  - direct DB writes to its title or items are refused by the triggers, and review rows cannot be deleted;
  - revising creates version 2, and version 1 keeps the same hash, items and amounts.
- **Expiry and supersession (T-PROP-02):** accepting version 1 after version 2 was sent → 409 "newer version". Accepting an expired version → 409, and the deal stays open.
- **Races:**
  - three simultaneous accepts → `[200, 200, 200]`, with exactly one client decision, one deal win and one timeline event (T-PROP-03);
  - accept vs decline at the same time → one 200, one 409;
  - two reviewers at the same time → one 200, one 409;
  - five concurrent creates → P-0001 to P-0005.
- **Approval gate (US-08):**
  - a salesperson approving → 403;
  - sending a draft or a version still in review → 409;
  - the DB refuses `SENT` without `approved_at`.
- **Portal access:** deactivating a portal user makes their next request 401. A salesperson cannot set up a portal (403).

## Open bugs and security risks (severity and owner)

**Fixed in M4:**

1. **Proposal creation returned 500** (product, High): the nested version create passed `agencyId`, which Prisma fills from the composite relation. Caught by the first API test run.
2. **Saving a draft with an empty optional field returned 422** (product, Medium): the optional text schema rejected `null`. Caught by tests.
3. **My mistake in a test:** the expected total had the wrong hand calculation. The correct value is EGP 4,618.55; the code was right.
4. **My mistake in a test:** I expected invitation acceptance to return 200, but it returns 201.
5. **My mistake in a test:** an E2E locator matched three elements (the toast, the list item and hidden button labels). It is now scoped to the list item.

**Open:**

| #   | Issue                                                                                           | Severity                   | Owner / when               |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------- | -------------------------- |
| O1  | Rate limits still in-memory                                                                     | High at deploy             | Engineering, M11           |
| O2  | Dev DB user is superuser (triggers could be dropped by that user)                               | Medium                     | Engineering, M11           |
| O5  | Web bundle 782 kB (226 kB gzip), up from 711 kB; no route splitting yet                         | Medium                     | Engineering, M5            |
| O9  | No real email provider: portal invitations and "proposal sent" emails only reach the dev sink   | Medium (blocks production) | **Project owner decision** |
| O12 | **Closed in M4:** WON now comes from client acceptance; the override remains as an exception    | —                          | —                          |
| O13 | The one-off M1 E2E failure from M3 did not recur (24/24 in both M4 runs)                        | Low                        | Watch CI                   |
| O14 | Drag and drop on the board is still not covered by an automated test                            | Low                        | Engineering, M5            |
| O15 | Printed / saved-as-PDF output is not verified automatically                                     | Low                        | Engineering, M5 (with PDF) |
| O16 | Approvers may approve their own proposals (needed for one-person agencies; recorded in history) | Low                        | Project owner to confirm   |
| O17 | Cross-organization portal requests return 404 but are not written to the audit log as DENIED    | Low                        | Engineering, M7            |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run seed:dev          # adds 5 fictional services and one client organization with a portal user
npm run e2e:screenshots   # optional: refresh docs/milestones/*-screenshots
```

- **Portal by hand (NOT RUN by me in your browser):**
  1. Sign in as the dev sales manager and open the "Online ordering website" deal.
  2. Click **Create proposal**, add a line, save and submit.
  3. Approve as owner or admin, then click **Send to client**.
  4. In a private window, sign in with the `client` entry from `apps/api/.dev-credentials.local.json`.
- **Print:** on an accepted proposal, click **Print** and save as PDF. NOT RUN automatically.
- **Screen reader, Firefox, 200% zoom:** NOT RUN.

## CI evidence

| Job                                     | Result on `3435913` (first M4 PR commit) | Result on `3b69b87` (final code commit) |
| --------------------------------------- | ---------------------------------------- | --------------------------------------- |
| Lint, typecheck, audit, build           | **PASS**                                 | **PASS** (push run 40203689717)         |
| Unit + integration (PostgreSQL)         | **PASS**                                 | **PASS** (210 API + 41 web)             |
| Secret scan (gitleaks 8.24.3)           | **PASS**                                 | **PASS**                                |
| End-to-end (Playwright + axe, Chromium) | **PASS**                                 | **PASS** (24 tests)                     |

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 22 IDs. ADR-027 to ADR-032 are added, and the risk register gains R19 and R20 (R17 lowered). GitHub: the M4 issues #44–#51 are linked to PR #52, and epic #4 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M5 — Sales polished MVP** (needs your approval):

1. **Dashboard:** real KPIs across leads, deals and proposals: pipeline per currency, win rate, proposals awaiting review or client, follow-ups due. Per role, with no counts from hidden records (T-ACL-05).
2. **Server-generated PDF** of a proposal version, stored with its hash (completes FR-Q06; closes O15).
3. **Performance:** route-level code splitting (O5) and list virtualisation where needed.
4. **Polish:** responsive and UX pass on all sales screens, an automated drag-and-drop test (O14), and a WCAG smoke gate.
5. **Demo deployment** to a staging environment with seeded fictional data. This needs a hosting choice and a production email provider (O9).

**Decisions needed from you:**

- **Hosting for the demo/staging environment** (e.g. Render, Railway, Fly.io, or a VPS) and a domain.
- **Email provider** (Resend, Postmark or Amazon SES). It is needed for portal invitations and proposal emails outside development.
- **Self-approval (O16):** may the same manager write and approve a proposal, or should a second person approve once you have more staff?

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M4:** بقى عندك نظام عروض أسعار (proposals) كامل:
  - قايمة خدمات بأسعارها؛
  - تكتب العرض من الـ deal وتحدد إيه اللي داخل وإيه اللي مش داخل؛
  - الحساب بيتعمل بالظبط على السيرفر: خصم، وبعده ضريبة 14%، وكل خطوة مكتوب جنبها اتحسبت إزاي.
- **المراجعة الداخلية:** الـ salesperson بيكتب العرض، وبعدين الـ manager أو الـ owner لازم يوافق قبل ما العميل يشوفه. ولو حد حاول يبعته من غير موافقة، الداتابيز نفسها بترفض.
- **العرض مابيتعدلش بعد ما يتبعت:** أي تعديل بيعمل نسخة جديدة (version 2)، والنسخة القديمة بتفضل زي ما هي بالظبط، حتى لو حد حاول يعدلها من الداتابيز مباشرة.
- **بوابة العميل (client portal):**
  - بتعزم الشخص من عند العميل بإيميله، وهو بيعمل باسورد ويدخل؛
  - مابيشوفش غير العروض اللي اتبعتت لشركته بس، ومابيشوفش الملاحظات الداخلية أبدًا؛
  - بيوافق أو يرفض أو يطلب تعديل.
- **لما العميل يوافق:** الـ deal بيكسب أوتوماتيك، والـ lead بيتحول customer. وبيتسجل مين وافق، وإمتى، وعلى أنهي نسخة بالظبط.
- **صياغة الموافقة:** مكتوب بوضوح إنها "موافقة تشغيلية" مش توقيع إلكتروني رسمي، زي ما اتفقنا.
- **التستات:** ‏210 تست للـ API، منها تستات لو العميل داس "موافق" 3 مرات في نفس اللحظة: بتتسجل موافقة واحدة بس. و41 تست للواجهة، و24 end-to-end. كله ناجح.
- **لقينا مشكلتين حقيقيتين وصلحناهم:** إنشاء العرض كان بيدي error، وحفظ العرض لو فيه خانة فاضية كان بيترفض. وكمان 3 أخطاء كانت في التستات نفسها، وصلحتها.
- **محتاج منك قرارات قبل M5:**
  1. هنعمل نسخة تجريبية أونلاين (demo) فين؟
  2. خدمة الإيميل (Resend أو Postmark أو SES): من غيرها دعوات العملاء مش هتوصل برا جهاز التطوير.
  3. ينفع نفس الـ manager يكتب العرض ويوافق عليه، ولا لازم حد تاني؟
