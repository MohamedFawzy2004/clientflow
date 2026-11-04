# QA release report — `main` at e404894 (2026-11-03 / 2026-11-04)

Status: **COMPLETE for the automated scope.** `main` did not move between the two days (checked
with `git fetch` and `git log origin/main` on 2026-11-04). Still NOT RUN: a human screen-reader
pass (NFR-04), the full API and web suites again after the new tests, `docker build`, and a
failed-deploy rollback. A test that did not run is never counted as passed here.

Environment: Windows 11, i7-13650HX (20 logical CPUs), 16 GB, Node 24.19.0, npm 11.17.0,
PostgreSQL 17.6 in Docker (port 5433), Playwright 1.64.1, Edge. Worktree `D:\Projects\CRM-qa`,
branch `qa/release-quality`. Databases were this session's own: `clientflow_qa_test`,
`clientflow_qa_e2e`, `clientflow_qa_demo`, and `clientflow_qa_restore` for the drill. CPU load before the runs was about 20 %; no other
session's suite was running.

## 1. Quality gates actually run

| Command                                               | Result                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                        | pass (15 s)                                                                                                                                                                                                       |
| `npm run typecheck`                                   | pass (20 s)                                                                                                                                                                                                       |
| `npm run format:check`                                | pass (10 s)                                                                                                                                                                                                       |
| `npm run test:web`                                    | 13 files, **81 passed** (37 s)                                                                                                                                                                                    |
| `npm test` (API, real PostgreSQL)                     | 28 files, **395 passed, 1 skipped** (7 m 10 s)                                                                                                                                                                    |
| skipped test: `clamav.test.ts` "real ClamAV"          | **ran** with `CLAMAV_TEST_HOST=127.0.0.1` and `clamav/clamav:1.5.4`: 7 of 7 passed                                                                                                                                |
| `npm run e2e` (Edge, includes the new QA spec)        | **74 passed, 2 failed** (16 m). Every one of the 64 existing tests passed. Both failures were in the new spec and were wrong assertions on my side (see §3); after the fix the QA spec passed 14 of 14 on its own |
| `npm run build`                                       | pass (64 s)                                                                                                                                                                                                       |
| `npm audit --omit=dev --audit-level=high`             | 0 vulnerabilities                                                                                                                                                                                                 |
| gitleaks `v8.24.3`, `git` mode, `origin/main` history | 109 commits, no leaks. Note: the config was read from the `D:\Projects\CRM` checkout (branch `feat/m12-1-staging`), whose allowlist is shorter and so stricter than `main`'s                                      |
| New/changed tests after the last edit                 | `invoices.test.ts` 15/15, `mfa.test.ts` 23/23, `route-inventory.test.ts` 3/3, `api-client.test.tsx` 11/11. Lint and prettier clean                                                                                |

Cross-browser runs (2026-11-04, same worktree and databases, `main` still e404894, no other
session running a suite):

| Command                           | Result                                      |
| --------------------------------- | ------------------------------------------- |
| `E2E_BROWSER=firefox npm run e2e` | **77 passed**, 0 failed, 0 skipped (17.2 m) |
| `E2E_BROWSER=webkit npm run e2e`  | **77 passed**, 0 failed, 0 skipped (9.2 m)  |

All three engines list the same 77 tests (`--list`). The Edge row above shows 76 because the
expired-session reload test was split out after that run; it passed in the later 14/14 Edge run of
the QA spec. The WebKit keyboard test (§2) ran and passed. In Firefox the Vite dev server forwarded
one React development-build error, "Should not already be working", logged during the M9 invoice
tests; no test failed and it did not appear in Edge or WebKit (finding Q5).

NOT RUN: the full API and web suites again after the new tests were added, `docker build`.

## 2. Test inventory and coverage map

`docs/REQUIREMENTS_TRACEABILITY.csv`: 199 rows. TESTED 138, IMPLEMENTING 38, NOT_STARTED 19,
DEFERRED 4. Every test file the CSV names exists.

| Kind            | Rows | TESTED | API refs | Web refs | E2E refs         |
| --------------- | ---- | ------ | -------- | -------- | ---------------- |
| FR              | 89   | 73     | 81       | 23       | 56               |
| US              | 24   | 21     | 21       | 5        | 18               |
| SEC             | 25   | 11     | 21       | 1        | 1                |
| NFR             | 15   | 5      | 4        | 1        | 2                |
| T- (test cases) | 36   | 28     | 28       | 3        | 9                |
| AI-SEC          | 10   | 0      | 0        | 0        | 0 (AI not built) |

Layers: about 396 API integration tests on real PostgreSQL (`apps/api/tests`, including the
169-endpoint × 9-role `permission-matrix.test.ts` and the signed-out 401 sweep), 81 web
component tests (`apps/web/tests`), 64 E2E tests in `e2e/` (axe WCAG 2.2 AA on every main
screen through `support.ts`), 8 demo-tour tests in 3 engines, a load script
(`scripts/perf.mjs`) and a Lighthouse script (`scripts/lighthouse.mjs`).

Skips investigated:

- `clamav.test.ts` "real ClamAV": skipped unless `CLAMAV_TEST_HOST` is set. Ran it: 7/7.
- `m1.spec.ts` and `demo/tour.spec.ts` keyboard test, WebKit only. A probe showed Playwright
  WebKit on Windows does not move focus to links with Tab **or** Alt+Tab, so the reason is a
  real engine setting. The whole test used to be skipped. It now runs in WebKit too: the skip
  link is focused directly, and the Enter-to-content and dialog focus steps run as in the other
  engines. It ran and passed in WebKit on 2026-11-04, in the E2E suite and in the demo tour.

Gaps found (before this session's additions):

- No test that every registered route is in the permission matrix (audit F13 found 7 by hand).
- `POST /auth/mfa/recovery-codes` had no success-path test; the three two-step management routes
  were outside the matrix and outside the signed-out 401 sweep.
- No tests for the web API client (`lib/api.ts`): timeouts, non-JSON 5xx, CSRF retry, 401 handling.
- No browser test for an expired session mid-use, Back after sign-out, a failing or slow list,
  an offline save, or a double-clicked save.
- Responsive checks at all seven widths existed only for leads; other screens were checked at
  360 and 1440.
- Payments: no test for paying a draft, zero/negative/3-decimal/garbage amounts, an impossible or
  future date, unknown fields or methods, or another agency's invoice.
- NFR-06 (500 contacts, 300 deals, 100 projects) is NOT_STARTED; NFR-09 NOT_STARTED; NFR-04 human
  screen-reader pass NOT RUN.

## 3. Automated regression improvements (this branch)

| File                                         | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/tests/route-inventory.test.ts`     | Reads `app.ts` and every router (loops and helpers included) and fails if a route is neither in the permission matrix nor in a short documented list of public/token/own-account routes. It found the three MFA routes below.                                                                                                                                                                                                                                                                             |
| `apps/api/tests/mfa.test.ts` (QA block)      | Signed-out 401 on setup/enable/recovery-codes/disable; new recovery codes need password + code, are audited, and the old codes stop working.                                                                                                                                                                                                                                                                                                                                                              |
| `apps/api/tests/invoices.test.ts` (QA block) | 12 refused payment inputs, a draft, an unknown id, and another agency's finance user (404). Nothing is written.                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/tests/api-client.test.tsx`         | 11 tests: NETWORK, TIMEOUT, proxy 502 page, server error body, CSRF fetch, one CSRF retry only, 401 vs expected auth 401 vs 403, upload headers.                                                                                                                                                                                                                                                                                                                                                          |
| `e2e/qa-resilience.spec.ts`                  | 14 tests: expired session mid-use (banner, return to page), expired session on reload, Back/refresh after sign-out, deep-link refresh and 404 route, failing list (error with reference, retries stop, Try again recovers), 3 s slow API, offline save keeps the form and writes nothing, double-clicked save writes one lead, no page-level sideways scroll at 360–1920 px on 26 staff screens across 5 roles and 3 portal screens. Client password is random per run (no new gitleaks allowlist entry). |
| `e2e/m1.spec.ts`, `e2e/demo/tour.spec.ts`    | WebKit keyboard test runs instead of being skipped (see §2).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scripts/large-dataset.mjs`                  | NFR-06 seed (500 contacts, 300 deals, 100 projects through the API) + p50/p95 of 10 list endpoints + rows vs `meta.total`. Run on 2026-11-04, see §5.2.                                                                                                                                                                                                                                                                                                                                                   |

The two first-run failures, both fixed in the test, not in the app:

1. I used `page.goto` for "mid-use"; a full load cannot know the session expired, so there is no
   `expired=1`. The test now navigates inside the app; the reload case is its own test.
2. I asserted exactly 3 list requests; React StrictMode in the dev server adds one. The test now
   checks 3–4 and that no request follows in the next 4 s.

## 4. Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Medium   | Several list endpoints cap rows with no paging and no total: projects 200, proposals 200, portal invoices 200, invoices 500, tasks 500 (`take:` in each service). Older records silently disappear from the list once an agency passes the cap. Also against NFR-05 (100 rows per request). Recommend cursor or page paging with `meta.total`. |
| Q2  | Low      | Three two-step routes were outside the permission matrix and its 401 sweep; recovery-code regeneration had no success test. Covered now (§3).                                                                                                                                                                                                  |
| Q3  | Low      | `/health/ready` does not report the virus scanner. With `CLAMAV_HOST` set and clamd down, uploads fail closed (tested) but readiness stays `ok`; only the owner-only System status shows `unreachable`. Recommend `checks.scanner` and alerting on it.                                                                                         |
| Q4  | Info     | After a full reload with an expired session the sign-in page shows no "Your session ended" banner (in-app navigation does show it).                                                                                                                                                                                                            |
| Q6  | Medium   | Unmerged `perf/startup-paint` only: desktop dashboard CLS 0.123 in 2 of 3 Lighthouse runs (main 0.000), from the "Needs your attention" grid and a "Loading…" placeholder moving when data arrives. Blocks merging that branch as is, not the current `main`.                                                                                  |
| Q5  | Info     | Firefox only, dev server only: React logged "Should not already be working" once during the M9 invoice tests (all passed). Not reproduced and not root-caused; the production build was not exercised in Firefox. Worth one look if it shows up again.                                                                                         |

## 5. Performance

- Bundle (`main`, production build): 73 JS files, 346 kB gzip in all, CSS 10 kB gzip. First load
  (entry + preloads) **183 kB gzip** and includes the form libraries.
- Unmerged `perf/startup-paint` (62a9283, built in a temporary detached checkout): first load
  **131 kB gzip** (3 files), 377 kB gzip in all (it also carries the UX branch).

### 5.1 Lighthouse (lab data, 2026-11-04 09:37–09:45)

**Why the earlier script run gave no scores:** in Git Bash, `MSYS_NO_PATHCONV=1` (needed so
`--path /app/...` is not rewritten) also stops `/c/Users/...` file arguments being converted, so
Node looked for `D:\c\Users\...\owner.pw` (ENOENT). File arguments must be `C:/Users/...`. The
script header now says so (`scripts/lighthouse.mjs`). A second series was then **discarded**:
Windows servicing (TiWorker, Defender, WMI) was running and TBT jumped to 400–1,400 ms; those
numbers are not used anywhere.

Method: Lighthouse 13.5.0 (`npx`), headless Chrome 156, performance category only. Mobile =
Lighthouse default (simulated slow 4G, 4× CPU slowdown, Moto G-class viewport); desktop =
`--preset=desktop`. Both production builds served by `node apps/api/dist/server.js` on 127.0.0.1
against the same demo database (`main` e404894 on :4600; unmerged `perf/startup-paint` 62a9283 on
:4601), signed in as the demo owner by `scripts/lighthouse.mjs`. Runs **alternate** main/perf so
drift hits both. Load before each run 2–23 % (20 logical CPUs); TiWorker idle; one stuck
Lighthouse process from the discarded series was still present but used 0 CPU (it could not be
stopped from this session). Benchmark index 2,530–3,714, except main's first mobile dashboard run
(1,909; same score as the others, kept). **Lab data only: no field (CrUX/RUM) data exists for
ClientFlow.**

Medians (all runs listed in the scratch `lh/results.txt`):

| Page / profile           | Build    | Runs | Perf (range)    | LCP      | TBT    | FCP      | CLS                      |
| ------------------------ | -------- | ---- | --------------- | -------- | ------ | -------- | ------------------------ |
| `/app/dashboard` mobile  | **main** | 5    | **86** (86–88)  | 3,430 ms | 92 ms  | 2,664 ms | 0.000                    |
| `/app/dashboard` mobile  | perf     | 5    | **93** (92–93)  | 3,084 ms | 76 ms  | 1,660 ms | 0.000                    |
| `/login` mobile          | **main** | 5    | **91** (89–91)  | 2,803 ms | 123 ms | 2,561 ms | 0.000                    |
| `/login` mobile          | perf     | 5    | **96** (95–96)  | 2,661 ms | 41 ms  | 1,658 ms | 0.000                    |
| `/app/dashboard` desktop | **main** | 3    | **99** (99)     | 802 ms   | 0 ms   | 612 ms   | 0.000                    |
| `/app/dashboard` desktop | perf     | 3    | **95** (95–100) | 752 ms   | 0 ms   | 368 ms   | **0.123** in 2 of 3 runs |

Reading:

- `main` matches or beats the M12 figures: dashboard mobile 86–88 (M12: 84–86), login 89–91
  (M12: 87–89). The dashboard is still **below the 90 mobile target**; login meets it.
- The perf branch gets the dashboard to 92–93 and login to 95–96 on mobile, mainly by cutting
  first-load JavaScript (183 → 131 kB gzip) and FCP (≈2.6 s → 1.66 s). LCP stays above 2.5 s in
  the simulated mobile profile for both builds.
- **Regression on the perf branch (finding Q6):** desktop CLS 0.123 in 2 of 3 runs (main 0.000).
  Lighthouse attributes it to the dashboard "Needs your attention" grid (0.067) and a "Loading…"
  placeholder (0.056) moving when data arrives. Fix that before merging; it is above the 0.1
  "good" threshold.
- Nothing here lowered a security header, CSP, or accessibility check; both builds were measured
  as they are.

### 5.2 API load (`scripts/perf.mjs`, NFR-02) and large dataset (`scripts/large-dataset.mjs`, NFR-06)

Same machine and `main` production build on :4600, demo database, run 09:46–09:50 after the
Lighthouse series (load before 26 %). These are local numbers: API and PostgreSQL on one laptop,
no network between them, so they show headroom and regressions, not production latency.

`perf.mjs`, 300 requests per scenario, concurrency 10, 2,523 contacts in the database:

| Scenario                 | Errors | p50    | p95        | Target |
| ------------------------ | ------ | ------ | ---------- | ------ |
| GET /contacts (page 1)   | 0      | 41 ms  | **49 ms**  | 500 ms |
| GET /contacts?q=Person 1 | 0      | 46 ms  | **60 ms**  | 500 ms |
| GET /deals/board         | 0      | 114 ms | **135 ms** | 500 ms |
| GET /dashboard/sales     | 0      | 110 ms | **147 ms** | 500 ms |
| GET /invoices            | 0      | 33 ms  | **41 ms**  | 500 ms |
| GET /notifications       | 0      | 24 ms  | **33 ms**  | 500 ms |
| POST /contacts           | 0      | 43 ms  | **64 ms**  | 800 ms |

`large-dataset.mjs` (NFR-06), sequential requests, 30 samples each, database then holding
**3,333 contacts, 610 deals, 107 projects** (above the 500 / 300 / 100 requirement): every list
endpoint answered 200 with p95 between **25 and 53 ms** (deals board 53 ms, 61 kB; contacts page
20 26–37 ms; projects 25 ms for 107 rows). Paged lists returned 25 rows with a correct
`meta.total` (contacts 3,333, deals 610, search 333). `GET /projects` returned all 107 rows with
no total — under its 200 cap today, which is exactly finding Q1: at 201 projects the list would
silently drop rows.

The script's first run stopped at the project step with a correct 422 from the API: I had picked
project managers from `/projects/staff`, which lists every delivery role, and only an owner, admin
or PM may manage a project. The script now filters to those roles; it was rerun whole (so the
earlier 300 deals are included in the totals above).

## 6. Reliability

### 6.1 Backup → isolated restore drill (run 2026-11-04)

Source: this session's demo database `clientflow_qa_demo` (seeded by `npm run demo:reset`) and
its file store. Target: a new, empty `clientflow_qa_restore` on the same PostgreSQL 17.6
container. Nothing outside this session's own databases was touched.

| Step                                                    | Result                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run backup` (pg_dump via Docker, files, manifest)  | 3.4 s. 46 tables, 821 rows, `db.dump` 266,484 bytes, 4 files, 15 migrations, SHA-256 per item in the manifest                                                                                                                                                                               |
| `npm run restore` into the empty database               | 4.8 s. **`RECONCILED`**: row counts per table equal, files verified 4/4, unreferenced objects 0, no problems listed                                                                                                                                                                         |
| Boot the production build on the restored copy, sign in | Owner sign-in 200; `/health/ready` `ok`; API lists on restored and live copy gave contacts 20, deals 10, projects 3, proposals 4 and invoices HTTP 200 on both. Row counts in the restored database (`psql`) equal the manifest: contacts 20, deals 10, projects 3, invoices 5, proposals 4 |
| Refuse: target is the database in `DATABASE_URL`        | Refused, exit 1 ("Refusing to restore into the database in DATABASE_URL…")                                                                                                                                                                                                                  |
| Refuse: one byte of `db.dump` changed                   | Refused, exit 1 ("db.dump does not match its checksum: the backup is damaged.")                                                                                                                                                                                                             |
| Refuse: target database already has tables              | Refused, exit 1 ("Refusing: clientflow_qa_restore already has tables.")                                                                                                                                                                                                                     |
| Refuse: wrong `FILE_ENCRYPTION_KEY`                     | Refused, exit 1 ("FILE_ENCRYPTION_KEY is not the key this backup was made with. Files could not be read.")                                                                                                                                                                                  |

Limits: a small database (821 rows) on one machine, so the times say nothing about a production
size. Restore to a different PostgreSQL host and the off-site copy were not exercised.

### 6.2 Other reliability checks

Executed through the suites in §1: readiness 503 when the database is down, degraded on job lag,
outbox retries/dead-letter/no double send, two workers never share a job, ClamAV fail-closed, and
real ClamAV EICAR detection. Reviewed, not executed: failed-deploy recovery (rollback of a
release with a migration).

## 7. Release assessment

No test failed in any engine and no release blocker was found in `main` e404894 for the
automated scope: Edge, Firefox and WebKit E2E (77 each), demo tour 24/24, API 395 + 7 real
ClamAV, web 81, the restore drill reconciled, and the API stays far under its latency targets at
the NFR-06 data size.

Open items, in order:

1. **Q1 (Medium) — fix before an agency passes 200 projects/proposals or 500 invoices/tasks:**
   capped lists with no paging or total. Not hit by today's data.
2. **Dashboard mobile Lighthouse 86–88, below the 90 target** (login 89–91 meets it). The unmerged
   `perf/startup-paint` reaches 92–93 but has a **desktop CLS regression (Q6)**; fix Q6, re-measure,
   then the owner decides on merging.
3. **Human screen-reader pass (NFR-04)** — NOT RUN; axe in every engine is not a substitute.
4. Q3 (scanner not in `/health/ready`), Q4 and Q5 (info).
5. NOT RUN: full API/web suites again after this branch's new tests (each new file passed on its
   own), `docker build`, a failed-deploy rollback, a restore to another host.
