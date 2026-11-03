# QA release report — `main` at e404894 (2026-11-03)

Status: **PARTIAL**. The session hit its usage limit before the cross-browser, demo-tour,
Lighthouse, large-dataset and backup/restore steps were finished. Anything not listed as run
below was **NOT RUN**. A test that did not run is never counted as passed here.

Environment: Windows 11, i7-13650HX (20 logical CPUs), 16 GB, Node 24.19.0, npm 11.17.0,
PostgreSQL 17.6 in Docker (port 5433), Playwright 1.64.1, Edge. Worktree `D:\Projects\CRM-qa`,
branch `qa/release-quality`. Databases were this session's own: `clientflow_qa_test`,
`clientflow_qa_e2e`, `clientflow_qa_demo`. CPU load before the runs was about 20 %; no other
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

NOT RUN: `E2E_BROWSER=firefox` and `webkit` full suites, `npm run demo:tour`, the full API and
web suites again after the new tests were added, `docker build`.

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
  engines. (Changed, not yet run in WebKit.)

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
| `scripts/large-dataset.mjs`                  | NFR-06 seed + timing + truncation check. Written and linted, **NOT RUN**.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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

## 5. Performance — NOT FINISHED

- Bundle (`main`, production build): 73 JS files, 346 kB gzip in all, CSS 10 kB gzip. First load
  (entry + preloads) **183 kB gzip** and includes the form libraries.
- Unmerged `perf/startup-paint` (62a9283, built in a temporary detached checkout): first load
  **131 kB gzip** (3 files), 377 kB gzip in all (it also carries the UX branch).
- Lighthouse: both builds were served on the same demo database (`main` :4600, perf :4601,
  `NODE_ENV=test`, 127.0.0.1) and an alternating run was started (dashboard mobile 5+5, `/login`
  mobile 5+5, dashboard desktop 3+3). Results were not collected before the session stopped; the
  raw output is in the session scratch folder (`lh/results.txt`). **No current Lighthouse number
  for `main` is claimed here.** The earlier figures (M12 dashboard mobile 84–86, perf branch 90–94)
  are lab results from other sessions, not field data.
- NOT RUN: `scripts/perf.mjs` (API p95), `scripts/large-dataset.mjs` (NFR-06).

## 6. Reliability — NOT RUN except as noted

Reviewed, not executed: backup/restore drill (`npm run backup`/`restore`), failed-deploy recovery.
Executed through the suites above: readiness 503 when the database is down, degraded on job lag,
outbox retries/dead-letter/no double send, two workers never share a job, ClamAV fail-closed, and
real ClamAV EICAR detection.

## 7. Remaining release blockers / to do

1. Run Firefox and WebKit E2E and the demo tour on `main` with these changes (quiet machine).
2. Collect the Lighthouse comparison; decide on merging `perf/startup-paint` (owner).
3. Run `perf.mjs` and `large-dataset.mjs`; fix Q1 before agencies exceed the caps.
4. Run the backup → isolated restore drill and keep the log.
5. Human screen-reader pass (NFR-04) — still NOT RUN.
