# ClientFlow Milestone M11 Report

**Milestone:** M11 — Production hardening. **Branch:** `feat/m11-hardening`, stacked on M10. **Date:** 2026-10-28.
**Approval:** "Approve M11" (the M11 proposal in the M10 report).

## Status summary

| Status                                | What                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IMPLEMENTED + TESTED**              | Brute-force limits shared in PostgreSQL across instances and restarts (O1) · backup and isolated, verified restore with a recorded drill · migration rehearsal on restored data · job-lag readiness, Owner/Admin system status, process error logging · runtime image 835 → 518 MB · static-file compression · pruning of ended sessions and reset links · API load test |
| **IMPLEMENTED, first CI run pending** | Trivy image scan gate and CodeQL in CI (they run for the first time on this PR)                                                                                                                                                                                                                                                                                          |
| **FAILED (recorded, not fixed)**      | Lighthouse mobile performance for `/app/dashboard`: 82–84, below the 85 target (R38). Locally, the Debian security updates could not be applied (no mirror access from this machine); the build now fails instead of shipping silently, and CI must prove it                                                                                                             |
| **NOT RUN**                           | Restore on a hosted platform (no hosting chosen) · CodeQL and Trivy in CI until the PR runs · screen reader, Firefox/Safari                                                                                                                                                                                                                                              |
| **DEFERRED / owner decisions**        | Backup schedule and RPO/RTO (NFR-08) · retention periods and legal review (SEC-20, SEC-23) · error-tracking vendor · re-encryption tool for a leaked file key                                                                                                                                                                                                            |

There are no "zero vulnerability" claims here. The scanners reduce risk; they do not replace the tests.

## Scope and IDs

- **TESTED:**
  - SEC-22 (drill and runbook);
  - NFR-02 (p95);
  - NFR-14 (migration on restored data);
  - T-OPS-01 (restore reconciles);
  - FR-I02's shared limits (O1 closed).
- **IMPLEMENTING:**
  - SEC-20 and NFR-12: retention rules documented and partly automated;
  - SEC-21: the scanners are in CI and await their first run;
  - SEC-23: legal review outstanding;
  - NFR-03: dashboard mobile below target;
  - NFR-08: schedule and RPO/RTO undecided.
- **Already ticked:** NFR-11 and T-OPS-02.

## Implemented files / routes / migrations

- **Migration** `20261029090000_rate_limits`, additive: `rate_limit_counters`, with a non-negative check.
- **Rate limits:**
  - `middleware/rate-limit-store.ts`: atomic upsert store and pruning;
  - the server passes `sharedRateLimits: true`.
- **Backup and restore:**
  - `cli/backup.ts`, `cli/restore.ts`, `cli/pg-tools.ts` and `cli/backup-manifest.ts`;
  - scripts `npm run backup` and `npm run restore`;
  - `backups/` is gitignored.
- **Monitoring:**
  - `/health/ready` reports job lag;
  - `GET /api/v1/ops/status` (Owner/Admin);
  - Settings → System status card;
  - `unhandledRejection` and `uncaughtException` handlers.
- **Retention:** `lib/retention.ts` (ended sessions and expired reset links after 30 days), run hourly by the worker.
- **Image:**
  - `scripts/prune-runtime.mjs`;
  - npm, npx and corepack removed from the runtime;
  - OS updates at build (`OS_UPDATES`);
  - `.trivyignore` for documented exceptions.
- **CI:** a Trivy step in the image job, and a new `codeql` job (pinned SHA, v4.38.3, `security-extended`).
- **Web performance:**
  - `compression` 1.8.2, for the web app's static files only;
  - the app shells load on demand;
  - the screen's chunks are prefetched in `main.tsx`.
- **Docs:**
  - `docs/18_PRIVACY_RETENTION.md` and `docs/19_RUNBOOK.md`;
  - deployment guide rewritten for backups, monitoring, worker and image security;
  - ADR-062 to ADR-065 and risks R36 to R38.

## Evidence

**Restore drill** (`docs/milestones/m11-restore-drill.txt`), from the E2E database with fictional data:

- **Backup:** 43 tables, 571 rows, 11 migrations and 16 stored objects, in 1.2 s.
- **Restore into `clientflow_restore`:** `RECONCILED` in 2.9 s. Every table count matches, and both referenced files decrypt to their checksums. 14 unreferenced objects (from earlier E2E runs) were reported, not failed.
- **`prisma migrate deploy` on the restored copy:** applied `20261029090000_rate_limits` (NFR-14).
- **Refusals**, each exiting 1 and leaving nothing behind:
  - the live database as target;
  - a non-empty target;
  - the wrong `FILE_ENCRYPTION_KEY`;
  - a dump changed by one byte.

**API load test** (`docs/milestones/m11-perf.json`, `scripts/perf.mjs`):

- **Setup:** Windows 11, i7-13650HX (20 threads), 16 GB, Node 24.19, production build on PostgreSQL in Docker. 10 concurrent clients, 300 requests per scenario, about 2,000 contacts imported through the CSV API.
- **Reads, p95 (target < 500 ms):** contacts list 56 ms, search 56 ms, deal board 97 ms, sales dashboard 136 ms, invoices 44 ms, notifications 36 ms.
- **Write, p95 (target < 800 ms):** create contact 60 ms.
- 0 errors.

**Lighthouse 13.5.0** (`docs/milestones/m11-lighthouse.txt`), 3 runs each, on Edge:

| Page             | Before (mobile) | Mobile    | Desktop |
| ---------------- | --------------- | --------- | ------- |
| `/login`         | 52              | 91–94     | 100     |
| `/app/dashboard` | not measured    | **82–84** | 91–99   |

Accessibility 98–100 and best practices 92–96. The fixes were compression, loading the shells on demand, and fetching chunks in parallel.

**Image** (`docker images`, local):

- **Size:** 835 MB before; 518 MB after pruning; `node_modules` 382 → 137 MB.
- **Smoke test:** `/health/ready` ok, the web page serves (200), and Argon2, pdfkit, csv-parse, pg and the Prisma client load.
- **Trivy (local):** the 14 Node.js HIGH/CRITICAL findings were all inside the bundled npm CLI and are gone after removing it. 11 Debian findings with fixes need the mirror access that CI has.

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                   | GitHub Actions           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| `npm run lint` · `typecheck` · `format:check` | **PASS** (format was fixed for 2 scripts before the final check)                                  | see PR checks            |
| `npm audit` (all and `--omit=dev`)            | **PASS**, 0 vulnerabilities (compression added)                                                   | see PR checks            |
| `npm test` (real Postgres)                    | **PASS**, **337 tests** (+6 hardening); role matrix **155 endpoints** (+1) × 8 roles + signed out | see PR checks            |
| `npm run test:web`                            | **PASS**, **72 tests**                                                                            | see PR checks            |
| `npx playwright test` (Edge)                  | **PASS**, **60 tests**                                                                            | see PR checks            |
| `npm run build`                               | **PASS**                                                                                          | see PR checks            |
| gitleaks (M11 commits)                        | **PASS**, no leaks                                                                                | secret-scan job          |
| Trivy image gate · CodeQL                     | Trivy run locally (see _Evidence_); CodeQL **NOT RUN** locally                                    | **first run on this PR** |

## Authorization and negative testing evidence

- **Status endpoint:** `GET /ops/status` is Owner/Admin only. The matrix checks every role, and signed-out requests get 401. The response contains no connection strings, passwords, ports or secrets (asserted).
- **Readiness:** stays 200 with `degraded` when jobs lag, and is 503 only when the database is down.
- **Rate-limit keys:** hold hashed emails, never addresses (asserted).
- **Restore tool:** refuses the live database, non-empty targets, the wrong key and damaged backups (drill).
- **Compression:** API JSON is never compressed (asserted); static files and the app page are.

## Open bugs and security risks

| #   | Issue                                                                          | Severity       | Owner / when                   |
| --- | ------------------------------------------------------------------------------ | -------------- | ------------------------------ |
| O9  | No real email provider                                                         | Medium         | **Project owner decision**     |
| O16 | Approvers may approve their own proposals and priced changes                   | Low            | Project owner to confirm       |
| O18 | Proposal PDF cannot show Arabic text                                           | Medium         | Engineering                    |
| O25 | No antivirus engine (R25)                                                      | High at deploy | **Project owner** with hosting |
| O32 | No invoice PDF                                                                 | Medium         | Product decision               |
| O34 | Portal users get emails but no notification center                             | Low            | Product decision               |
| O37 | Dashboard Lighthouse mobile 82–84 (R38)                                        | Low            | Engineering                    |
| O38 | No tool to re-encrypt files under a new key (R26)                              | Medium         | Engineering                    |
| O39 | Erasing one person is a manual procedure (docs/18)                             | Medium         | Engineering, when required     |
| O40 | Retention periods, RPO/RTO and legal review undecided (SEC-20, SEC-23, NFR-08) | High at deploy | **Project owner**              |

**Closed:** O1 (rate limits in memory), O19 (image size), O26 (key backup: documented, and the fingerprint check is in the restore).

## Not run / blocked, with steps

- **Hosted restore:** after choosing hosting, run `npm run restore` against a staging database and keep the output.
- **Debian updates in the image:** this machine cannot reach the Debian mirrors. The CI image job builds with them and runs the Trivy gate.
- **Screen reader, Firefox/Safari:** not run.

## Next milestone plan / decisions needed

**Recommended M12 — Commercial/portfolio release** (needs your approval):

1. A demo environment with fictional data and a reset command that cannot run on production (FR-A08).
2. User documentation and a short walkthrough for each role.
3. A final QA pass across the main journeys, including the not-run checks (screen reader, Firefox/Safari, 200% zoom).
4. A portfolio case study.

The dashboard mobile performance (R38) is also in scope if you agree.

**Decisions needed from you:**

- **Hosting and domain:** needed for staging, a hosted restore drill and the antivirus engine.
- **Email provider:** Resend, Postmark or SES.
- **Retention and backups:** the retention periods in `docs/18_PRIVACY_RETENTION.md`, and the backup schedule with RPO/RTO.
- **Legal review:** a lawyer or privacy reviewer before real client data goes in.

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M11 (تجهيز البرنامج للتشغيل الفعلي):**
  - **الحماية من تخمين الباسورد:** بقت محفوظة في قاعدة البيانات، فبتفضل شغالة حتى لو السيرفر اتعمله restart أو اشتغل أكتر من سيرفر.
  - **الباك أب:**
    - أمر بياخد نسخة من قاعدة البيانات والملفات المتشفرة؛
    - وأمر بيرجّعها في قاعدة بيانات منفصلة، ويتأكد إن كل الجداول وكل الملفات رجعت مظبوطة؛
    - جربناه فعلاً والنتيجة RECONCILED؛
    - وبيرفض يرجّع على قاعدة البيانات الشغالة أو بمفتاح غلط.
  - **المتابعة:**
    - صفحة الإعدادات فيها "حالة النظام": سرعة قاعدة البيانات، والشغل اللي في الخلفية لو متأخر؛
    - والأخطاء كلها بتتسجل.
  - **الـ Docker image:**
    - صغرت من 835 لـ 518 ميجا؛
    - وبقى فيه فحص أمني تلقائي في GitHub بيوقف أي ثغرة خطيرة ليها حل.
  - **السرعة:**
    - الـ API بيرد في أقل من 140 مللي ثانية تحت ضغط؛
    - صفحة الدخول بقت 91–94 على الموبايل بدل 52؛
    - الداشبورد على الموبايل 82–84، أقل شوية من الهدف (85)، ومكتوب ده بصراحة.
  - **مستندات جديدة:** مستند الخصوصية ومدة الاحتفاظ بالبيانات، ودليل التعامل مع المشاكل والاختراقات.
- **التستات:** 337 للـ API، و72 للواجهة، و60 E2E، كلهم ناجحين.
- **محتاج منك:**
  - توافق على M12 (نسخة العرض والتوثيق النهائي)؛
  - تختار الاستضافة وشركة الإيميل؛
  - تحدد مدة الاحتفاظ بالبيانات وجدول الباك أب؛
  - تخلي محامي أو متخصص خصوصية يراجع المستند قبل ما تحط بيانات عملاء حقيقيين.
