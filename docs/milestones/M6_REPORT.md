# ClientFlow Milestone M6 Report

**Milestone:** M6 — Project handoff · **Date:** 2026-10-26 · **Branch:** `feat/m6-project-handoff` (PR #70, stacked on M5 #62 → M4 #52 → M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker 29.9.2, Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest`.

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Atomic, idempotent won-deal → project conversion · accepted proposal version as the scope baseline · budget baseline · milestones from the proposal · handoff checklist · project states with archive · team · manual projects · project scope per role · handoff queue · delivery dashboard · deal ↔ project links · reopen guard |
| **FAILED (found and fixed during M6)** | 3 product defects and 4 test-code mistakes, all fixed and re-run (see _Open bugs_ → "Fixed in M6")                                                                                                                                                                                                                                 |
| **NOT RUN**                            | Screen reader, Firefox/Safari, 200% zoom · deployment (hosting not chosen)                                                                                                                                                                                                                                                         |
| **DEFERRED**                           | Tasks, time logs, files and client portal project sharing (M7) · notifications for handoff (M10) · finance view of projects (M9) · export/retention of archived projects (M10/M11) · milestone reordering                                                                                                                          |

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** FR-Q10, FR-P01, FR-P02, FR-P03, FR-P04, US-10, T-HAND-01, T-HAND-02. T-ACL-05 now also covers the delivery dashboard.
- **Progressed, still partial:**
  - FR-P10 (activity events; notifications in M10);
  - FR-P11 (archive is read-only history; exports and retention later);
  - FR-F08 (delivery dashboard added);
  - US-18 (projects done, invoices in M9);
  - NFR-07 (project conversion race-tested).

## Implemented files / API routes / migrations

**Migration** `20261025200000_projects` (additive, no drops, `prisma migrate diff` empty) adds:

- tables `projects`, `project_members`, `project_milestones`, `handoff_checklist_items` and `idempotency_records`, plus enums for project state, project role and milestone status;
- unique links `projects.deal_id` and `projects.baseline_version_id`;
- checks: non-blank title, budget range, supported currency, start ≤ due, deal and baseline set together, milestone sequence, checklist done-at/done-by consistency, and the idempotency hash format.

**API routes** (new in M6):

| Method     | Path                                                       | Access                                                                   | Notes                                                                |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| POST       | `/deals/:id/convert-to-project` (header `Idempotency-Key`) | `projects.create` (Owner, Admin, PM)                                     | 201 new; 200 replay; 409 duplicate or other key; 422 bad key/manager |
| GET        | `/projects/handoff-queue` · `/projects/staff`              | `projects.create` / `projects.manage`                                    | Won + accepted deals without a project; delivery staff               |
| GET        | `/projects` · `/projects/:id`                              | read.all (Owner, Admin) · read.member (PM, Member) · read.linked (sales) | Archived hidden unless `?state=ARCHIVED`                             |
| POST       | `/projects`                                                | `projects.create`                                                        | Manual project, exact budget                                         |
| PATCH      | `/projects/:id`                                            | `projects.manage` + manager or Owner/Admin                               | Versioned; manager change Owner/Admin only                           |
| POST       | `/projects/:id/state`                                      | same                                                                     | Allowed transitions only                                             |
| POST       | `/projects/:id/members` · `/members/:userId/remove`        | same                                                                     | Delivery roles only; idempotent                                      |
| POST/PATCH | `/projects/:id/milestones[/:milestoneId]`                  | same                                                                     | Versioned                                                            |
| POST       | `/projects/:id/checklist/:itemId`                          | same                                                                     | Records who and when; idempotent                                     |
| GET        | `/dashboard/delivery`                                      | `dashboard.delivery` (Owner, Admin, PM, Member)                          | Scoped counts                                                        |

**Key files:**

- API: `apps/api/src/modules/projects/{service,routes}.ts`, `packages/contracts/src/projects.ts`.
- Web: `apps/web/src/features/projects/*` and `apps/web/src/features/dashboard/DeliveryDashboard.tsx`.
- Tests: `apps/api/tests/projects.test.ts`, `apps/web/tests/projects.test.tsx`, `e2e/m6.spec.ts`.

## Screenshot / UI review evidence

`docs/milestones/m6-screenshots/project-1440.png` and `project-360.png` show the PM's project right after conversion:

- milestones Discovery, Build and Launch, taken from the proposal;
- the baseline "P-0001 version 1, accepted by Omar Said";
- included and not-included items;
- the accepted total EGP 68,400.00 including tax, and the budget EGP 60,000.00 excluding tax;
- the checklist, team and history.

There is no overflow at 360px and no serious axe violations (handoff queue page and project page). The M5 WCAG sweep now also covers `/app/projects` for the owner and a salesperson, at 1440 and 360 px.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                        | GitHub Actions        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                               | **PASS** on `2ca5e13` |
| `npm audit --omit=dev --audit-level=high`     | **PASS**, 0 vulnerabilities                                                                            | **PASS**              |
| `npm test` (real Postgres)                    | **PASS**, **249 tests** (+16 projects); role × endpoint matrix **70 endpoints × 8 roles** + signed out | pending at writing    |
| `npm run test:web`                            | **PASS**, **50 tests** (+4)                                                                            | pending at writing    |
| `npx playwright test` (Edge)                  | **PASS**, **34 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6 + M6 4)                                       | pending at writing    |
| `npm run build`                               | **PASS**: main JS 300 kB (93 kB gzip); project screens load as their own chunks                        | **PASS**              |
| gitleaks 8.24.3                               | **PASS**: no leaks in the M6 commits                                                                   | **PASS**              |

M5 follow-up: the final CI run on PR #62, which was still running when the M5 report was written, finished with **all 5 jobs passing**, including E2E.

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. **Setup through the real API:**
   - a salesperson creates the lead "Leila Kamal" (Harbour Freight) and the deal "Warehouse app";
   - they draft a proposal (20 days × EGP 3,000; milestones Discovery / Build / Launch; excludes hardware) and submit it;
   - the owner approves it, sets up the client portal and invites `omar@harbour.test`;
   - Omar accepts the invitation in a browser; the owner sends the proposal; Omar accepts it in the portal.
2. **Handoff:**
   - PM Pat Morgan signs in; the dashboard shows "Won deals waiting for handoff";
   - **Projects** lists "Warehouse app" in the handoff queue; **Convert** opens with Pat pre-selected as manager; Pat sets a due date and creates the project;
   - the overview shows the milestones, the accepted baseline and the budget.
3. **Starting delivery:** Pat moves the project to Active, marks Discovery done (1/3), ticks the kick-off item (recorded as Pat, with a time) and adds Mina Adel. History shows "moved the project from Planned to Active".
4. **Visibility:**
   - Mina's dashboard shows 1 open project, and the project is read-only for her;
   - the salesperson's deal page says "Handed off to Warehouse app" and links to a read-only project;
   - another salesperson gets "Project not found".

## Authorization and negative testing evidence

- **Idempotency:**
  - a retry with the same key → same project, 200 `replayed`;
  - three simultaneous same-key requests → `[200, 200, 201]` with one project;
  - three simultaneous requests with different keys → `[201, 409, 409]`;
  - the same key with a different body → 409;
  - a missing or invalid key → 422;
  - exactly one idempotency row is written.
- **Atomicity (T-HAND-02):** a fault injected just before commit → 500 with no internal message, and **zero** projects, milestones, checklist items, activity, audit or idempotency rows. A retry with the same key then succeeds.
- **Preconditions:** an open deal → 409; an override-won deal → 409 ("create the project manually"); a salesperson as manager → 422; an unknown deal → 404; Sales, Sales manager, Member and Finance cannot convert (403).
- **Scope:**
  - Owner and Admin see all projects;
  - a member sees a project only after being added, and read-only;
  - a second PM sees nothing they don't manage;
  - the deal's salesperson reads it but cannot change it, the other salesperson gets 404, and Finance gets 403;
  - after the manager is changed, the former PM loses access.
- **Life cycle:** illegal transitions → 409 with a clear message; a stale version → 409; archived projects refuse edits and new milestones (409) but stay readable and listed under the Archived filter.
- **Deal guard:** reopening a handed-off deal → 409, and the deal stays WON.
- **Matrix:** for every role without manage rights, project rows, milestones, checklist and memberships are unchanged.

## Open bugs and security risks (severity and owner)

**Fixed in M6:**

1. **Project creation returned 500** (product, High): nested milestone and checklist creates passed `agencyId`, which Prisma fills from the composite relation (the same pitfall as in M4). Caught by the first API test run.
2. **Convert and New project dialogs lost the pre-selected manager** (product, Medium): the default was set before the staff list had loaded, so the select showed nothing. The default is re-applied after loading. Caught by a web test.
3. **The E2E suite tripped the per-IP rate limits** (test infrastructure, Medium): about 50 sign-ins and more than 1,000 API calls in 15 minutes from one address. Fixed with test-only overrides that production refuses (ADR-042); the limits themselves are unchanged.
4. **My mistakes in tests:**
   - a web fixture used a non-UUID id;
   - three E2E locators also matched hidden labels or dropdown options;
   - one assertion expected a checkbox to flip before the server answered (it flips after, by design).

**Open:**

| #   | Issue                                                                   | Severity       | Owner / when                 |
| --- | ----------------------------------------------------------------------- | -------------- | ---------------------------- |
| O1  | Rate limits still in-memory                                             | High at deploy | Engineering, M11             |
| O9  | No real email provider                                                  | Medium         | **Project owner decision**   |
| O16 | Approvers may approve their own proposals                               | Low            | **Project owner to confirm** |
| O18 | Proposal PDF cannot show Arabic text                                    | Medium         | Engineering                  |
| O19 | Image is 831 MB                                                         | Low            | M11                          |
| O22 | Override-won deals have no baseline; their projects are manual (R24)    | Medium         | Project owner (process)      |
| O23 | Test-only fault hook lives in `AppDeps` (never set by the server) (R23) | Low            | Engineering                  |
| O24 | Milestones cannot be reordered yet; sequence follows creation order     | Low            | M7                           |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional
```

- **By hand:**
  1. Win a deal through the portal (M4 steps).
  2. Sign in as the `pm` dev user.
  3. Open **Projects** → **Convert**.
  4. On the project, change the state, mark a milestone done and tick the checklist.
- **Screen reader, Firefox/Safari, 200% zoom:** NOT RUN.

## CI evidence

On the code commit `2ca5e13` (push run 40334707019), **Lint, typecheck, audit, build** and **Secret scan** had passed while the other jobs were still running when this report was written. Pushing the report re-runs everything on the report commit (same code). The final result is the PR #70 check list.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 14 IDs. ADR-038 to ADR-042 are added, and the risk register gains R23 and R24. GitHub: issues #63–#69 are linked to PR #70, and epic #6 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M7 — Delivery and portal** (needs your approval):

1. **Tasks** on projects: assignee, optional milestone, due date, priority, status and estimate (FR-P05). Tasks can be blocked by other tasks, with cycle prevention (FR-P06). A board with an accessible non-drag fallback (FR-P07). Members change only their own task status, never budgets (FR-P09, US-11).
2. **Time entries:** task, author, date, minutes, billable flag and internal note (FR-P08). Costs are restricted.
3. **Files:** private storage with type and size checks, safe names and short-lived authorized download links (SEC-12, SEC-13, US-20). This needs a storage decision: local disk for the demo, or S3-compatible storage.
4. **Client portal for projects:** deliverables published explicitly to the client organization; the client approves or requests revision with a timestamp and version (FR-S06, US-13, T-ACL-02, including the denied-access log).
5. **Matrix and E2E extended;** cross-organization isolation tested on every portal route and file.

**Decisions needed from you:**

- **File storage** for uploads (local volume for the demo, or S3-compatible storage such as Cloudflare R2, AWS S3 or Backblaze), and the maximum file size.
- **Hosting and email provider** (still open from M5).
- **Self-approval of proposals (O16).**

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M6:** الـ deal اللي العميل وافق على عرضه بقى يتحول لـ **مشروع** بضغطة واحدة. السيستم بيعمل كل ده مرة واحدة: المشروع، والـ milestones من العرض، و checklist للتسليم، والـ history.
- **الأمان في التحويل:**
  - لو النت فصل والمستخدم داس تاني، **مش هيتعمل مشروعين**. السيرفر بيرجّع نفس المشروع؛
  - ولو حصلت مشكلة في النص، مفيش أي حاجة بتتحفظ ناقصة: يا كله يتعمل يا ولا حاجة. واختبرنا ده بإننا عملنا عطل متعمد في النص.
- **نطاق الشغل:** العرض اللي العميل وافق عليه هو **المرجع**، ومايتغيرش. الميزانية بتتحسب من غير الضريبة.
- **مين يشوف إيه:**
  - الـ owner والـ admin بيشوفوا كل المشاريع؛
  - الـ PM بيشوف مشاريعه بس، والـ member المشاريع اللي هو فيها؛
  - الـ salesperson بيشوف مشروع الـ deal بتاعه قراية بس.
- **حالات المشروع:** مخطط، شغال، متوقف، خلص، مؤرشف. المؤرشف بيفضل موجود للتاريخ، بس مابيتعدلش.
- **حماية إضافية:** الـ deal اللي اتحول لمشروع مايتفتحش تاني بالغلط.
- **التستات:** ‏249 للـ API، و50 للواجهة، و34 end-to-end. كلهم ناجحين.
- **صلحنا 3 مشاكل حقيقية:**
  1. إنشاء المشروع كان بيدي error؛
  2. اختيار الـ PM كان بيضيع في الفورم؛
  3. التستات الكتير بقت بتتمنع من حماية "محاولات الدخول الكتير"، فعملنا استثناء للتستات بس، والسيرفر الحقيقي بيرفضه.
- **محتاج منك قبل M7 (المهام والملفات وبوابة العميل للمشاريع):**
  1. الملفات هتتخزن فين، وأقصى حجم للملف قد إيه؛
  2. الاستضافة وخدمة الإيميل؛
  3. ينفع الـ manager يوافق على عرض هو كاتبه؟
