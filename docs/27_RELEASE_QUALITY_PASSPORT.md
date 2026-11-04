# Release Quality Passport

A record of what was checked for this release candidate, how, and with what result. A check that did not run is listed as **NOT RUN**, never as passed. Earlier evidence is cited with its own date and commit.

| Field                | Value                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release identifier   | `v0.13.0-rc.1` (**proposed, not tagged**: tagging is the owner's decision)                                                                                                                                                                             |
| Code commit verified | `dbb04eb` (`dbb04ebaf691e57277f3f077bb50b5faefe45c3a`). Full E2E ran on `268c997`; the only later code change is the demo guard (mounted in demo mode only), rerun through the API suite and the demo tour on branch `docs/portfolio`                  |
| Contents             | `main` e404894, plus `feat/demo-hosting` (PR #140: demo mode, local staging), plus `qa/release-quality` (QA report and regression tests), plus the fixes in §3. Later commits on this branch change documentation only                                 |
| Date                 | 2026-11-04                                                                                                                                                                                                                                             |
| Environment          | Windows 11 Home, i7-13650HX (20 logical CPUs), 16 GB · Node 24.19.0 · PostgreSQL 17.6 (Docker 29.9.2, port 5433) · Playwright 1.64.1 (Edge, Firefox, WebKit builds) · ClamAV 1.5.4 · Caddy 2.10.2                                                      |
| Verified by          | Claude Code (AI coding agent) on the owner's machine, at the owner's request. Not an independent third party                                                                                                                                           |
| Deployment status    | **Not deployed anywhere public.** Local production-like staging verified (§2). Public demo (Render Free + Neon Free) configured, not created. Paid pilot staging (`render.yaml`) configured, not applied. **No production customer deployment exists** |

## 1. Scope reviewed

- **Product:** all of M1–M12.1 (lead to invoice, client portal, automation, operations), the security hardening (PR #126), the demo hosting changes and the QA regression suites.
- **Layers:** the API (Express 5, 30 test files), the database (46 Prisma models, 15 migrations, `CHECK` constraints and freeze triggers), the web app (React 19), the container image, local staging, CI workflows, and the documentation and GitHub presentation.
- **Out of scope:** a real cloud network or proxy, real email delivery, real users, load beyond one laptop, and an external security assessment.

## 2. Checks actually executed

All checks ran one after another on a quiet machine unless noted.

| #   | Check                                                     | Command                                                                                                   | Result                                                                                                                                                                                                                                              | Time                 |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Lint                                                      | `npm run lint`                                                                                            | **pass**                                                                                                                                                                                                                                            | 144 s                |
| 2   | Types                                                     | `npm run typecheck`                                                                                       | **pass**                                                                                                                                                                                                                                            | 49 s                 |
| 3   | Formatting                                                | `npm run format:check`                                                                                    | **pass**                                                                                                                                                                                                                                            | 13 s                 |
| 4   | Production build                                          | `npm run build`                                                                                           | **pass**                                                                                                                                                                                                                                            | 31 s                 |
| 5   | Dependencies                                              | `npm audit --omit=dev --audit-level=high`                                                                 | **0 vulnerabilities**                                                                                                                                                                                                                               | 2 s                  |
| 6   | API integration (real PostgreSQL)                         | `npm test`                                                                                                | **416 passed, 1 skipped** (30 files) on `4d38603`; rerun on `268c997`: **416 passed, 1 skipped** (7.4 min); on `dbb04eb` after the demo guard fix: **418 passed, 1 skipped** (6.1 min). The skip is the real-ClamAV test without `CLAMAV_TEST_HOST` |                      |
| 7   | Web components                                            | `npm run test:web`                                                                                        | **95 passed** (14 files)                                                                                                                                                                                                                            | 62 s                 |
| 8   | E2E, Edge                                                 | `npm run e2e`                                                                                             | **77 passed**                                                                                                                                                                                                                                       | 8.4 min              |
| 9   | E2E, Firefox                                              | `E2E_BROWSER=firefox npm run e2e`                                                                         | **77 passed**                                                                                                                                                                                                                                       | 18.0 min             |
| 10  | E2E, WebKit                                               | `E2E_BROWSER=webkit npm run e2e`                                                                          | First run: **76 passed, 1 failed** (test-helper bug, §3). After the fix: **77 passed** (9.1 min) on `268c997`                                                                                                                                       |                      |
| 11  | Demo tour, 3 engines, includes the new demo sign-in check | `npm run demo:tour`                                                                                       | **27 passed** on `4d38603` and again on `dbb04eb`                                                                                                                                                                                                   | 3.7 min              |
| 12  | Portfolio screenshots                                     | `CAPTURE_SCREENSHOTS=1 SCREENSHOT_DIR=docs/portfolio/screenshots npm run demo:tour -- --project=chromium` | **9 passed**, 18 images (fictional demo)                                                                                                                                                                                                            | 2.5 min              |
| 13a | Production image on `dbb04eb`                             | `docker build -t clientflow:rc .`                                                                         | **pass**                                                                                                                                                                                                                                            | 16 s (cached layers) |
| 13  | Container build + local staging                           | `npm run staging:up` (builds the production image)                                                        | On `268c997`: **pass**, image built, 4 containers healthy (app, Postgres 17.6, ClamAV 1.5.4, Caddy)                                                                                                                                                 |                      |
| 14  | Staging check over HTTPS                                  | `npm run staging:check`                                                                                   | On `268c997`: **28 PASS, 1 SKIP** (TRUST_PROXY on loopback): HTTPS redirect, HSTS, strict CSP, `__Host-` Secure HttpOnly cookies, CSRF and Origin refusals, two-step sign-in, shared sign-in limits, virus scanner, jobs, sign-out and revocation   |                      |
| 15  | Backup → isolated restore                                 | `npm run backup`, `npm run restore` against staging                                                       | On `268c997`: **RECONCILED**, 46 tables, 70 rows, 1 encrypted file verified, 0 unreferenced, 15 migrations; into a new, empty database                                                                                                              |                      |
| 16  | Secret scan                                               | gitleaks v8.24.3, git history plus working tree                                                           | <!--P:gitleaks-->                                                                                                                                                                                                                                   |                      |
| 17  | Mermaid diagrams                                          | Mermaid validator (4 of 5) plus GitHub rendering                                                          | **5 of 5 render on GitHub** (checked on the pushed branch); 4 also passed the Mermaid validator, whose connector refused the fifth call                                                                                                             |                      |
| 18  | Docs fact-check                                           | Independent read-only agent, claims checked against code                                                  | 11 findings, all fixed (§3)                                                                                                                                                                                                                         |                      |
| 19  | CI on the PR                                              | GitHub Actions (6 jobs plus Dependabot and CodeQL checks)                                                 | <!--P:ci-->                                                                                                                                                                                                                                         |                      |

**Earlier evidence still relied on (not rerun on this commit):**

| Check                              | Result                                                                                 | Source                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lighthouse, lab data               | Dashboard mobile **86** (86–88), login mobile **91** (89–91), dashboard desktop **99** | QA report §5.1, `main` e404894, 2026-11-04. The front end has since changed only on the sign-in page (demo panel, shown only on a demo) and the files page note |
| API latency, 10 concurrent         | p95 33–147 ms for reads, 64 ms for writes (targets 500 / 800 ms)                       | QA report §5.2                                                                                                                                                  |
| Large dataset (NFR-06)             | 3,333 contacts, 610 deals, 107 projects: list p95 25–53 ms                             | QA report §5.2                                                                                                                                                  |
| Real ClamAV in the API suite       | 7 of 7 with `CLAMAV_TEST_HOST`                                                         | QA report §1. In this run that test is skipped (row 6), but staging (row 14) uses real ClamAV                                                                   |
| Firefox E2E on `feat/demo-hosting` | First run under load: 45 passed, 4 failed, 14 not run. Quiet rerun: **63 passed**      | PR #140                                                                                                                                                         |

**NOT RUN:**

- a human screen-reader pass (NFR-04);
- real email delivery through Resend;
- any hosted deployment (Render, Neon);
- `staging-check` behind a real proxy (TRUST_PROXY, R58);
- a failed-deploy rollback;
- a restore to a different PostgreSQL host;
- load tests beyond one laptop;
- an external penetration test.

## 3. Failures found during this audit and how they were handled

| Found by                                                      | Problem                                                                                                                                                                                                                                                                        | Fix                                                                                                                                                                                                                           | Evidence after the fix                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Docs fact-check                                               | The QA route-inventory test (written before the demo routes) does not list `GET /demo/accounts` or `POST /demo/sessions`, which are mounted only in demo mode                                                                                                                  | `0eecb0c`: both added to the documented outside-the-matrix list, naming `demo-hosting.test.ts` as their coverage                                                                                                              | `route-inventory.test.ts` 3/3; full API suite in row 6                                                                               |
| WebKit E2E                                                    | The QA helper set `expires_at = now() − 1 s`. A fast sign-in in the same second broke `CHECK (expires_at > created_at)`. **This was a test bug; the app was not at fault**                                                                                                     | `268c997`: use the later of `created_at + 1 ms` and `now() − 1 s`                                                                                                                                                             | QA spec 14/14 in WebKit and 14/14 in Edge, then row 10                                                                               |
| Strix automated security review (third-party tool on PR #140) | **HIGH:** the demo guard compared `req.path` exactly, but Express matches routes regardless of letter case and with a trailing slash, so `PATCH /AGENCY` or `POST /users/:id/deactivate/` got past it. **MEDIUM:** client-portal user deactivate/reactivate was not restricted | `86b1d44`: the guard lower-cases the path and trims trailing slashes before matching, and the portal routes are restricted. `755eb2b`: `.dockerignore` now excludes nested `.env*` and `*.crt` (from the same review's notes) | New tests failed on the old guard (3) and pass now; `demo-hosting.test.ts` 16/16; API 418 passed on `dbb04eb`; build context checked |
| Docs fact-check                                               | Overstated or imprecise wording, for example "every role against every route" (it is every _protected_ route) and "rate limits shared" (only the brute-force limits are), plus a missing `DEMO_MODE` in one command and the portal-invoice cap                                 | Wording corrected in the README, case study, overview docs and portfolio texts                                                                                                                                                | Rechecked by hand                                                                                                                    |

## 4. Independent recheck by area

| Area                | Evidence                                                                                                                 | Assessment                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functionality       | E2E 77 tests × 3 engines cover every milestone journey; the demo tour covers each role                                   | Works for the tested journeys. **Q1:** some lists cap at 200/500 rows with no paging                                                                                                                                                              |
| UI/UX               | Screens from 360 to 1920 px with no page-level sideways scroll; 200 %/400 % zoom reflow; demo labelling on every page    | Consistent and responsive. No usability study with real users                                                                                                                                                                                     |
| Backend             | API suite on real PostgreSQL: permission matrix, idempotency, races, outbox, readiness                                   | Strong automated coverage. **Q3:** readiness does not report the scanner                                                                                                                                                                          |
| Database            | Composite agency keys, `CHECK` constraints, freeze triggers, UUIDv7, restore drill                                       | Sound. **R48:** the app user owns the schema (open); a non-superuser role exists for staging                                                                                                                                                      |
| Security            | Threat model, limited ASVS map, security hardening PR #126 (findings F1–F14), demo guard, gitleaks, CodeQL, Trivy, audit | Self-assessed only. The demo-guard bypass found by the automated PR review (§3) shows that review catches real gaps; it is fixed and tested. Open: R48, R49 (plain-text backups), R50, R54 (no key rotation tool). TOTP is not phishing-resistant |
| Testing             | Rows 6–12; failures reported, not hidden                                                                                 | Good breadth. No mutation testing or coverage gate                                                                                                                                                                                                |
| Accessibility       | axe (WCAG 2.2 AA rules) in 3 engines, keyboard tests, skip link, focus management                                        | **No screen-reader pass.** Not a conformance claim                                                                                                                                                                                                |
| Performance         | Lighthouse and API latency (earlier evidence table)                                                                      | API well within targets locally. **Dashboard mobile 86, below the 90 target (R38)**                                                                                                                                                               |
| Deployment          | Local staging (rows 13–15), blueprints, deploy and health workflows (actionlint)                                         | Reproducible locally. Hosted behaviour unverified (R58)                                                                                                                                                                                           |
| Documentation       | 71 ADRs, threat model, runbook, guides per role, milestone reports, this passport                                        | Thorough; fact-checked against code (row 18)                                                                                                                                                                                                      |
| GitHub presentation | README rewritten, architecture/security overviews, real screenshots, portfolio texts                                     | Ready once merged. **No LICENSE**; no repository topics                                                                                                                                                                                           |

## 5. Security assessment scope

- **Included:**
  - the design-level threat model (STRIDE);
  - a limited OWASP ASVS 4.0 map (self-assessed);
  - a code-level security audit by the AI agent (PR #126);
  - the Strix automated PR security review (a third-party AI tool) on PR #140, whose two findings were fixed (§3);
  - automated scans: CodeQL, gitleaks, Trivy (image), `npm audit`, Dependabot;
  - a permission matrix across every protected route;
  - upload abuse tests, including real ClamAV EICAR detection;
  - CSRF, Origin and header checks over real HTTPS in local staging.
- **Not included:**
  - an external penetration test;
  - a third-party code audit;
  - any certification (SOC 2, ISO 27001 or similar);
  - a cloud configuration review;
  - a dependency licence review.

## 6. Known limitations

- **No real users and no production deployment.** The product has only run on one laptop.
- **Capped lists:** projects, proposals and portal invoices at 200 rows; invoices and tasks at 500 (Q1).
- **Dashboard mobile Lighthouse** is 86, against a target of 90.
- **Accessibility** has no screen-reader pass.
- **Single instance:**
  - the general API rate limit is per instance;
  - files sit on local disk, with no object storage driver.
- **Invoices** are tracked, not collected, and there are no generated invoice PDFs. Client acceptance is an operational approval, not an e-signature.
- **The public demo**, once deployed, sleeps after 15 minutes idle (about 1 minute to wake) and resets on every start.

## 7. Outstanding risks

| Risk                                              | Level                | Owner action                                           |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------ |
| R42 No real users have tried it                   | High                 | Run the pilot (`docs/22_PILOT_PLAN.md`)                |
| Q1 Capped lists                                   | Medium               | Add paging before an agency reaches the caps           |
| R48 App database user owns the schema             | Low / High impact    | Separate migration and runtime roles before real data  |
| R49 Backups in plain text                         | Medium / High impact | Encrypted disk or encrypted archive for backups        |
| R54 No key rotation tool                          | Low / High impact    | Build before real data                                 |
| R58 Hosted network unverified                     | Medium               | `staging-check` on the first hosted environment        |
| R55–R57 Free-tier demo limits and public endpoint | Low–Medium           | Accept for a fictional demo; recheck limits at sign-up |
| R38 Mobile performance                            | Medium / Low impact  | Fix Q6 on `perf/startup-paint`, re-measure, decide     |

## 8. Readiness assessment

No dimension below gets a perfect score. Each verdict rests only on the evidence above.

### A. GitHub portfolio: **Ready once the two PRs merge** (strong, about 8.5 / 10)

- **Why ready:**
  - real, reproducible engineering: 71 recorded decisions, tests on a real database and in three engines;
  - honest reports, including failures;
  - real screenshots of clearly fictional data;
  - documentation that has been fact-checked.
- **Holding it back:**
  - no LICENSE, so others cannot legally reuse the code;
  - no live demo link yet;
  - the README results are from one laptop.

### B. Public demo: **Ready to deploy, not yet verified live** (about 7 / 10)

- **Why:**
  - demo mode is enforced in the API and tested;
  - no passwords are published, no email is sent and uploads are off;
  - the data resets on every boot behind four guards, and the reset path was tested under a 512 MB cap.
- **Holding it back:**
  - nothing has run on Render or Neon yet (R58, TRUST_PROXY);
  - the free tier sleeps, giving a slow first visit;
  - the scheduled health check and deploy hook are untested on GitHub.
- **Ready means:** the owner creates the accounts, deploys, and the post-deploy checks in `docs/24_STAGING_AND_DEMO.md` pass.

### C. Real client production use: **Not ready** (about 4 / 10)

- **Missing:**
  - real users (R42);
  - a hosted staging environment with backups and point-in-time recovery;
  - Q1 paging;
  - separate database roles (R48);
  - encrypted backups (R49);
  - a key rotation tool (R54);
  - a screen-reader pass;
  - an external security review.
- **Also missing:** a privacy and terms review for the agency's jurisdiction, and an agreed RPO/RTO (NFR-08).
- **Path:** a pilot on paid staging with one friendly agency, after the items above. Not before.

## 9. Remaining action items

**Owner:**

1. Review and merge PR #140, then the portfolio PR.
2. Choose a LICENSE.
3. Tag `v0.13.0` after the merge, if you agree with this passport.
4. Create Render and Neon accounts without a card, set `RENDER_DEMO_DEPLOY_HOOK` and `DEMO_URL`, and approve the first demo deploy.
5. Turn on branch protection for `main`.
6. Add repository topics and the demo URL as the homepage.
7. Record the video from `docs/portfolio/DEMO_VIDEO_STORYBOARD.md`, and post on LinkedIn yourself.
8. Decide on `perf/startup-paint` after Q6 is fixed.

**Engineering, before any real client data:**

1. Paging for capped lists (Q1).
2. Scanner state in `/health/ready` (Q3).
3. Separate migration and runtime database roles (R48).
4. Encrypted backups (R49).
5. A key rotation tool (R54).
6. A screen-reader pass.
7. Hosted staging, then a pilot.
