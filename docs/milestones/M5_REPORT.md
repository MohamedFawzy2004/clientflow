# ClientFlow Milestone M5 Report

**Milestone:** M5 — Sales polished MVP · **Date:** 2026-10-25 · **Branch:** `feat/m5-sales-mvp` (PR #62, stacked on M4 #52 → M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker Desktop 29.9.2, Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest`.

## Scope note

I built the five points proposed in the M4 report, plus the items the GitHub M5 epic and spec §18 assign to M5:

- dashboard filters (FR-F08, US-15);
- reminders (FR-A01);
- CSV export with injection protection (US-22);
- agency settings (FR-I09).

The spec's M5 gate, "security and WCAG smoke", now has automated tests. **Demo deployment** is prepared but **not done**, because the hosting and email providers are still your decision.

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IMPLEMENTED + TESTED**               | Scoped sales dashboard with date and owner filters · reminders (card, page, header bell) · deals CSV export · agency settings · server-generated proposal PDF (staff + portal) · route-level code splitting · same-origin web serving · production Docker image + migrate target · CI image smoke job · security smoke gate · WCAG/360px sweep · board drag-and-drop E2E       |
| **FAILED (found and fixed during M5)** | 3 product defects and 3 test-code mistakes, all fixed and re-run (see _Open bugs_ → "Fixed in M5")                                                                                                                                                                                                                                                                             |
| **NOT RUN**                            | Deployment to any hosting (not chosen) · real HTTPS/HSTS behind a proxy · human screen-reader walkthrough · Firefox/Safari · 200% zoom · Lighthouse score (NFR-03) · installing OpenSSL in the migrate image (Debian mirrors unreachable from this machine)                                                                                                                    |
| **DEFERRED**                           | Agency logo (needs file storage, M7) · project/status dashboard filters (M6/M9) · task reminders (M7) · email/push notifications (M10) · Unicode/Arabic PDF font (R21) · image pruning (R22, M11) · items the traceability CSV had parked at M5 but not in this plan: tags, consent, duplicate review, deal "service interest" and archive (moved to the backlog, unscheduled) |

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** US-15, US-22, T-ACL-05 (every aggregate that exists today), FR-Q06 (with the Latin-font limitation), SEC-09.
- **Progressed, still partial:**
  - FR-I09 (no logo);
  - FR-F08 (date and owner filters; project and status filters wait for projects and invoices);
  - FR-A01 (no task reminders);
  - NFR-04 (automated axe sweep; no human screen-reader walkthrough);
  - NFR-07 (race tests across deals, proposals and invitations);
  - T-UX-01.

## Implemented files / API routes / migrations

**Migration** `20261025160000_agency_settings` adds `contact_email`, `phone`, `address`, `working_days` and `version` to `agencies`. Checks cover the version, a normalized email, working days 0–6 (at least one), and the supported default currency. `prisma migrate diff` is empty.

**API routes** (new in M5):

| Method      | Path                                 | Access                                                               | Notes                                           |
| ----------- | ------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| GET         | `/dashboard/sales?from&to&ownerId`   | `dashboard.sales` (sales side); `dashboard.team` for others' numbers | SALES asking for another owner → 403            |
| GET         | `/reminders`                         | `dashboard.sales`                                                    | Personal list, capped at 50 with the full count |
| GET         | `/exports/deals.csv?from&to&ownerId` | `reports.export` (Owner, Admin, Sales manager)                       | Attachment, no-store, audited                   |
| GET / PATCH | `/agency`                            | `agency.manage` (Owner, Admin)                                       | Versioned                                       |
| GET         | `/proposals/:id/versions/:no/pdf`    | proposal read scope                                                  | Drafts → 409                                    |
| GET         | `/portal/proposals/:id/pdf`          | `portal.access`, own organization                                    | The version the client sees                     |

**Key files:**

- API: `apps/api/src/modules/{insights,agency}/*`, `apps/api/src/modules/proposals/pdf.ts`, `apps/api/src/app.ts` (`webApp`), `apps/api/src/middleware/security.ts` (web CSP).
- Web: `apps/web/src/features/dashboard/{SalesDashboard,ReminderBell,RemindersPage,api}.tsx`, `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/app/router.tsx` (lazy routes).
- Deployment: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml` (job `image`), `docs/17_DEPLOYMENT.md`.
- Tests: `apps/api/tests/{insights,security-smoke}.test.ts`, `apps/web/tests/dashboard.test.tsx`, `e2e/m5.spec.ts`.

## Screenshot / UI review evidence

`docs/milestones/m5-screenshots/dashboard-1440.png` and `dashboard-360.png` show the owner filtered to one salesperson, with per-currency totals, the reminder bell and the "Needs your attention" list.

The sweep in `e2e/m5.spec.ts` visits every main screen at **1440 and 360 px**:

- for the owner: dashboard, reminders, follow-ups, leads, deals, proposals, services, team and settings;
- for a salesperson: dashboard, reminders, leads, deals, proposals and services.

**No serious or critical axe violations and no horizontal overflow** on any of them. The portal screens are covered by the M4 spec. Reviewing the screenshots found no layout defects.

**Production build in a browser:** the login page served by the container rendered under the strict CSP with **no CSP violations**. The only console entry was the expected 401 from the signed-out session check.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                              | GitHub Actions (`bacc5e7`)           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                     | **PASS**                             |
| `npm audit --omit=dev --audit-level=high`     | **PASS**, 0 vulnerabilities (after adding pdfkit)                                                                            | **PASS**                             |
| `npm test` (real Postgres)                    | **PASS**, **233 tests** (+23): insights 14, security smoke 9; role × endpoint matrix now 55 endpoints × 8 roles + signed out | **PASS**                             |
| `npm run test:web`                            | **PASS**, **46 tests** (+5 dashboard and bell)                                                                               | **PASS**                             |
| `npx playwright test` (Edge)                  | **PASS**, **30 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6)                                                                    | pending at writing (see CI evidence) |
| `npm run build`                               | **PASS**: main JS 299 kB (93 kB gzip), was 790 kB (228 kB gzip)                                                              | **PASS**                             |
| `docker build` (runtime + migrate)            | **PASS**: runtime image 831 MB                                                                                               | **PASS** (job `image`)               |
| Container smoke run (see below)               | **PASS**                                                                                                                     | **PASS** (job `image`)               |
| gitleaks 8.24.3                               | **PASS**: no leaks in the 4 M5 code commits                                                                                  | **PASS**                             |

**Container smoke run, local:**

1. A fresh `clientflow_smoke` database.
2. The `migrate` image applied all 6 migrations; a second run reported "No pending migrations".
3. The runtime image started in production mode (https origin, random CSRF secret, mail disabled), and `/health/ready` returned `{"status":"ok","checks":{"database":"ok"}}`.
4. Owner bootstrap ran inside the container.
5. HTTP checks:
   - `/app/dashboard` → 200 with `script-src 'self'` and `no-cache`;
   - hashed asset → `max-age=31536000, immutable`;
   - `/api/v1/nope` → JSON 404;
   - login from a foreign origin → **403**;
   - login from the allowed origin → **200**, with an `OWNER` session in a `__Host-cf_session` cookie.
6. The container and database were removed afterwards.

## DB-backed user journeys demonstrated (E2E, real API + Postgres)

1. **Drag and drop:** a salesperson drags a card from "New" onto "Proposal". The toast "Moved to Proposal" appears and the card shows in that column. This closes the M3 gap O14.
2. **Salesperson view:**
   - the dashboard reads "your records", with no owner filter and no export link;
   - an overdue lead appears under "Needs your attention", and the header bell shows a count;
   - on a submitted proposal, **PDF** downloads `P-000N-v1.pdf`, a real PDF file.
3. **Manager view:**
   - the dashboard reads "whole agency", and the pending review shows under "Needs your attention";
   - choosing an owner updates the URL and every number;
   - the CSV export downloads with a BOM and the expected header, and includes the salesperson's deal.
4. **Owner settings:** the owner changes the phone and adds Saturday as a working day; both persist after a reload. An invalid time zone shows "Use a time zone name such as Africa/Cairo."

## Authorization and negative testing evidence

- **Dashboard scope (T-ACL-05):**
  - with deals for two salespeople in EGP and USD, managers see agency totals per currency (EGP 8,000 + USD 50 open, EGP 9,300 won, 67% win rate);
  - salesperson A sees only their own numbers (50% win rate), and asking for salesperson B's numbers → **403**;
  - proposal counts per salesperson exclude the other's;
  - PM, Member and Finance → 403;
  - an invalid owner, a reversed date range and unknown query keys → 422;
  - numbers change after the database changes (US-15).
- **Reminders:** salesperson A sees only their own overdue lead and deal, salesperson B sees none, and the manager sees the proposal waiting for review.
- **CSV (US-22):**
  - `=HYPERLINK(…)`, `+`, `-`, `@`, tab and CR become text (apostrophe prefix);
  - a deal titled `=cmd|"/c calc"!A1` is exported neutralized;
  - amounts are exact (`12500.50`), the owner filter applies, salespeople get 403, and one audit event is written.
- **Settings:**
  - only owners and admins can read or change them (403 for others);
  - a stale version → 409;
  - an invalid time zone, an empty working-day list or an unsupported currency → 422 with field errors;
  - the email is trimmed and lower-cased;
  - the session shows the new currency on the next request.
- **PDF:**
  - content checks: reference, exclusions, `EGP 4,618.54`, `VAT 14% of EGP 4,051.35`, dated acceptance in Cairo time, terms hash;
  - drafts → 409;
  - the other salesperson, or another organization's portal user → 404;
  - staff on the portal PDF → 403.
- **Security smoke:**
  - strict API headers, no `X-Powered-By`, and HSTS only in production;
  - HttpOnly + SameSite cookies, Secure in production;
  - no CORS headers for foreign origins; foreign-origin and no-origin writes are refused, and no row is written;
  - oversized (413) and malformed (400) bodies return the typed envelope with no stack trace;
  - startup refuses `http://` origins, the dev mail sink and short secrets in production.
- **Web serving:** the SPA page has the same-origin CSP without inline scripts, assets are cached immutably, a missing asset → 404, the API and health paths keep JSON 404s, and path traversal returns no files from outside the build.

## Open bugs and security risks (severity and owner)

**Fixed in M5:**

1. **Agency contact email with surrounding spaces was rejected** (product, Low): it was validated before being trimmed. It is now trimmed and lower-cased first. Caught by tests.
2. **A missing static asset returned 500** (product, Medium): the static handler's 404 reached the generic error handler. Missing assets now return a plain 404. Caught by the security smoke test.
3. **The production image ran migrations instead of the app** (build, High): `migrate` was the Dockerfile's last stage, so a plain `docker build` produced it. `runtime` is now the final, default stage. Caught by the local container smoke run.
4. **My mistakes in tests:**
   - I expected 11:30 for an acceptance that is 12:30 in Cairo summer time (UTC+3 until 29 October);
   - two E2E locators matched hidden "Move …" labels and a deal link;
   - the M1 test looked for the old "Your leads" card, which the new dashboard replaced on purpose.
5. **Lint:** the file writer turned `﻿`, ` ` and ` ` escapes into invisible characters. I replaced them with escape sequences.

**Open:**

| #   | Issue                                                                                                          | Severity       | Owner / when                    |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------- |
| O1  | Rate limits still in-memory: run one instance                                                                  | High at deploy | Engineering, M11                |
| O2  | Use a non-superuser database role in any hosted environment                                                    | Medium         | Engineering, at deployment      |
| O5  | **Closed in M5:** main bundle 299 kB (was 790 kB); 240 kB of shared code still loads with the first app screen | —              | —                               |
| O9  | No real email provider: hosted invitations only work by copying the link                                       | Medium         | **Project owner decision**      |
| O14 | **Closed in M5:** drag-and-drop E2E                                                                            | —              | —                               |
| O15 | **Partly closed:** the server PDF is tested; printed browser output is still not checked automatically         | Low            | Engineering                     |
| O16 | Approvers may approve their own proposals                                                                      | Low            | **Project owner to confirm**    |
| O18 | PDF shows non-Latin text (Arabic) as "?" (R21)                                                                 | Medium         | Engineering, next PDF iteration |
| O19 | Image is 831 MB; npm installs the whole workspace tree (R22)                                                   | Low            | Engineering, M11                |
| O20 | `prisma migrate` warns about OpenSSL in the slim image (migrations still apply); the fix was not testable here | Low            | Engineering, at deployment      |
| O21 | Reminders are computed on request; no email/push notifications yet                                             | Low            | M10                             |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional: refresh docs/milestones/*-screenshots
docker build -t clientflow .
docker build -t clientflow-migrate --target migrate .
# then follow docs/17_DEPLOYMENT.md ("First release") against a throwaway database
```

- **Deployment:** BLOCKED on your choice of hosting and email provider.
- **Lighthouse (NFR-03), screen reader, Firefox/Safari, 200% zoom:** NOT RUN.

## CI evidence

On `bacc5e7` (push run 40209265837): **Lint, typecheck, audit, build**, **Unit + integration (PostgreSQL)**, **Secret scan** and the new **Production image (build + smoke run)** all **PASS**. **End-to-end** was still running when this report was committed. Pushing the report cancels that run, and CI re-runs every job on the report commit (same code). The final result is the PR #62 check list, not this table.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 11 IDs. ADR-033 to ADR-037 are added, and the risk register gains R21 and R22. GitHub: issues #53–#61 are linked to PR #62, and epic #5 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M6 — Project handoff** (needs your approval):

1. **Project from a won deal:** "Convert to project" on a deal won by an accepted proposal. The accepted version becomes the project's scope baseline (FR-Q10, FR-P02). The conversion is atomic and idempotent (`Idempotency-Key`, a unique deal → project link, and a retry returns the same project; spec J3).
2. **Project fields:** manager, members, client organization, start and due dates, budget baseline from the proposal totals, and a handoff checklist.
3. **Milestones** seeded from the proposal's milestones text, editable by the PM.
4. **Project membership scope:** PM and members see only their projects (`P` in spec §1.1). The matrix and the race tests are extended.
5. **Dashboard:** a project count for PMs, plus project filters (FR-F08 remainder).

**Decisions needed from you:**

- **Hosting** for the demo or staging environment (Render, Railway, Fly.io or a VPS) and a domain. Everything else for deployment is ready.
- **Email provider** (Resend, Postmark or Amazon SES).
- **Self-approval (O16):** may a manager approve a proposal they wrote?

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M5:** جزء المبيعات بقى جاهز إنك تجربه مع عملاء حقيقيين (pilot):
  - **Dashboard:** فيه الـ pipeline والمكسوب ونسبة المكسب والعروض اللي مستنية، لفترة تختارها؛
  - الـ manager يقدر يفلتر بأي salesperson ويصدّر الـ deals لملف Excel (CSV)؛
  - الـ salesperson مابيشوفش غير أرقامه هو بس، ولو حاول يشوف أرقام زميله السيرفر بيرفض.
- **التذكيرات:** فيه جرس فوق فيه عدد الحاجات المتأخرة: متابعات فات معادها، وعروض مستنية موافقتك، وعروض قربت تخلص.
- **ملف PDF للعرض:** بيطلع من السيرفر وفيه رقم العرض والأسعار وتاريخ موافقة العميل. **عيب معروف:** لو فيه كلام عربي في الـ PDF بيطلع "?"، لكن الطباعة من المتصفح بتطلعه صح. ده هيتصلح بعدين.
- **إعدادات الوكالة:** الاسم والتليفون والعملة والمنطقة الزمنية وأيام الشغل (الافتراضي من الأحد للخميس).
- **السرعة:** أول تحميل للموقع بقى أخف بـ 60% تقريبًا.
- **جاهزين للنشر:** عملنا Docker image بيشغّل السيستم كله، وجربناه على جهازي بقاعدة بيانات جديدة ونجح. وكمان GitHub بيجربه أوتوماتيك مع كل تعديل. **بس لسه مانشرناش على أي سيرفر**، لأن ده محتاج قرارك.
- **الأمان وسهولة الاستخدام:** فيه تستات أوتوماتيك بتلف على كل الشاشات، على الموبايل وعلى الشاشة الكبيرة، وبتتأكد إن مفيش مشاكل accessibility ومفيش حاجة طالعة برا الشاشة. وتستات تانية بتتأكد من إعدادات الأمان.
- **التستات:** ‏233 للـ API، و46 للواجهة، و30 end-to-end. كلهم ناجحين.
- **محتاج منك:**
  1. نشر النسخة التجريبية هيبقى فين (Render أو Railway أو Fly.io أو VPS) وعلى أنهي دومين؛
  2. خدمة الإيميل؛
  3. ينفع نفس الـ manager يكتب العرض ويوافق عليه؟
