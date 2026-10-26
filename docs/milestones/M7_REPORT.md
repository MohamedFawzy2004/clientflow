# ClientFlow Milestone M7 Report

**Milestone:** M7 — Delivery and portal · **Date:** 2026-10-26 · **Branch:** `feat/m7-delivery-portal` (PR #79, stacked on M6 #70 → M5 #62 → M4 #52 → M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker 29.9.2, Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest`.

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Tasks with dependencies and a status board · assignee-only status changes · time entries · encrypted private file storage with type, signature, content and size checks · short-lived user-bound download links · deliverables with versions and explicit publish · client approve / revision / reject · portal projects with explicit per-user sharing · denied-access audit · milestone reordering · completion waits for client approvals |
| **FAILED (found and fixed during M7)** | 1 intermittent product defect (refused uploads could reset the connection), 2 UI defects caught in review, a false-positive secret-scan finding, and 3 test or tooling mistakes, all fixed and re-run (see _Open bugs_)                                                                                                                                                                                                                      |
| **NOT RUN**                            | Real antivirus scanning (no engine chosen) · screen reader, Firefox/Safari, 200% zoom · deployment (hosting not chosen)                                                                                                                                                                                                                                                                                                                      |
| **DEFERRED**                           | S3-compatible storage and upload-intent flow (hosting decision) · client comments FR-X08 · notification center FR-X09 and reminders for reviews (M10) · cost rates and margins (M9) · "done despite blockers" override · drag and drop on the board (the select is the accessible method)                                                                                                                                                    |

**Storage decision made for you (reversible):** the decision request in the M6 report was not answered, so M7 uses encrypted files on a local volume behind a storage port (ADR-043), with a 25 MB per-file and 2 GB per-project default. Moving to Cloudflare R2, S3 or Backblaze later means adding one adapter; the routes and checks stay.

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:**
  - tasks and time: FR-P05, FR-P06, FR-P07, FR-P08, FR-P09, US-11;
  - deliverables: FR-S06, FR-S07, FR-S08, FR-S10, US-13;
  - portal: FR-X01, FR-X02, FR-X04;
  - files: FR-X05, FR-X07, SEC-13, US-20;
  - tests: T-ACL-02, T-FILE-01, T-FILE-02.
- **Progressed, still partial:**
  - FR-P10 (task completion now in history; notifications M10);
  - FR-S09 (due date and overdue flag; reminders M10);
  - FR-X03 (invoices in M9);
  - FR-X06 and SEC-12 (built-in checks; no antivirus engine yet, R25).
- **Deferred:** FR-X08 (client comments), FR-X09 (notification center).

## Implemented files / API routes / migrations

**Migration** `20261026090000_delivery_portal` (additive; `prisma migrate diff` empty afterwards) adds:

- tables `tasks`, `task_dependencies`, `time_entries`, `files`, `deliverables`, `deliverable_versions`, `deliverable_reviews` and `project_portal_shares`;
- composite FKs that keep a dependency's tasks, a time entry's task and a version's file inside one project;
- checks: no self-dependency, 1–1,440 minutes per entry, file size 1 B–100 MB, hex hashes, completion time consistent with DONE, a reason for every non-approval;
- triggers: published versions cannot change or be deleted, decisions are append-only, shares only for CLIENT users of the project's own organization.

**API routes** (new in M7; all need a session, CSRF on writes and project scope):

| Method     | Path                                                                   | Access                                        | Notes                                               |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| GET/POST   | `/projects/:id/tasks`                                                  | `delivery.work` · create: manager/Owner/Admin | Board with assignees; `?assignee=me`                |
| GET/PATCH  | `/tasks/:taskId`                                                       | `delivery.work` · edit: manager/Owner/Admin   | Versioned                                           |
| POST       | `/tasks/:taskId/status`                                                | manager, or the assignee (board columns only) | DONE waits for blockers                             |
| POST       | `/tasks/:taskId/dependencies[/:dependsOnId/remove]`                    | manager/Owner/Admin                           | Same project, no loops                              |
| GET/POST   | `/tasks/:taskId/time` · `/projects/:id/time`                           | `delivery.work`                               | Own entries; the manager sees all                   |
| PATCH/POST | `/time-entries/:entryId` · `/:entryId/delete`                          | the author only                               | Versioned                                           |
| GET/POST   | `/projects/:id/files`                                                  | `delivery.work`                               | Raw streamed upload, `X-File-Name`                  |
| POST       | `/files/:fileId/download-url` · `/files/:fileId/delete`                | `delivery.work` · delete: uploader or manager | Link valid 5 minutes                                |
| GET        | `/files/download/:token`                                               | the user the link was made for                | Re-authorized on use; attachment only               |
| GET/POST   | `/projects/:id/deliverables`                                           | `delivery.work`                               | Starts private                                      |
| GET/PATCH  | `/deliverables/:id`                                                    | `delivery.work`                               | Versioned                                           |
| POST       | `/deliverables/:id/versions`                                           | `delivery.work`                               | Clean, unused file of the project                   |
| POST       | `/deliverables/:id/publish` · `/archive`                               | manager/Owner/Admin                           | Explicit publish; archive waives a pending approval |
| GET/POST   | `/projects/:id/shares[/:userId/revoke]` · `GET /projects/client-orgs`  | manager/Owner/Admin                           | Per client user                                     |
| POST       | `/projects/:id/milestones/:milestoneId/move`                           | manager/Owner/Admin                           | Up or down (closes O24)                             |
| GET        | `/portal/projects[/:id]` · `/portal/deliverables/:id`                  | CLIENT with an active share                   | Published content only                              |
| POST       | `/portal/deliverables/:id/decision` · `/portal/files/:id/download-url` | CLIENT with an active share                   | One decision per version                            |

**Key files:**

- API: `apps/api/src/modules/{tasks,files,deliverables}/*`, `modules/projects/access.ts`, `modules/portal/{projects,scope}.ts`, `packages/contracts/src/delivery.ts`.
- Web: `apps/web/src/features/delivery/*`, `features/projects/ProjectOverview.tsx` (the project page is now tabs), `features/portal/Portal{Projects,Project,Deliverable}Page.tsx`.
- Tests: `apps/api/tests/{tasks,delivery-portal}.test.ts`, `apps/web/tests/delivery.test.tsx`, `e2e/m7.spec.ts`.
- Configuration: `FILE_ENCRYPTION_KEY` (required, 64 hex characters), `FILE_STORAGE_DIR`, `FILE_MAX_BYTES`, `FILE_PROJECT_QUOTA_BYTES`. The image stores files on the `/data/files` volume. CI and the image smoke job generate throwaway keys.

## Screenshot / UI review evidence

All in `docs/milestones/m7-screenshots/`, at 1440 and 360 px. Every one also passed the no-overflow check at 360px and axe (no serious or critical WCAG 2.2 AA issues):

- `board-pm-*`: the board with two high-priority tasks, one marked "Waits for 1", and a status select on each card.
- `files-*`: the member's Files tab with a checked PDF, the allowed types and the limits.
- `deliverable-pm-*`: version 1 published and "with the client"; silence is never approval.
- `portal-project-*` and `portal-deliverable-*`: the client's view, with the decision panel (Approve, Request a revision, Reject) and the download button.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                               | GitHub Actions    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                      | see _CI evidence_ |
| `npm audit` (all and `--omit=dev`)            | **PASS**, 0 vulnerabilities                                                                                                                   | see _CI evidence_ |
| `npm test` (real Postgres)                    | **PASS**, **278 tests** (+29: tasks 11, delivery and portal 17, env 1); role × endpoint matrix **102 endpoints** (+33) × 8 roles + signed out | see _CI evidence_ |
| `npm run test:web`                            | **PASS**, **55 tests** (+5)                                                                                                                   | see _CI evidence_ |
| `npx playwright test` (Edge)                  | **PASS**, **41 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6 + M6 4 + M7 7), also with `CAPTURE_SCREENSHOTS=1`                                    | see _CI evidence_ |
| `npm run build`                               | **PASS**: main JS 302 kB (93 kB gzip); every new screen is its own chunk                                                                      | see _CI evidence_ |
| gitleaks (Docker, latest)                     | **PASS** after the fix below (first run: 2 false positives on placeholder values)                                                             | see _CI evidence_ |

The intermittent upload failure (see _Open bugs_) appeared in 2 of 6 full API runs before the fix, and in none of the 5 full runs after it.

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. **Setup (API):** the owner creates the client "Delta Studio" and invites `nadia@delta.test`, who signs up in a browser. The owner creates "Delta website" for PM Pat Morgan, links it to Delta Studio, adds Mina Adel and starts it. Nadia's portal shows "No projects shared with you yet".
2. **Planning (PM, UI):** Pat adds "Write homepage copy" and "Design homepage" (Mina, high priority, 6 h estimates), and makes the second wait for the first. The card shows "Waits for 1".
3. **Delivery (member, UI):**
   - Mina's dashboard lists her open tasks;
   - moving "Design homepage" to Done is refused ("Finish “Write homepage copy” first");
   - she completes the copy task, starts the design and logs 1 h 30 min with an internal note; the Time tab shows it;
   - uploading `page.html` is refused, while `homepage-v1.pdf` uploads and shows "Checked";
   - she creates the deliverable "Homepage design" and adds version 1; she has no publish button.
4. **Publish and share (PM):** Pat publishes version 1 after a confirmation and shares the project with Nadia.
5. **Client review:**
   - Nadia sees the project and "Waiting for your review"; no task names and no internal note appear;
   - she downloads `homepage-v1.pdf`, and the bytes match;
   - she requests a revision ("Use our brand blue for the buttons.").
6. **Second round:** Mina reads the reason, uploads v2 and adds it; Pat publishes it; Nadia approves it and sees her earlier reason in the history. Pat's list shows "Approved" and the dashboard shows 0 waiting for the client.
7. **Isolation:** Nadia opening an unknown or unshared project gets "not shared with you", and the staff URL sends her back to the portal.

## Authorization and negative testing evidence

- **Tasks (US-11):**
  - the assignee moves only their own task, never to Canceled, and cannot edit fields or create tasks (403, task unchanged);
  - another PM gets 404, sales get 403, and archived projects are read-only (409);
  - assignees must be on the team, and milestones must be in the project (422);
  - mass assignment of `projectId` is refused (422).
- **Dependencies:**
  - self-links → 422; another project's task → 422 (and the DB refuses it);
  - a loop A → B → C → A → 409;
  - two opposite links sent at the same time → `[200, 409]`, one row;
  - Done while waiting → 409 naming the blocker.
- **Time:** future dates, 0 minutes, more than 1,440 minutes and a foreign `userId` → 422. Members see only their own entries; the manager sees every entry and per-person totals. Editing or deleting someone else's entry → 403; a stale version → 409.
- **Uploads (T-FILE-02):** refused, with nothing left in storage and a FAILURE audit for each:
  - type: `.html`, `.svg` and `.exe`;
  - content: a "PDF" that is HTML, a text file with `<ScRiPt>`, a text file with a NUL byte, and the EICAR string;
  - size: an empty file; an oversized one with Content-Length (413); an oversized chunked one without it (413, clean response).

  The stored bytes are ciphertext (no `%PDF` on disk); the download returns the identical bytes with `attachment`, `nosniff`, a sandbox CSP and `no-store`.

- **Links (SEC-13, US-20):** another staff member using the link → 404; a tampered or expired link → 404; signed out → 401. After the user was removed from the project, or after their share was revoked, the old link → 404.
- **T-FILE-01:** PENDING files cannot be downloaded (409) or versioned (422). A QUARANTINED file inside a published version is refused to the client (404).
- **Deliverables:**
  - members cannot publish (403);
  - nothing reaches the portal before an explicit publish and an explicit share;
  - two identical approvals at once → `[200, 200]` with one decision row; a different decision afterwards → 409;
  - deciding on an old version → 409; a revision without a reason → 422;
  - an approved deliverable takes no new version (409);
  - direct SQL updates or deletes of published versions and decisions are refused by triggers;
  - past the review date it is overdue and still waiting (FR-S10);
  - a project with a deliverable still waiting for the client cannot be completed (409) until the deliverable is archived.
- **Portal isolation (T-ACL-02):** for client B, client A's project, deliverable, decision, file link and download are all 404. Unknown and foreign IDs give identical answers, and each attempt adds one `portal.access_denied` DENIED audit event (4 checked). Sharing with another organization's client or with staff → 422, also refused by the DB trigger. Changing a manual project's client organization ends all shares; archived projects leave the portal.
- **Matrix:** 33 new endpoints for every role. For roles without delivery rights, tasks, dependencies, time, files, deliverables, published versions and shares stay unchanged. Members never edit tasks, change dependencies, publish or share. Only the client's own decision is recorded.

## Open bugs and security risks (severity and owner)

**Fixed in M7:**

1. **A refused upload could reset the connection** (product, Medium, intermittent). The API answered a refused upload (too large, wrong type) before reading its body, and stopping the stream early destroyed the request. The client could then get a connection reset instead of the 413/422. It was seen in 2 of 6 full API runs. Fixed: the stream is no longer destroyed, and the rest of a refused body is drained up to 2× the limit (ADR-049). A chunked-upload test was added; 5 of 5 full runs passed after the fix.
2. **The board's success message could name the wrong status** (UI, Low): it read the select's value after the request had finished. Caught in review before any test ran.
3. **Members lost the "only the manager can change it" notice** when the project page became tabs (UI, Low). Caught by reading the M6 E2E expectations; the notice now also says what members can do.
4. **Secret scan false positives:** placeholder values (`replace-with-…`) for the new key in `.env.example` and in a test were flagged. The placeholder is now empty and the test uses a short non-hex value. Both commits were corrected before anything was pushed.
5. **My mistakes in tests and tooling:**
   - a shell command mangled template strings in a new web file (rewritten before commit);
   - a web test expected a disabled button where the dialog validates on submit;
   - the matrix first counted the client's own (allowed) decision as a forbidden change.

**Open:**

| #   | Issue                                                                             | Severity       | Owner / when                     |
| --- | --------------------------------------------------------------------------------- | -------------- | -------------------------------- |
| O1  | Rate limits still in-memory                                                       | High at deploy | Engineering, M11                 |
| O9  | No real email provider                                                            | Medium         | **Project owner decision**       |
| O16 | Approvers may approve their own proposals                                         | Low            | **Project owner to confirm**     |
| O18 | Proposal PDF cannot show Arabic text                                              | Medium         | Engineering                      |
| O19 | Image is 831 MB                                                                   | Low            | M11                              |
| O22 | Override-won deals have no baseline; their projects are manual (R24)              | Medium         | Project owner (process)          |
| O23 | Test-only fault hook lives in `AppDeps` (R23)                                     | Low            | Engineering                      |
| O25 | No antivirus engine: built-in checks only (R25)                                   | High at deploy | **Project owner** with hosting   |
| O26 | `FILE_ENCRYPTION_KEY` must be backed up with the files (R26)                      | High at deploy | Project owner, M11 restore drill |
| O27 | Local storage is single-instance (R27)                                            | Medium         | Hosting decision                 |
| O28 | Client comments (FR-X08) and in-app notifications of decisions (FR-X09) not built | Medium         | M8/M10                           |

O24 (milestone order) is closed.

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
# .env needs FILE_ENCRYPTION_KEY: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional
```

- **By hand:**
  1. As the `pm` dev user, open a project → **Tasks** → add tasks.
  2. As `member`, upload a PDF on **Files**, create a deliverable and add the file as version 1.
  3. As `pm`, publish it and share the project on **Overview → Client portal access**.
  4. As the client, review it in the portal.
- **Antivirus scanning:** NOT RUN. No engine is configured; the EICAR check proves only the refusal path.
- **Screen reader, Firefox/Safari, 200% zoom:** NOT RUN.

## CI evidence

The branch was pushed with all local checks green (above). When this report was written, the 5 CI jobs on PR #79 (lint/typecheck/audit/build, API + web tests on Postgres, E2E on Chromium, image smoke, secret scan) had just started. Pushing this report re-runs them on the same code; the final result is the PR #79 check list.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 28 IDs. ADR-043 to ADR-049 are added. The risk register updates R5 and adds R25–R27. GitHub: issues #71–#78 are closed by PR #79, and epic #7 ticks the 22 fully tested IDs (including FR-P01–P04 and US-10 from M6).

## Next milestone plan / decisions needed

**Recommended M8 — Scope changes** (needs your approval):

1. **Change requests** on a project: requested change, justification, estimate (hours, price, date) and a link to the tasks (FR-S01, FR-S02). Optional internal approval.
2. **Versioned client view:** an immutable version with a content hash, accepted or rejected in the portal with the same rules as proposals (FR-S03, US-12).
3. **Baseline update only on acceptance:** the new scope and budget take effect atomically and idempotently (FR-S04, T-SCOPE-01, T-SCOPE-02).
4. **Billable tasks outside the approved scope** need an accepted change or a documented exception (FR-S05).
5. **Client comments** on deliverables and changes, with author, time and edit history (FR-X08, deferred from M7).

**Decisions needed from you:**

- **Keep local encrypted storage for now?** Or name the object storage (R2, S3 or Backblaze) and the maximum file size.
- **Antivirus scanning:** is a ClamAV container acceptable, or do you prefer the scanning built into the storage provider?
- **Hosting and email provider** (open since M5).
- **Self-approval of proposals (O16).**

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M7:** المشروع بقى فيه شغل حقيقي:
  - **تاسكات** على لوحة: كل تاسك ليها مسؤول وميعاد وأولوية. ممكن تاسك "تستنى" تاسك تانية، والسيستم مش بيقفلها قبل ما اللي قبلها تخلص، ومش بيسمح بحلقة (أ تستنى ب، وب تستنى أ)؛
  - **تسجيل الوقت:** كل واحد بيسجل وقته هو بس، والـ PM بيشوف وقت الكل؛
  - **الملفات:** بتتخزن **مشفّرة**، ومش أي ملف بيتقبل: PDF وصور وملفات أوفيس آه، لكن صفحات HTML وSVG والسكريبتات لأ. والسيستم بيتأكد إن محتوى الملف فعلاً من النوع اللي مكتوب عليه؛
  - **التسليمات للعميل:** التسليم بيبقى سري لحد ما الـ PM ينشره بنفسه. العميل بيوافق أو يطلب تعديل أو يرفض مع سبب، ومرة واحدة بس لكل نسخة. والنسخ القديمة والقرارات مبتتغيرش، حتى من قاعدة البيانات.
- **بوابة العميل:** العميل بقى يشوف المشاريع اللي اتشاركت معاه **بالاسم**. بيشوف الحالة والمراحل والتسليمات المنشورة بس، لا تاسكات ولا وقت ولا ميزانية ولا ملاحظات داخلية. ولو حاول يفتح مشروع مش بتاعه، بيطلعله "مش موجود"، والمحاولة بتتسجل.
- **التحميل:** لينك التحميل بيعيش ٥ دقايق بس، ولنفس الشخص بس. ولو اتشالت صلاحيته، اللينك القديم بيبطل.
- **قرار خدته مكانك (وممكن يتغير بسهولة):** الملفات بتتخزن على السيرفر نفسه مشفّرة، والحد ٢٥ ميجا للملف. لو اخترت R2 أو S3 بعدين، بنغير جزء واحد بس.
- **تنبيه مهم:** مفيش برنامج **أنتي فيروس** لسه. فيه فحص أساسي بس، والملفات بتتحمل دايماً كتحميل، مش بتتفتح في المتصفح. لازم نضيف فحص حقيقي قبل ما نطلع لايف.
- **التستات:** ٢٧٨ تست للـ API و٥٥ للواجهة و٤١ في المتصفح، كلهم عدّوا. واتصلحت مشكلة كانت بتظهر أحياناً لما ملف يترفض.
- **محتاج منك قبل M8 (تغييرات النطاق):**
  1. نكمل بالتخزين المحلي، ولا تختار خدمة تخزين؟
  2. الأنتي فيروس: ClamAV ولا فحص من خدمة التخزين؟
  3. الاستضافة وخدمة الإيميل؛
  4. ينفع الـ manager يوافق على عرض هو كاتبه؟
