# ClientFlow Milestone M8 Report

**Milestone:** M8 — Scope changes · **Date:** 2026-10-27 · **Branch:** `feat/m8-scope-changes` (stacked on M7 #79 → M6 #70 → M5 #62 → M4 #52 → M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker 29.9.2, Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest`.

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Change requests from the client or the PM · estimates with scope, work items, internal effort, price, tax and new date · Owner/Admin approval of priced changes · sent versions frozen by hash · client accept/reject in the portal · atomic baseline update on acceptance only · task scope rules (original / accepted change / audited exception) · time split by scope · comment threads with edit history |
| **FAILED (found and fixed during M8)** | 3 UI defects (two lost success messages, one cramped layout at 360px) and 4 test mistakes, all fixed and re-run (see _Open bugs_)                                                                                                                                                                                                                                                                             |
| **NOT RUN**                            | Screen reader, Firefox/Safari, 200% zoom · deployment (hosting not chosen) · antivirus (still no engine, R25)                                                                                                                                                                                                                                                                                                 |
| **DEFERRED**                           | In-app notifications for changes and comments (M10; emails are link-only today) · revising a rejected change (a new change request is created instead) · margin and cost views of changes (M9)                                                                                                                                                                                                                |

Storage stays local and encrypted, as you decided.

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** FR-S01, FR-S02, FR-S03, FR-S04, FR-S05, FR-X08, US-12, T-SCOPE-01, T-SCOPE-02.
- **Extended:** T-ACL-02 (changes and comments are now isolated per client, with denied logs) and US-18 (double acceptance gives one decision).

## Implemented files / API routes / migrations

**Migration** `20261026200000_scope_changes` (additive; `prisma migrate diff` empty afterwards) adds:

- tables `change_requests`, `change_versions`, `change_decisions`, `project_comments` and `project_comment_revisions`;
- task columns `scope`, `change_request_id` and `scope_note`;
- checks: prices and totals add up, the hash exists exactly when a version is sent, a reason for rejections and withdrawals, a written reason for exceptions;
- triggers: sent versions are immutable and final once decided; decisions and comment history are append-only; a task can only reference an accepted change of its own project.

**API routes** (new in M8):

| Method         | Path                                                                                                | Access                                               | Notes                                |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| GET            | `/projects/:id/changes` · `/changes/:id`                                                            | anyone who reads the project (incl. linked sales)    | Versions, decisions, effect, tasks   |
| POST           | `/projects/:id/changes`                                                                             | project manager, Owner, Admin                        | CR-n per project                     |
| PUT            | `/changes/:id/draft`                                                                                | same                                                 | Estimate on the draft version        |
| POST           | `/changes/:id/submit` · `/send` · `/withdraw`                                                       | same                                                 | Priced: approval first; send freezes |
| POST           | `/changes/:id/review`                                                                               | `changes.approve` (Owner, Admin)                     | Approve or send back with a reason   |
| GET/POST       | `/projects/:id/comments` · `PATCH /comments/:id` · `/comments/:id/delete` · `/comments/:id/history` | `delivery.work` + project scope; edit/delete: author | Shared thread with the client        |
| GET/POST       | `/portal/projects/:id/changes` · `GET /portal/changes/:id`                                          | CLIENT with an active share                          | Sent versions and own requests only  |
| POST           | `/portal/changes/:id/decision`                                                                      | same                                                 | ACCEPT / REJECT on the hash shown    |
| GET/POST/PATCH | `/portal/comments[...]`                                                                             | same; history: own comments                          | Invisible items → 404 + DENIED       |

Changed: `POST/PATCH /tasks` accept `scope`, `changeRequestId` and `scopeNote`; `GET /projects/:id` returns `scopeHistory`; `GET /projects/:id/time` returns `byScope`; completing a project waits for changes with the client.

**Key files:**

- API: `apps/api/src/modules/{changes,comments}/*`, `packages/contracts/src/changes.ts`.
- Web: `apps/web/src/features/changes/*`, `features/portal/Portal{ChangePage,Changes}.tsx`.
- Tests: `apps/api/tests/changes.test.ts`, `apps/web/tests/changes.test.tsx`, `e2e/m8.spec.ts`, `e2e/support.ts`.

## Screenshot / UI review evidence

All in `docs/milestones/m8-screenshots/` at 1440 and 360 px; each also passed the 360px overflow check and axe (no serious or critical WCAG 2.2 AA issues):

- `change-in-review-*`: the PM's estimate submitted, waiting for internal approval, with no approve or send button for the PM.
- `portal-change-*`: the client's view of CR-1: price, 14% tax, total EGP 13,680.00, "Delivery moves to 30 Apr 2027 (now 31 Mar 2027)", the decision panel and a comment.
- `change-accepted-*`: the accepted change with "Budget EGP 50,000.00 → EGP 62,000.00", the tasks it created and the conversation.
- `board-extra-work-*`: the board with two "Extra: CR-1" tasks.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                           | GitHub Actions    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                  | see _CI evidence_ |
| `npm audit` (all and `--omit=dev`)            | see _CI evidence_ (no dependency changes in M8)                                                                           | see _CI evidence_ |
| `npm test` (real Postgres)                    | **PASS**, **291 tests** (+13 changes and comments); role × endpoint matrix **124 endpoints** (+22) × 8 roles + signed out | see _CI evidence_ |
| `npm run test:web`                            | **PASS**, **59 tests** (+4)                                                                                               | see _CI evidence_ |
| `npx playwright test` (Edge)                  | **PASS**, **47 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6 + M6 4 + M7 7 + M8 6), also with `CAPTURE_SCREENSHOTS=1`         | see _CI evidence_ |
| `npm run build`                               | **PASS**; change screens are their own chunks                                                                             | see _CI evidence_ |

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. **Setup (API):** the owner creates "Nile ordering app" (budget EGP 50,000, due 31 Mar 2027) for PM Pat Morgan, links it to Nile Foods, starts it, and shares it with `salma@nile.test`, who signed up through her invitation.
2. **Request (client, UI):** Salma asks for "Delivery tracking" (customers follow their delivery on a map; why: fewer support calls). Her portal shows it as "Requested by you".
3. **Estimate (PM):** Pat sees "From the client" on the Changes tab. He estimates it:
   - scope: a live order map;
   - two work items;
   - EGP 12,000 excluding tax and 40 hours of internal effort;
   - a new due date of 30 Apr 2027.

   He saves it and submits it for approval. He has no approve or send button.

4. **Approval:** the owner approves it; Pat sends it. The project still shows a due date of 31 Mar 2027 and a budget of EGP 50,000.
5. **Decision (client):**
   - Salma sees the price, tax, total (EGP 13,680.00) and the date change; the effort estimate is not shown;
   - she comments "Can the map show the driver name?";
   - she accepts.
6. **Effect:**
   - the project is now due 30 Apr 2027;
   - the scope baseline lists "CR-1 Delivery tracking" with "EGP 50,000.00 originally, now EGP 62,000.00";
   - the board has two "Extra: CR-1" tasks, and the change shows the budget before and after;
   - Pat replies to the comment.
7. **Rejection:** Pat creates "Later launch" (EGP 0, new date 30 Jun 2027) and sends it without approval. Salma rejects it ("April is important for us."). The project stays due 30 Apr 2027 with the budget at EGP 62,000.

## Authorization and negative testing evidence

- **Approval gate:**
  - a priced change cannot be sent before approval (409);
  - the PM cannot approve (403), and the draft cannot be edited while in review (409);
  - "send back" returns the version to a draft;
  - a change without a price cannot be submitted (409) and is sent directly.
- **Client visibility:** drafts and changes in review are invisible to the client (404), or read as "Estimating" when the client requested them. The internal effort estimate never appears in portal payloads.
- **Acceptance (T-SCOPE-02):**
  - two simultaneous accepts → `[200, 200]` and one decision;
  - the budget goes 6,000,000 → 7,250,000 minor units and the due date moves to 2027-04-30;
  - two linked CHANGE tasks are created, and the before/after values are stored;
  - a different decision afterwards → 409, and nothing moves again;
  - the PM gets one link-only email.
- **Rejection (T-SCOPE-01):** a reason is required (422). Budget, due date, project version and tasks stay unchanged.
- **Immutability:** editing a sent version → 409; direct SQL update or delete → refused by the trigger; a stale hash → 409.
- **Completion:** a project with a change waiting for the client cannot be completed (409).
- **Isolation (T-ACL-02):** client B gets 404 on client A's change list, change, request and decision, and each attempt is a DENIED audit event (4 checked). Revoking a share closes the change view at once.
- **FR-S05:**
  - refused (422): a CHANGE task pointing at an unaccepted change, a CHANGE task without a change, and an exception with a reason that is too short;
  - an exception is created and audited with its scope, and a task linked to an accepted change works;
  - the DB trigger refuses a link to an unaccepted change;
  - time splits as `{ BASELINE: 0, CHANGE: 45, EXCEPTION: 0 }`.
- **Comments:**
  - the client and the PM share a thread; the client's comment emails the PM;
  - only the author edits (the PM gets 403 on the client's comment); an edit keeps the earlier text;
  - delete hides the text, and revisions are append-only (the DB refuses deletes);
  - client B gets 404 on the thread, on posting and on the history, all logged;
  - clients cannot comment on items they cannot see; sales get 403.
- **Matrix:** 22 new endpoints for every role. Roles without manage rights create, estimate, send or withdraw nothing. Only the client's own request and decision are recorded; comments and history are unchanged for roles without delivery access.

## Open bugs and security risks (severity and owner)

**Fixed in M8:**

1. **The estimate form never confirmed a save** (UI, Low). The form remounted after saving (it was keyed by version), and the success callback of an unmounted form is skipped. Caught by the E2E run; the key was removed.
2. **The board sometimes did not confirm a status change** (UI, Low, from M7). The card moves to another column, which is a new component, so the same skipped callback applied; the M7 E2E passed by timing and failed once in the full M8 run. The board now uses the request's promise.
3. **Price, tax and total ran together at 360px** on the client's change page (UI, Low; no sideways scroll, so the overflow check passed). They now stack as rows on phones. Found while reviewing the screenshots.
4. **My mistakes in tests:**
   - a wrong owner name in an assertion;
   - a placeholder text that clashed with a tab label;
   - the matrix counted the client's own (allowed) acceptance as a forbidden project change;
   - money locators assumed a normal space where the formatter uses a non-breaking one.
5. **Tooling:** shell commands mangled template literals twice; I rewrote those lines with the editor before committing. Docker had stopped overnight and was restarted.

**Open:**

| #   | Issue                                                                    | Severity       | Owner / when                     |
| --- | ------------------------------------------------------------------------ | -------------- | -------------------------------- |
| O1  | Rate limits still in-memory                                              | High at deploy | Engineering, M11                 |
| O9  | No real email provider                                                   | Medium         | **Project owner decision**       |
| O16 | Approvers may approve their own proposals and priced changes             | Low            | **Project owner to confirm**     |
| O18 | Proposal PDF cannot show Arabic text                                     | Medium         | Engineering                      |
| O19 | Image is 831 MB                                                          | Low            | M11                              |
| O22 | Override-won deals have no baseline (R24)                                | Medium         | Project owner (process)          |
| O23 | Test-only fault hook in `AppDeps` (R23)                                  | Low            | Engineering                      |
| O25 | No antivirus engine (R25)                                                | High at deploy | **Project owner** with hosting   |
| O26 | `FILE_ENCRYPTION_KEY` backup (R26)                                       | High at deploy | Project owner, M11 restore drill |
| O27 | Local storage is single-instance (R27)                                   | Medium         | Hosting decision                 |
| O28 | In-app notifications for changes, decisions and comments (FR-X09)        | Medium         | M10                              |
| O29 | A rejected change cannot be revised; the PM creates a new change request | Low            | Product decision                 |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional
```

- **By hand:**
  1. In the portal, a client opens a shared project → **Request a change**.
  2. The PM opens **Changes**, estimates it and submits it.
  3. The owner approves it, and the PM sends it.
  4. The client accepts it.
  5. Check the scope baseline and the board.
- **Screen reader, Firefox/Safari, 200% zoom:** NOT RUN.

## CI evidence

Filled in after pushing; the final result is the PR check list.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 9 IDs. ADR-050 to ADR-053 are added, and the risk register adds R28 and R29. GitHub: issues #80–#86 are closed by the PR, and epic #8 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M9 — Invoice tracking** (needs your approval):

1. **Invoices** per project and client:
   - drafts, then issued snapshots that cannot change: customer, line items, currency, due date, reference number (FR-F01, FR-F02);
   - lines taken from milestones and accepted changes.
2. **Payments:** partial payments are recorded as additive transactions with date and reference. Overpayment needs an explicit adjustment, and void keeps history (FR-F03, T-PAY-01). No card or bank processing.
3. **Finance role:** only Finance and the Owner change payment status, and every change is audited (FR-F04, T-PAY-02, US-14).
4. **Money views:**
   - expected, issued and received revenue per project (FR-F05);
   - time cost from internal cost rates (FR-F06);
   - an estimated margin labelled with its data completeness (FR-F07, US-23).
5. **Portal invoices:** clients see their published invoices (FR-X03).

**Decisions needed from you:**

- **Invoice numbering:** one sequence for the agency (INV-0001) or per year (2027-0001)?
- **Who sets staff cost rates** (Owner only, or Owner and Admin), and are they visible to PMs as estimates (spec §1.1 says "PM estimate only")?
- **Still open:** antivirus engine, hosting, email provider, self-approval (O16).

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M8:** طلبات تغيير النطاق.
- **الطلب:** العميل يقدر يطلب تغيير من الـ portal، أو الـ PM يسجله بنفسه.
- **التسعير والموافقة:**
  - الـ PM بيكتب التغيير والسعر من غير الضريبة، والمدة الداخلية، والميعاد الجديد، والمهام اللي هتتعمل؛
  - لو التغيير ليه سعر، لازم الـ Owner أو الـ Admin يوافق عليه قبل ما يوصل للعميل.
- **قرار العميل:**
  - العميل بيشوف السعر والضريبة والإجمالي والميعاد الجديد، لكن مبيشوفش المدة الداخلية؛
  - بيقبل أو يرفض مع سبب، والنسخة اللي اتبعتتله مبتتغيرش أبداً، حتى من قاعدة البيانات.
- **بعد القبول:** الميزانية بتزيد والميعاد بيتحرك والمهام بتتعمل لوحدها مربوطة بالتغيير، وكل ده مرة واحدة. ولو رفض، مفيش أي حاجة بتتغير.
- **أي شغل برّه النطاق** لازم يبقى مربوط بتغيير اتقبل، أو استثناء مكتوب سببه ومتسجل. والوقت بيتقسم بين الشغل الأصلي والشغل الإضافي.
- **التعليقات:** فيه تعليقات بين الفريق والعميل على التسليمات والتغييرات، والتعديلات بتتحفظ في تاريخ ما بيتمسحش.
- **التستات:** ٢٩١ تست للـ API و٥٩ للواجهة، و٦ تستات جديدة في المتصفح عدّت.
- **محتاج منك قبل M9 (الفواتير):**
  1. ترقيم الفواتير: رقم واحد مستمر، ولا يبدأ من جديد كل سنة؟
  2. مين يحدد تكلفة ساعة الموظف، وهل الـ PM يشوفها؟
  3. والقرارات القديمة: الأنتي فيروس، والاستضافة، والإيميل، والموافقة على العرض اللي الشخص كاتبه بنفسه.
