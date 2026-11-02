# ClientFlow Milestone M10 Report

**Milestone:** M10 — Automation and import/export. **Branch:** `feat/m10-automation`, stacked on M9 (`feat/m9-invoices`). **Date:** 2026-10-28.
**Approval:** "Approved: start M10 (Automation and import/export) as proposed in the M9 report … The M9 defaults for invoice numbering and cost rates are fine."

## Status summary

| Status                                  | What                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**                | In-app notification center with unread count, read state and per-category app/email choices · transactional outbox and worker (claims that never collide, backoff, dead letter, crash recovery, no duplicate emails) · scheduled reminders · CSV import of contacts and deals with preview, mapping, duplicates, idempotent commit and undo · idempotent invoice draft creation (O31) |
| **FAILED (found and fixed during M10)** | 4 API bugs and 2 UI bugs, found by the new tests and fixed (see _Open bugs_)                                                                                                                                                                                                                                                                                                          |
| **NOT RUN**                             | Screen reader, Firefox/Safari, 200% zoom · a real email provider (none chosen, so only the dev sink was exercised) · deployment (hosting not chosen)                                                                                                                                                                                                                                  |
| **DEFERRED**                            | Outbound webhooks (FR-A04, FR-A05, SEC-19, T-SEC-06, ADR-061) · notifications for portal users · import/export consent and retention policy text (FR-A07 partial) · demo reset (FR-A08) · invoice PDF (O32)                                                                                                                                                                           |

ClientFlow still never sends anything to a real address: emails go to the local dev sink (or nowhere) until the owner chooses an email provider.

## Decisions recorded

- **M9 defaults confirmed by the owner:** agency-wide `INV-0001` numbering, and cost rates set by Owner/Admin and read by Finance. ADR-057 is now ACCEPTED.
- **New ADRs:** ADR-058 (outbox and worker), ADR-059 (notifications and channels), ADR-060 (CSV import), ADR-061 (webhooks deferred because they were not in the approved proposal).
- **Defaults I chose, each changeable without a data migration:**
  - every category is in-app by default; email is on only for client activity, which keeps the emails PMs already got in M7/M8;
  - follow-up and task reminders look back 7 days;
  - "waiting on the client" reminders start after 3 days;
  - reminders are scanned every 15 minutes;
  - imports are allowed for Owner, Admin and Sales manager.

## Scope and FR/SEC/NFR IDs

- **TESTED:**
  - FR-C10, FR-X09, FR-P10, FR-S09, FR-A01, FR-A02, FR-A03 (dev sink and preferences);
  - SEC-24, US-18.
- **IMPLEMENTING:** FR-A07. The file is not kept and an import can be undone; the written consent and retention policy is still to come.
- **DEFERRED:** FR-A04, FR-A05, SEC-19, T-SEC-06 (ADR-061).
- **NOT_STARTED:** FR-A08 (demo reset). The dev seed already refuses production.

## Implemented files / API routes / migrations

- **Migration** `20261028090000_automation` (additive):
  - new tables `notifications`, `notification_preferences`, `outbox_jobs` and `import_runs`;
  - `import_run_id` on `contacts` and `deals`;
  - checks: links start with `/app/`, payloads are at most 4 KB, attempt counts are consistent, a RUNNING job has a lock and a DONE or DEAD job has a finish time, and import counts add up.
- **API, background jobs** (`apps/api/src/jobs/`):
  - `outbox.ts`: enqueue with dedupe, claim with `SKIP LOCKED`, backoff, dead letter;
  - `worker.ts`: polling loop, scan scheduling, pruning;
  - `handlers.ts`: link-only emails;
  - `reminders.ts`: the scan;
  - `cli/jobs.ts`: `npm run jobs:once` and `npm run jobs:worker`.
- **API, notifications:** `lib/notify.ts` and `modules/notifications/`.
  - Event sources: changes, comments, portal deliverables and proposals, proposals, tasks.
  - The direct `mailer.send` calls for these events are gone; they go through the outbox.
- **API, imports:** `modules/imports/` (`csv.ts`, `service.ts`, `routes.ts`). The app's 32 KB JSON parser skips `/imports`.
- **API, invoices:** `POST /invoices` now needs an `Idempotency-Key`.
- **Web:**
  - bell, notification center and settings (`features/notifications/`);
  - import page (`features/imports/`);
  - background jobs card in Settings;
  - the New invoice form sends one key per set of values;
  - the old reminder bell was removed (reminders stay on the dashboard and `/app/reminders`).

| Method  | Path                               | Access                      | Notes                                                         |
| ------- | ---------------------------------- | --------------------------- | ------------------------------------------------------------- |
| GET     | `/notifications` · `/unread-count` | Staff (not clients)         | Own only; `unread`, `before` cursor, `limit` ≤ 50             |
| PATCH   | `/notifications/:id/read`          | Staff                       | Someone else's: 404                                           |
| POST    | `/notifications/read-all`          | Staff                       | `upTo`: newer notifications stay unread                       |
| GET/PUT | `/notification-preferences`        | Staff                       | Per category, in-app and email; audited                       |
| GET     | `/jobs` · POST `/jobs/:id/retry`   | Owner, Admin                | Counts, dead jobs (no personal data), retry audited           |
| GET     | `/imports`                         | Owner, Admin, Sales manager | History                                                       |
| POST    | `/imports/preview` · `/imports`    | same                        | Commit needs `Idempotency-Key` and the preview's `fileSha256` |
| POST    | `/imports/:id/undo`                | same                        | Archives unchanged records; audited                           |
| POST    | `/invoices`                        | Owner, Admin, Finance       | Now idempotent: 201, or 200 when replayed (O31)               |

**Configuration:** `JOBS_ENABLED` (default true), `JOBS_POLL_SECONDS` (10) and `REMINDER_SCAN_MINUTES` (15). The worker runs inside the API by default. With `JOBS_ENABLED=false` it can run as its own process.

**New dependency:** `csv-parse` 7.0.3 (MIT, no dependencies, published 2026-09-25).

## Screenshot / UI review evidence

`docs/milestones/m10-screenshots/` holds 10 PNGs at 1440 and 360px from the E2E run. At 360px every screen was checked for no sideways page scroll and no serious or critical axe issue:

1. import preview;
2. import result;
3. notification center;
4. notification settings;
5. background jobs card.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                                                                                                                                                                                                                                                                                                             | GitHub Actions    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                                    | see _CI evidence_ |
| `npm audit`                                   | **PASS**, 0 vulnerabilities (csv-parse added)                                                                                                                                                                                                                                                                                                                                                                               | see _CI evidence_ |
| `npm test` (real Postgres)                    | **PASS**, **331 tests** (+28: notifications 17, imports 10, O31 1); the role × endpoint matrix covers **154 endpoints** (+12) × 8 roles + signed out                                                                                                                                                                                                                                                                        | see _CI evidence_ |
| `npm run test:web`                            | **PASS**, **72 tests** (+8)                                                                                                                                                                                                                                                                                                                                                                                                 | see _CI evidence_ |
| `npx playwright test` (Edge)                  | **PASS**, **60 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6 + M6 4 + M7 7 + M8 6 + M9 7 + M10 6). The first full run with `CAPTURE_SCREENSHOTS=1` had **1 FAILED**: an M1 test timed out waiting for the Add lead dialog while `npm run build` ran at the same time, and the rest of the M1 file was skipped. M1 alone then passed 7/7, and the full suite passed 60/60 on a clean rerun. Recorded as a load flake, not fixed. | see _CI evidence_ |
| `npm run build`                               | **PASS**; the notification and import screens are separate chunks                                                                                                                                                                                                                                                                                                                                                           | see _CI evidence_ |
| gitleaks (M10 commits, `.gitleaks.toml`)      | **PASS**, no leaks                                                                                                                                                                                                                                                                                                                                                                                                          | see _CI evidence_ |

The 303 tests from before M10 all passed after the direct emails were moved to the outbox. Tests that check emails now run the worker first (`drainJobs()`).

## DB-backed user journey demonstrated (E2E, real API + Postgres)

`e2e/m10.spec.ts`, 6 serial tests:

1. **Setup (API):** an active project shared with a client.
2. **Import:** the owner imports a 5-row CSV with an Arabic name.
   - The preview shows a bad email and a duplicate of line 2.
   - 3 contacts are imported; 1 is skipped and 1 has an error.
   - The contacts show in Leads.
   - Undo archives the 3, and the history says "Undone".
3. **Client request:** the client asks for a change through the portal API.
   - The PM's bell shows the unread count.
   - The center lists "… (client) requested CR-1 on Sahel booking site".
   - Opening it goes to the change and marks it read.
4. **Settings:** the PM turns on email for Tasks, saves, and the choice is still there after a reload.
5. **Reminder:** a salesperson's follow-up is an hour overdue.
   - `npm run jobs:once` against the E2E database creates a reminder.
   - A second run creates none.
   - The center shows exactly one "Follow-up overdue".
6. **Health:** the owner sees background job health in Settings.

## Authorization and negative testing evidence

- **Recipients only:**
  - another user's notification is a 404 when read or marked;
  - a malformed ID is a 404;
  - clients get 403 on the center;
  - the matrix checks all 12 new endpoints for every role.
- **Who receives:** never the actor, a deactivated user, a client, or another agency's user (tested on `notify()` directly).
  - A non-app link is refused by the code and by the database (`//evil.test`).
- **Transactions:** a failed request (wrong hash, 409) leaves no notification and no job. A rolled-back transaction takes its notification with it.
- **Emails (SEC-24):**
  - they carry the link and generic text only; the project name, change title, CR number and comment text were each checked absent from subject and body;
  - running the worker again sends nothing more.
- **Jobs:**
  - retry wait 24–37 s after the first failure;
  - dead letter after max attempts, and retry from Settings (Owner and Admin only, audited);
  - two concurrent claims never share a job;
  - a crashed worker's job is taken again after the claim expires;
  - a crash after the provider accepted an email still yields exactly one email;
  - the error text has addresses removed.
- **Reminders:**
  - one per item and due date;
  - three scans at once create one reminder;
  - invoice "overdue" follows Cairo's day: not at 23:30 on the due date, yes at 00:30 the next day, while UTC is still the due date;
  - paid invoices are not reminded about;
  - finance reminders go to Owner, Admin and Finance only.
- **Imports:**
  - Sales, PM, Member and Finance get 403 before the 2 MB body is read; signed-out requests are refused the same way;
  - an unknown body field is a 422;
  - over 1 MB is a 422, over 2 MB is a 413;
  - a changed file is a 409;
  - the same key with other options is a 409;
  - two imports at once create each contact once;
  - formula text is stored as text and neutralized in the deals CSV export;
  - the audit holds counts only, and no copy of the file is stored.
- **Invoices:** two identical Create draft requests at once make one draft. A different body or another user with the same key is a 409. A missing or malformed key is a 422.

## Open bugs and security risks (severity and owner)

**Found and fixed during M10:**

1. An impossible date such as `2026-13-40` was accepted and silently rolled over. Dates are now checked as calendar dates.
2. A bare quote inside a cell, e.g. `=HYPERLINK("…")`, made the whole file unreadable. Quotes are now relaxed.
3. The import commit failed with a 500: Prisma cannot read the `void` result of `pg_advisory_xact_lock`. It now uses `$executeRaw`.
4. Line numbers drifted after a cell spanning several lines. The row's start line is now reported.
5. The notification settings page sent labels the API refuses (422 in real use). It now sends only the choices.
6. "1 contacts imported" now reads "1 contact imported".

| #   | Issue                                                                                              | Severity       | Owner / when                     |
| --- | -------------------------------------------------------------------------------------------------- | -------------- | -------------------------------- |
| O1  | Rate limits still in-memory                                                                        | High at deploy | Engineering, M11                 |
| O9  | No real email provider; delivery is at-least-once if a provider ignores idempotency keys (ADR-058) | Medium         | **Project owner decision**       |
| O16 | Approvers may approve their own proposals and priced changes                                       | Low            | **Project owner to confirm**     |
| O18 | Proposal PDF cannot show Arabic text                                                               | Medium         | Engineering                      |
| O25 | No antivirus engine (R25)                                                                          | High at deploy | **Project owner** with hosting   |
| O26 | `FILE_ENCRYPTION_KEY` backup (R26)                                                                 | High at deploy | Project owner, M11 restore drill |
| O32 | No invoice PDF                                                                                     | Medium         | Product decision                 |
| O34 | Portal users get emails but no notification center                                                 | Low            | Product decision                 |
| O35 | A notification title outlives access to its record (R34)                                           | Low            | Engineering                      |
| O36 | Outbound webhooks not built (ADR-061)                                                              | Low            | When an integration needs them   |

**Closed:** O28 (in-app notifications), O30 (M9 defaults confirmed), O31 (idempotent draft creation).
**New risks:** R33 (notification noise), R34 (stale titles), R35 (a bad import pollutes the CRM).

## Not run / blocked tests and exact steps to reproduce

- **Screen reader, Firefox/Safari, 200% zoom:** not run.
  1. `npm run dev`
  2. Open `/app/notifications`, `/app/notifications/settings` and `/app/imports` with NVDA in Firefox.
  3. Check that "Unread:" is announced and that each column select keeps its field name.
- **Real email provider:** not chosen, so only the dev sink was tested. To try the worker locally:
  1. `npm run jobs:once`
  2. Read the JSON files in `apps/api/.mail-sink`.

## CI evidence

Pushed with the PR; the results are on the PR checks. This report records the local runs only.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv`: 14 IDs updated; see _Scope_ above for their statuses.

## Next milestone plan / decisions needed

**Recommended M11 — Production hardening** (needs your approval):

1. **Rate limiting:** a shared rate-limit store that survives restarts and works across instances (O1).
2. **Backup and restore:** a backup and restore drill that includes the encrypted files and their key (O26).
3. **Monitoring:** health and worker monitoring, structured error reporting, and the database pool and job-queue numbers on the health view.
4. **Smaller image:** a slimmer production image (O19).
5. **Security pass:**
   - a dependency and image scan;
   - session and CSRF review;
   - the written consent and retention policy for imports and exports (FR-A07).

**Decisions needed from you:**

- **Email provider** (Resend, Postmark or SES): the worker is ready for it.
- **Hosting**, which also decides the antivirus engine and file storage.
- **Portal notifications:** should clients get an in-app notification center too, or are emails enough?
- **Still open:** invoice PDF (O32) and self-approval (O16).

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M10:**
  - **الإشعارات:**
    - كل موظف عنده جرس فوق فيه عدد الإشعارات اللي ما اتقرتش، وصفحة إشعارات خاصة بيه بس؛
    - الإشعار بيوصل لما العميل يطلب أو يوافق على تغيير، أو يعلّق، أو يراجع تسليم أو عرض سعر، ولما حد يطلب موافقتك، ولما تتعين لك مهمة؛
    - تقدر تختار لكل نوع إشعار: في البرنامج، أو بالإيميل، أو الاتنين؛
    - الإيميل فيه لينك بس، من غير أسماء أو مبالغ أو رسائل.
  - **التذكيرات:**
    - البرنامج بيشيّك تلقائي كل ربع ساعة: متابعات العملاء اللي اتأخرت، المهام المطلوبة النهارده، عروض الأسعار اللي قربت تخلص، الفواتير اللي عدّى ميعادها، والحاجات اللي مستنية العميل بقالها أكتر من 3 أيام؛
    - كل تذكير بيوصل مرة واحدة بس، وبتوقيت القاهرة.
  - **الإيميلات:** بقت بتتبعت من شغل في الخلفية؛
    - لو الإيميل وقع بيحاول تاني بعد شوية؛
    - لو فشل كذا مرة بيظهر للـ Owner والـ Admin في الإعدادات ويقدروا يعيدوه؛
    - ومفيش إيميل بيتبعت مرتين.
  - **استيراد CSV:**
    - تقدر تستورد عملاء أو صفقات من ملف Excel؛
    - البرنامج بيوريك كل سطر قبل الحفظ: الغلط فين، والمكرر إيه؛
    - العربي شغال؛
    - ولو غلطت تقدر تلغي الاستيراد، والحاجات بتتأرشف مش بتتمسح؛
    - الملف نفسه مش بيتحفظ عندنا.
  - **زرار "Create draft" في الفواتير:** لو اتداس مرتين بيعمل مسودة واحدة بس.
- **التستات:**
  - 331 تست للـ API، و72 للواجهة، و60 تست E2E؛
  - كل الشاشات اتجربت على موبايل 360px.
- **اتأجل:** الـ webhooks، لأنها ما كانتش في الخطة اللي وافقت عليها ومفيش حاجة محتاجاها دلوقتي.
- **محتاج منك:**
  - توافق على M11 (تجهيز البرنامج للتشغيل الفعلي)؛
  - تختار شركة الإيميل (Resend أو Postmark أو SES)؛
  - تقولي العميل محتاج صفحة إشعارات في الـ portal ولا الإيميل كفاية.
