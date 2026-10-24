# ClientFlow Milestone M3 Report

**Milestone:** M3 — Sales CRM · **Date:** 2026-10-24 · **Branch:** `feat/m3-sales-crm` (PR #43, stacked on M2 PR #32 → M1 PR #22)
**Environments:** Windows 11 (Node 24.19.0, Docker Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest` (Node 24, Postgres 17.6 service, Playwright Chromium).

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Contact edit with optimistic `version` · archive/restore (read-only while archived) · LEAD → CUSTOMER conversion (same ID, idempotent) · owner reassignment with history · timeline (note/call/email/meeting) · list filters · default pipeline + stages · deals with exact multi-currency money · stage moves, WON/LOST/reopen, versioned and idempotent · board + list + detail · follow-up queue · dashboard sales KPIs |
| **FAILED (found and fixed during M3)** | 8 defects, all fixed and re-tested (see _Open bugs_ → "Fixed in M3")                                                                                                                                                                                                                                                                                                                                                       |
| **NOT RUN**                            | Screen-reader walkthrough · Firefox/Safari · 200% zoom · drag and drop by pointer in E2E (the keyboard stage menu is tested; drag was checked by hand in M3 development only) · one unexplained E2E failure could not be reproduced (see O13)                                                                                                                                                                              |
| **DEFERRED**                           | Tags (FR-C03) and tag/date filters · deal "service interest" field and deal archive (FR-D01) · consent/opt-out (FR-C09 → M5) · duplicate review/merge workflow (FR-C06, T-CRM-02 → M5) · multiple pipelines and stage editing · WON from an accepted proposal (M4)                                                                                                                                                         |

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** FR-C01, FR-C04, FR-C07, FR-C08, FR-D02, FR-D03, FR-D04, FR-D05 (with the override rule, ADR-024), FR-D06, FR-D07, FR-D08, US-05, US-06, US-07, T-ACL-03, T-CRM-01, T-DEAL-01.
- **Progressed, still partial (notes in the CSV):** FR-C03 (no tags), FR-D01 (no service interest or archive), FR-F10 (deals done; proposals/invoices in M4/M9), FR-C06 and T-CRM-02 (warn without merge only).
- **Moved:** FR-C09 to M5.

## Implemented files / API routes / migrations

**Migrations:**

- `20261024184512_sales_crm`: adds `pipelines`, `pipeline_stages` and `deals`, plus `contacts.converted_at` and `activities.body`/`occurred_at` (backfilled from `created_at`). Hand-written SQL adds:
  - one default pipeline per agency (partial unique index);
  - checks for the amount range (0 to 9×10¹⁴ minor units), supported currencies, close-data consistency (OPEN has none, WON has `closed_at` + `closed_by_id`, LOST has a non-blank reason) and non-blank names;
  - a default "Sales pipeline" (New → Qualified → Discovery call → Proposal → Negotiation) for every existing agency.
- `20261024184612_deal_closed_by_fk`: replaces the composite `closed_by` FK with a simple one (ADR-025). `prisma migrate diff` is empty afterwards.

**API routes** (new in M3, all under `/api/v1`, mutations need CSRF + Origin):

| Method | Path                                                              | Access                                                       | Notes                                                       |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| PATCH  | `/contacts/:id`                                                   | `contacts.write` + record scope                              | `{version, …fields}`; stale → 409; archived → 409           |
| POST   | `/contacts/:id/convert` · `/archive` · `/restore`                 | `contacts.write` + record scope                              | Convert is idempotent; same ID                              |
| POST   | `/contacts/:id/reassign`                                          | `sales.reassign`                                             | New owner must be an active sales-capable member (else 422) |
| POST   | `/contacts/:id/activities`                                        | `contacts.write` + record scope                              | NOTE/CALL/EMAIL/MEETING; ≤ 5 min in the future              |
| GET    | `/deals` · `/deals/board` · `/deals/:id`                          | `deals.read.all` / `deals.read.own`                          | Board totals per currency                                   |
| POST   | `/deals`                                                          | `deals.write`                                                | Amount as a decimal string; strict schema                   |
| PATCH  | `/deals/:id`                                                      | `deals.write` + scope                                        | Currency change needs the amount                            |
| POST   | `/deals/:id/move` · `/close` · `/reopen` · `/reassign`            | `deals.write` / `override_won` / `reopen` / `sales.reassign` | Versioned; close idempotent                                 |
| GET    | `/pipelines/default` · `/follow-ups` · `/sales/assignable-owners` | signed in + read permission                                  | Follow-ups bucketed in the agency timezone                  |

**Key files:** `packages/contracts/src/{base,crm,money}.ts`, `apps/api/src/modules/{deals,pipelines,follow-ups,sales}/*`, `apps/api/src/modules/contacts/{mutations,policy}.ts`, `apps/api/src/lib/{timeline,sales-owner,agency-time}.ts`, `apps/web/src/features/{deals,follow-ups}/*`, `apps/web/src/features/leads/{LeadDetailPage,EditLeadDialog,TimelineComposer,LeadsListPage}.tsx`, `apps/web/src/components/sales/sales-ui.tsx`, `e2e/m3.spec.ts`.

## Screenshot / UI review evidence

`docs/milestones/m3-screenshots/` (captured by `npm run e2e:screenshots` against the real API and `clientflow_e2e`): `board-1440.png`, `board-360.png`, `deal-won-1440.png`, `follow-ups-360.png`.

- Every M3 page in the journey is asserted to have **no horizontal overflow at 360px**.
- axe reports **no serious/critical** violations on the lead detail page, the board, the won deal and follow-ups. axe runs once animations have settled (see fix 2).
- Review of the screenshots found two visual bugs, both fixed: a missing 16px gutter on the 360px board, and a misleading "Due: No next step" (fixes 6 and 7).

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                                            | GitHub Actions (commit `e9ef4bc`) |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                                   | **PASS**                          |
| `npm test` (real Postgres)                    | **PASS**, **173 tests** (+42): money 12, CRM contacts 12, deals 18, role × endpoint matrix now 27 endpoints × 7 roles + signed out; the rest from M1/M2    | **PASS**, 173                     |
| `npm run test:web`                            | **PASS**, **33 tests**                                                                                                                                     | **PASS**, 33                      |
| `npx playwright test` (Edge / Chromium)       | **PASS**, **17 tests** (M1 7 + M2 5 + M3 5); 6 full runs after the fixture fix, 1 failure in 1 of them (O13); the final run after the last UI fixes passed | **PASS**, 17                      |
| `npm run build`                               | **PASS** (JS 711 kB, 210 kB gzip)                                                                                                                          | **PASS**                          |
| gitleaks 8.24.3                               | **PASS**, no leaks in the 4 M3 commits                                                                                                                     | **PASS**                          |

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. Salesperson Sami adds the lead "Karim Nasser" and logs a call whose text contains `<b>urgent</b>`. It shows as literal text.
2. From the lead page Sami opens a deal. `12.345` is rejected ("at most 2 decimals"); `245,000.50` is accepted and shown as **EGP 245,000.50**.
3. On the board Sami moves the deal with the keyboard-accessible stage menu. The "Discovery call" column then shows 1 deal and **EGP 245,000.50**.
4. Sami cannot mark it won: the button is disabled, and a direct `POST /deals/:id/close` returns **403**. The owner marks it won with a reason. The history shows the override and reason, and the lead becomes a **Customer** with continuous history.
5. Sami creates a USD deal with no next step. It appears under "No next step" in Follow-ups. Marking it lost without a reason is refused; with a reason it closes.
6. Sales B opens the won deal's URL and sees "Deal not found". The API returns **404**.

In development, the board totals, a stage move (DB `version` 2, a timeline entry, audit `deal.move`), a won override and auto-conversion were also checked by hand in the browser pane on the dev database.

## Authorization and negative testing evidence

All by direct API requests against Postgres:

- **Role × endpoint matrix:** 27 endpoints × 7 staff roles, with a hand-written expected table, plus signed out (401 everywhere). Denied calls leave records unchanged.
- **Record scope:** Sales B gets 404 on Sales A's contact (GET, PATCH, actions) and deals. Lists and follow-ups never include out-of-scope rows. A deal cannot be attached to a contact the user cannot see (422 on `contactId`, the same as an unknown ID).
- **Mass assignment (T-ACL-03):** contact PATCH rejects `ownerId`, `lifecycle`, `archivedAt`, `agencyId`. Deal PATCH rejects `ownerId`, `status`, `stageId` and `amountMinor`, with a field error for each (422). Stage, status and owner only change through their own versioned actions.
- **Concurrency (T-DEAL-01):** two editors on one version get one 200 and one 409, with no lost update (contacts and deal moves). Concurrent closes ("double click") close once, with one event.
- **DB invariants:** the database itself rejects inconsistent close data (e.g. WON without `closed_by_id`) and out-of-range or unsupported money.
- **Money:** no float path (`0.1 + 0.2` is exactly `0.30`), amounts beyond 2^53 are exact, and totals never cross currencies.

## Open bugs and security risks (severity and owner)

**Fixed in M3 (found by tests, CI or review):**

1. **360px overflow on the board** (UX, Medium). An `sr-only` label inside a board column was absolutely positioned against an ancestor outside the scroller, so it escaped clipping and made the page 634px wide. The scroller is now `relative`. Caught by E2E.
2. **Invalid `<dl>` in lead "Contact details"** (a11y, Medium): the icons and wrappers sat between `<dl>` and `<dt>/<dd>`. The markup is restructured. Caught by axe. Separately, axe briefly flagged an older stacked toast mid-fade; the audit now waits for running animations rather than excluding toasts.
3. **Cross-spec test coupling:** the M2 reset test changed sales B's password and broke M3. It now uses its own fixture user.
4. **Runtime circular import** in shared contracts (`crm.ts` ↔ `index.ts`) left schemas `undefined` (ADR-022).
5. **Schema drift** from the composite `closed_by` FK (ADR-025).
6. **Missing 16px gutter on the 360px board:** scroll-snap ignored the padding. Fixed with `scroll-px-4`.
7. **"Due: No next step"** shown when a next step existed without a date. It now says "Not set".
8. **Root-mounted sales router** returned 401 for unknown routes. Auth moved onto each route, so unknown paths 404 again.

**Open:**

| #   | Issue                                                                                                                                       | Severity                         | Owner / when               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------- |
| O1  | Rate limits still in-memory (single instance only)                                                                                          | High at deploy                   | Engineering, M11           |
| O2  | Dev DB user is superuser (audit trigger could be dropped)                                                                                   | Medium                           | Engineering, M11           |
| O5  | Web bundle 711 kB (210 kB gzip), up from 653 kB; no route splitting yet                                                                     | Low                              | Engineering, M5            |
| O9  | No real email provider; password reset cannot reach production users                                                                        | Medium (blocks production reset) | **Project owner decision** |
| O12 | WON is a manager override until proposals exist (ADR-024)                                                                                   | Medium                           | Engineering, M4            |
| O13 | One E2E failure in M1 "sales A adds a lead" in 1 of 6 local runs; its error text was not captured and it did not recur in 5 reruns or in CI | Low                              | Engineering; watch CI      |
| O14 | Drag and drop on the board is not covered by an automated test (the keyboard stage menu, which calls the same API, is)                      | Low                              | Engineering, M5            |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run seed:dev          # optional: fictional leads and six deals in your dev DB
npm run e2e:screenshots   # optional: refresh docs/milestones/*-screenshots
```

- **Sales flow by hand:** sign in as a salesperson from `apps/api/.dev-credentials.local.json` → Leads → open a lead → New deal → Deals board → drag a card, or use its stage menu → sign in as the owner → Mark won with a reason.
- **Screen reader, Firefox, 200% zoom:** NOT RUN.

## CI evidence

| Job                                     | Result on `e9ef4bc` (push run 40127417000 and PR run 40127455510) |
| --------------------------------------- | ----------------------------------------------------------------- |
| Lint, typecheck, audit, build           | **PASS**                                                          |
| Unit + integration (PostgreSQL)         | **PASS** (173 API + 33 web)                                       |
| Secret scan (gitleaks 8.24.3)           | **PASS**                                                          |
| End-to-end (Playwright + axe, Chromium) | **PASS** (17 tests)                                               |

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 23 IDs (see the CSV notes for what remains per ID). ADR-022 to ADR-026 are added, and the risk register gains R17 and R18 (R7 lowered). GitHub: M3 issues #33–#42 are linked to PR #43, and epic #3 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M4 — Proposal workflow** (needs your approval):

1. Proposals per deal with **immutable versions**: line items in minor units, per-line and total tax/discount rules, currency fixed per proposal (FR-Q01–Q05, FR-F10).
2. Draft → internal review → send → client view → accept/decline, with expiry. A sent version is frozen, and edits create a new version.
3. Client acceptance through a **one-time, scoped link** (hashed token, same pattern as invitations). It records who, when, which version and the IP. Accepting marks the deal WON through the normal path, and the manager override stays as the exception (closes O12).
4. A printable/PDF view of a version (server-rendered, no active content).
5. Role × endpoint matrix and E2E extended to proposals; tests that a sent version is immutable and that concurrent accepts produce one result.

**Decisions needed from you:**

- **Is client acceptance contractually binding** in your market, or "operational approval" only (spec FR-Q11)? This changes the wording and what we record.
- **Tax defaults:** is Egyptian VAT 14% the default on proposals, and are prices entered tax-inclusive or tax-exclusive?
- **Email provider** (still open from M2): needed before proposals can be emailed to clients. Until then, the send step shows a link to copy.

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M3:** بقى عندك CRM مبيعات كامل:
  - تعدّل الـ lead، أو تأرشفه وترجّعه، أو تحوّله لـ customer، أو تنقله لـ salesperson تاني.
  - تسجّل عليه notes ومكالمات وإيميلات واجتماعات، وكل ده بيظهر في timeline بترتيب الوقت.
- **الـ Deals:** فيه board بمراحل (New → Qualified → Discovery call → Proposal → Negotiation):
  - تنقل الـ deal بالسحب، أو من قائمة جوه الكارت، وده مهم للي بيستخدم الكيبورد.
  - الفلوس بتتحسب بالظبط من غير أي تقريب، وكل عملة ليها مجموعها لوحدها. عمرنا ما بنجمع جنيه على دولار.
- **الأمان:**
  - لو اتنين عدّلوا نفس الـ deal في نفس اللحظة، واحد بس بينجح والتاني بيتقاله إن فيه تعديل أحدث، فمحدش بيمسح شغل التاني.
  - الـ salesperson مايشوفش deals زميله أصلًا.
- **قرار مؤقت مهم:** لحد ما يبقى فيه proposals (في M4)، الـ deal مايتعلمش "Won" غير من manager أو admin أو owner، ولازم يكتب السبب، والسبب بيفضل ظاهر في الـ history. ولما الـ deal يكسب، الـ lead بيتحول customer لوحده.
- **التستات:** ‏173 تست للـ API و33 للواجهة و17 end-to-end، وكلهم ناجحين على جهازي وعلى GitHub CI.
- **لقينا 8 مشاكل وصلحناها**، أهمها إن صفحة الـ board على الموبايل (360px) كانت بتتسحب بالعرض بسبب عنصر مخفي للـ screen readers.
- **فيه تست واحد وقع مرة واحدة من 6 مرات** وماقدرتش أكرره تاني، فكتبته كمشكلة مفتوحة ومش هخبيه.
- **محتاج منك قرارات قبل M4:**
  1. موافقة العميل على الـ proposal: ملزمة قانونيًا ولا مجرد موافقة تشغيلية؟
  2. الضريبة: الـ 14% افتراضي؟ والأسعار بتتكتب شاملة الضريبة ولا من غيرها؟
  3. لسه محتاجين نختار خدمة الإيميل (Resend أو Postmark أو SES).
