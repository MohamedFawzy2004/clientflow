# ClientFlow: final closure report (v0.14.0 candidate)

- **Scope:** optimisation and release closure of the final signature release. The scope was
  frozen: no new commercial features, no redesign and no unrelated architecture change.
- **Branch:** `feature/final-signature-release`, PR
  [#151](https://github.com/MohamedFawzy2004/clientflow/pull/151). It contains `main` at
  `94f7022` (#152, the `effect` override) and the #153 sign-in fix.
- **Candidate commit:** application code at `9c45661`; the documentation commit that adds this
  report sits on top of it and changes no code.
- **Date:** 2026-11-25. Every check below ran on one Windows 11 laptop.
- **State:** the closure commits are **local only**. #151 on GitHub still points at `1f18bfc`.
  #153 is open and green. Nothing was merged, pushed, tagged or released by this work (§12).

Every figure and screenshot comes from the **fictional demo workspace**, rebuilt through the real
API. No real client data was used. Every performance figure is **local lab data**, not field data.

## 1. Verdicts

Each verdict stands on its own evidence. Meeting one does not imply the next.

| Status      | Verdict               | Evidence                                                                                                                                                           |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **YES**     | FUNCTIONALLY_COMPLETE | Every feature of the signature release is present at every width; API 474, web 124, E2E 82 · 82 · 83 and the demo tour 27 passed (§5)                              |
| **YES**     | SIGNATURE_UI_COMPLETE | Forest/Ivory tokens and the accepted signature visuals unchanged; closure changes are fixes and phone defaults only; real captures in `final-closure-screenshots/` |
| **YES**     | DESKTOP_OPTIMIZED     | Desktop dashboard 99 (98–99), LCP 0.91 s, CLS 0.018 (§4); Gantt overlaps, dependency tooltips and list targets fixed (§8)                                          |
| **PARTIAL** | MOBILE_OPTIMIZED      | Mobile UX: every brief item done, 0 px overflow on 108 checks (§7). Mobile performance: score 78, LCP 4.01 s, TBT 174 ms, 46 requests, **below the targets** (§4)  |
| **YES**     | PORTFOLIO_READY       | Case study, closure report, handoff with a demo script and honest limits, real before/after screenshots                                                            |
| **YES**     | LOCAL_DEMO_READY      | `npm run demo:reset` rebuilds the workspace through the real API; `npm run demo:tour` 27 passed in three engines                                                   |
| **NO**      | PUBLIC_DEMO_READY     | Not deployed. Render and Neon wait on the owner's accounts; no live URL, uptime or hosted monitoring                                                               |
| **NO**      | PRODUCTION_READY      | No pilot with real users, no external penetration test, no human screen-reader session, no field data                                                              |
| **NO**      | RELEASE_PUBLISHED     | v0.14.0 is not tagged or published. It waits on the owner's approvals in §12                                                                                       |

## 2. PR reconciliation

| PR   | What                                           | State on 2026-11-25                                                                               |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| #152 | `effect` 3.22.1 override (GHSA-7589-6fvf-x4pw) | **Merged** into `main` as `94f7022` (by the sign-in session, at the orchestrator's request)       |
| #153 | Sign-in layout shift in demo mode              | **Open.** Updated from `main` (`7a2ed74`); all 7 CI checks green; not merged                      |
| #151 | Final signature release                        | **Open** at `1f18bfc`. The closure work (§11) is local on the same branch and has not been pushed |

The preferred order from the brief is unchanged. The local branch already contains both fixes
(`5b158b4` merges the updated #153 branch, which carries `main` at `94f7022`), so the candidate
tested here is the post-merge state. A content-free merge commit is the only difference if #153 is
merged first and `main` is then merged into #151.

## 3. Profiling: where the mobile time went

All profiles are Lighthouse 13.5 mobile (simulated slow 4G, 4× CPU) on production builds served by
the API (`NODE_ENV=test`, demo mode on), same database, same machine. Single representative runs;
the final 5-run medians are in §4.

| Build                      | Score | FCP    | LCP    | TBT    | CLS   | Requests | API calls | JS KB | Font KB | API KB |
| -------------------------- | ----- | ------ | ------ | ------ | ----- | -------- | --------- | ----- | ------- | ------ |
| Baseline v0.13.0 `e84f959` | 84    | 2.58 s | 3.51 s | 162 ms | 0.069 | 33       | 8         | 246   | 48      | 19     |
| Signature `1f18bfc`        | 74    | 2.74 s | 4.30 s | 313 ms | 0.000 | 62       | 28        | 276   | 72      | 60     |
| After the API change       | 80    | 3.18 s | 4.04 s | 106 ms | 0.000 | 47       | 13        | 275   | 72      | 38     |

**Root causes found:**

1. **Request fan-out (fixed).** The signature dashboard made 28 API calls on a phone. The
   won-by-month panel paged through won deals, and lead sources ran one count per source. Both now
   come from the `/insights/sales` read the executive strip already makes (ADR-073). API calls fell
   from 28 to 13. In single runs TBT fell from about 313 ms to about 100 ms; the 5-run medians in
   §4 are 249 ms → 174 ms.
2. **Below-the-fold work at boot (fixed).** The lower dashboard sections now render through
   `DeferredSection` when they near the viewport. The delivery section is a lazy chunk.
3. **The SPA boot chain (not fixed, structural).** First paint waits for the route-lazy wave of
   chunks: `index.js`, then the shell and route chunks, then the session read. Lantern counts every
   request started before that paint. Document style and layout cost is also higher than the
   baseline (about 640 ms against 338 ms), because the signature shell and strip are richer.

**Experiments measured and rejected** (3 to 4 runs each, same conditions):

| Experiment                                                  | Result                                                             | Decision                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Static loader in `index.html` (earlier first paint)         | FCP 3.18 → 2.71 s, but TBT about 100 → about 210 ms, score 81 → 80 | Rejected: boot tasks moved into the TBT window |
| Command Center as its own lazy chunk                        | Score 80–81, LCP up to 4.05 s, TBT unchanged                       | Rejected: no gain                              |
| Font without the optical-size axis (72 → 48 KB)             | Score 80, LCP 4.01–4.06 s: no change                               | Rejected: no gain, and a visible type change   |
| Hiding the "Add lead" button outside sales routes on phones | Not built                                                          | Rejected: it removes a mobile feature          |

**What would close the remaining gap** (not done, it changes the architecture): pre-rendering the
dashboard shell, or inlining the session into the HTML so first paint does not wait for the
route-lazy wave. Both are outside the frozen scope.

## 4. Final measurement (local lab data)

Lighthouse 13.5. Five interleaved rounds: in each round every build ran every profile in turn.
Same machine, same reseeded demo database, servers restarted after each build. Median, with the
range in brackets. Requests, bytes and fonts are per page load.

Builds: **baseline** v0.13.0 `e84f959`, **signature** `1f18bfc` (#151 as first proposed),
**candidate** (this branch, application code of `9c45661`). Dashboard runs are signed in as the
owner; the sign-in page is signed out with demo mode on.

**Dashboard, mobile** (simulated slow 4G, 4× CPU):

| Build     | Score          | LCP                    | FCP                    | TBT                 | CLS | SI     | Requests | API calls | JS KB | Font KB (files) | API KB | Total KB |
| --------- | -------------- | ---------------------- | ---------------------- | ------------------- | --- | ------ | -------- | --------- | ----- | --------------- | ------ | -------- |
| Baseline  | 85 (83–86)     | 3.47 s (3.42–3.61)     | 2.94 s (2.88–3.02)     | 137 ms (74–157)     | 0   | 2.94 s | 33       | 8         | 246   | 48 (1)          | 19     | 327      |
| Signature | 72 (62–74)     | 4.56 s (4.47–4.89)     | 3.26 s (3.21–3.36)     | 249 ms (213–509)    | 0   | 3.26 s | 62       | 28        | 276   | 72 (1)          | 60     | 426      |
| Candidate | **78 (75–82)** | **4.01 s (3.84–4.19)** | **3.24 s (3.17–3.31)** | **174 ms (90–244)** | 0   | 3.24 s | **46**   | **13**    | 272   | 72 (1)          | **38** | **400**  |

**Dashboard, desktop:**

| Build     | Score          | LCP                    | FCP                    | TBT             | CLS             | SI                     |
| --------- | -------------- | ---------------------- | ---------------------- | --------------- | --------------- | ---------------------- |
| Baseline  | 92 (91–99)     | 0.82 s (0.81–0.85)     | 0.63 s (0.61–0.64)     | 0 ms (0–5)      | 0.174 (0–0.174) | 0.64 s (0.61–0.66)     |
| Signature | 98 (97–98)     | 1.08 s (1.02–1.15)     | 0.71 s (0.69–0.75)     | 23 ms (9–47)    | 0.018           | 0.79 s (0.72–0.86)     |
| Candidate | **99 (98–99)** | **0.91 s (0.86–0.96)** | **0.70 s (0.67–0.72)** | **0 ms (0–25)** | **0.018**       | **0.77 s (0.68–0.91)** |

Requests, bytes and API calls on desktop are the same as on mobile for each build.

**Sign-in page, mobile, demo mode on:**

| Build     | Score          | LCP                | FCP                | TBT              | CLS   | Requests | JS KB | Total KB |
| --------- | -------------- | ------------------ | ------------------ | ---------------- | ----- | -------- | ----- | -------- |
| Baseline  | 68 (66–69)     | 2.79 s (2.76–2.85) | 2.47 s (2.47–2.56) | 252 ms (175–281) | 0.457 | 15       | 198   | 263      |
| Signature | 66 (53–69)     | 3.04 s (2.96–3.24) | 2.73 s (2.71–2.81) | 205 ms (111–589) | 0.457 | 17       | 204   | 296      |
| Candidate | **85 (82–89)** | 3.07 s (2.98–3.12) | 2.72 s (2.71–2.77) | 229 ms (142–311) | **0** | 17       | 205   | 297      |

"JS KB" is all JavaScript transferred during the load (the initial chunks plus the route chunks
it pulls in), compressed. One font file, the variable Inter subset, on every build. Single-run
figures in §3 differ from these medians: the 5-run medians are the numbers to quote.

**What changed against the signature build:** 16 fewer requests and 15 fewer API calls, 22 KB
less API data, LCP down by about 0.55 s and TBT by about 75 ms (median), mobile score 72 → 78.
Desktop is now the best of the three builds. The sign-in page no longer shifts (CLS 0.457 → 0).
Against v0.13.0 the mobile dashboard is still slower: the signature shell, strip and charts cost
more to boot than the old dashboard, and the boot chain in §3 is unchanged.

**Against the targets (goals, not guarantees):**

| Target                       | Candidate (median)                  | Result                                 |
| ---------------------------- | ----------------------------------- | -------------------------------------- |
| Mobile dashboard score ≥ 90  | 78 (75–82)                          | **MISSED**                             |
| Mobile LCP ≤ 2.5 s           | 4.01 s                              | **MISSED**                             |
| Mobile TBT ≤ 150 ms          | 174 ms (90–244)                     | **MISSED** (1 of 5 runs was under 150) |
| CLS ≤ 0.1                    | 0 mobile, 0.018 desktop             | **MET**                                |
| About 40 requests or fewer   | 46                                  | **MISSED** (62 on the signature build) |
| Desktop dashboard score ≥ 95 | 99 (98–99)                          | **MET**                                |
| Sign-in CLS about 0          | 0 (Lighthouse); 0.0001 in Edge (§9) | **MET**                                |

The misses are recorded as risk R62. Closing them needs the architecture changes named at the end
of §3, which the scope freeze ruled out.

## 5. Gates on the candidate

Run on the candidate unless a row says otherwise. Commands are the repository's own.

| #   | Gate                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clean install (`npm ci`)                                      | **pass.** A fresh clone at `9c45661`, then CI's own sequence: `npm ci` → `prisma generate` → format → lint → typecheck → build, all exit 0; `npm audit --omit=dev` 0 vulnerabilities                                                                                                                                                                                                                                                                                |
| 2   | Format · lint · typecheck · build                             | **pass · pass · pass · pass**. `format:check` also flags one git-ignored local file (`.redesign-storage/`), which CI never sees; every tracked file passes                                                                                                                                                                                                                                                                                                          |
| 3   | Container build and smoke run                                 | **pass.** CI's image job run locally on `9c45661`: runtime and migrate images built; the runtime image migrated an empty database (18 migrations) and Prisma then found nothing pending or modified; in production mode `/health/ready` reported the database ok, `/app/dashboard` served the app with the strict CSP, an unknown API route returned 404 and a foreign-origin login 403; 0 error lines in the container log. Trivy was not run locally (CI runs it) |
| 4   | API integration on PostgreSQL (`npm test`, isolated database) | **474 passed, 1 skipped** (38 files, 258 s). The skip is the real-ClamAV test. Includes the permission matrix and route inventory, organisation isolation, finance integrity and the new chronology and money checks                                                                                                                                                                                                                                                |
| 5   | Web components (`npm run test:web`)                           | **124 passed** (20 files)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | End-to-end, Edge · Firefox · WebKit                           | **82 · 82 · 83** passed. 77 existing tests plus `closure.spec.ts`. WebKit ran the sixth closure test (the details sheet); Edge and Firefox ran it separately (**6 / 6** passed in each)                                                                                                                                                                                                                                                                             |
| 7   | Demo tour, 3 engines                                          | **27 passed** (2.9 min) on `9c45661`. The first run on the candidate failed the finance step in all three engines: it looked for an overdue invoice, which the corrected chronology no longer creates (§6). The step was updated, not loosened: it now checks four invoice states and that none is overdue                                                                                                                                                          |
| 8   | `npm audit --omit=dev --audit-level=high`                     | **0 vulnerabilities**                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 9   | gitleaks v8.28.0, `origin/main..HEAD`                         | **No leaks** (29 commits scanned)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | Security review of the closure diff (`security-review` skill) | **No high or medium findings.** Lead sources run under `contactReadScope` and only for roles with contact access; won counts sit inside `dealReadScope`; query keys are per user; no `dangerouslySetInnerHTML`; the seed changes no production rule                                                                                                                                                                                                                 |
| 11  | CodeQL                                                        | **NOT RUN locally**; runs in CI after the push                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | axe (WCAG 2.2 AA rules)                                       | **0 violations** on 34 runs: 17 screens at 1440 and 360 px, including both plan views and the deferred dashboard sections                                                                                                                                                                                                                                                                                                                                           |
| 13  | Keyboard · reduced motion · chart tables                      | **8/8** keyboard paths; reduced motion honoured (transition 0.14 s → 0.00001 s); every chart has a table, 0 unnamed SVGs                                                                                                                                                                                                                                                                                                                                            |
| 14  | Overflow and touch                                            | **0 px** on 108 page-width checks at 320–768 px; 0 elements escaping; 1 small-target report, a false positive (§7)                                                                                                                                                                                                                                                                                                                                                  |
| 15  | Zoom 200% and 400%                                            | **0 px** overflow on 18 checks (9 screens each at 640 px × 2 and 320 px × 4)                                                                                                                                                                                                                                                                                                                                                                                        |
| 16  | Sign-in, demo on and off                                      | §9: CLS about 0, no CSP violations, logical tab order, in 3 engines                                                                                                                                                                                                                                                                                                                                                                                                 |
| 17  | Backup → isolated restore                                     | **RECONCILED**: 18 migrations, 46 tables, 803 rows, 4/4 files verified; throwaway database dropped                                                                                                                                                                                                                                                                                                                                                                  |
| 18  | Regression tests for changed behaviour                        | API: won counts per currency, lead sources by scope (`intelligence.test.ts`); invoice chronology and money (`demo.test.ts`). Web: `dashboard-insights`, `timeline-clusters`, `plan-agenda`. E2E: `closure.spec.ts` (6 tests)                                                                                                                                                                                                                                        |

## 6. Demo chronology

**Fixed in this release, through the real API, without changing any production rule:**

- Invoices are issued on the reset day, as the API requires. Every due date is now on or after
  that day, and every payment is received on it. Before, one paid invoice read "issued 24 Nov, due
  14 Nov".
- **Trade-off: the demo no longer shows an overdue invoice.** An invoice is overdue only when
  its due date is before today, and every demo invoice is issued today, so an overdue example
  would need a back-dated issue date. Delta's deposit is now issued and unpaid instead, and
  Delta's project is still on hold waiting for it. The demo tour's finance step was updated to
  match: it checks the Paid, Partly paid, Issued and Draft invoices and that none shows as
  Overdue. Overdue logic itself is unchanged and stays covered by the API finance tests.
- The seed's agency uses the `Africa/Cairo` time zone, and seed dates are computed in it, so a
  reset just after midnight UTC cannot put a date on the wrong day.
- New regression tests in `demo.test.ts` run on every reset:
  - each issued invoice: `issuedOn` matches its issue timestamp in the agency's time zone;
    due date ≥ issue date; every payment between issue date and today;
  - money: paid amount equals payments minus reversals; payments use the invoice currency; the
    status matches (`PAID` means fully paid, `PARTIALLY_PAID` means between, `ISSUED` and `DRAFT`
    mean nothing paid).

**Not done, and why (blocker):**

- **Projects still start three weeks before their deal is won and converted.** The API stamps
  "won", "accepted" and "converted" with the current time, while the project start is a date a
  person enters.
- **No completed project and no multi-month history.** Both need events dated weeks or months in
  the past.

A demo-only controlled clock is the only safe route. It was scoped and not built: the API has 99
wall-clock reads and 44 database `now()` defaults. Making them all follow a demo clock means
touching most modules, and the security clocks (sessions, rate limits, tokens, lockouts) must
never move, so each read would need a judgement. That is an architecture change, which the scope
freeze rules out. Back-dating invoice issue was rejected outright: it would change a production
rule to make the demo look right.

The demo guide (`docs/24_STAGING_AND_DEMO.md` §11a) and the risk register (R60, now Medium) say
this plainly.

## 7. Mobile (320, 360, 375, 390, 430 and 768 px)

**Layout scan** (`mobile-scan`, integrated production build, owner and client):

- **Coverage:** 18 screens at 320, 360, 375, 390, 430 and 768 px, 108 page-width checks.
- **Page-level horizontal overflow:** 0 px on all 108.
- **Elements escaping the viewport outside a scroll container:** 0.
- **Touch targets under 24 × 24 px (WCAG 2.5.8):** 1 reported, on the portal project page: the
  deliverable title link, 20 px tall. It is a false positive. The link's `::after` covers the
  whole list row, which is more than 44 px tall, so the real target is the row. No change was
  made.

| Brief item                          | State    | Where                                                                                                                                                                                                              |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drawer, KPIs first                  | ✅       | Below 768 px the navigation is a top bar and a drawer. The executive strip is the first section, and the lower sections are deferred                                                                               |
| Map: touch zoom and pan             | ✅       | Zoom buttons, a two-finger pinch (new), and drag to pan once zoomed. Unzoomed, a one-finger swipe scrolls the page (new; it was blocked before)                                                                    |
| Map: list alternative               | ✅       | Phones open on the list, and the map is one tap away. List targets are at least 24 px                                                                                                                              |
| Map: details sheet                  | ✅ new   | Below 1280 px a non-modal bottom sheet names the selection, with **Details** (moves to the full panel and focuses its first action) and **Clear**. Before, the panel opened below the map, out of sight on a phone |
| Pipeline: board and list            | ✅       | `Board` (scrolls sideways inside its own container) and `List`                                                                                                                                                     |
| Gantt: scrolling                    | ✅       | The drawing scrolls inside a focusable region                                                                                                                                                                      |
| Gantt: agenda                       | ✅ new   | Phones open the plan on **Agenda**: every dated milestone and task by day, with its state in words. The timeline is one tap away                                                                                   |
| Gantt: overlapping same-day markers | ✅ fixed | Drawn once as a count chip (§8)                                                                                                                                                                                    |
| Tables and forms without overflow   | ✅       | 0 px on the scan; wide tables scroll inside their containers                                                                                                                                                       |
| Touch targets                       | ✅       | Controls are 40 px tall below 768 px; the one finding is a false positive (above)                                                                                                                                  |
| Finance and Portal readable         | ✅       | Checked at all six widths; see the screenshots                                                                                                                                                                     |
| No feature removed on mobile        | ✅       | Every view exists at every width; the phone defaults only change which view opens first                                                                                                                            |

Covered in three engines by `e2e/closure.spec.ts`: agenda by default at 360 px, the timeline
toggle, the same-day count chip, pinch zoom with real `PointerEvent`s, and the deferred dashboard
sections on a phone.

## 8. Desktop (1024, 1280, 1440 and 1920 px)

Objective fixes only:

- **Gantt overlaps:** markers closer than about a day or two on the drawn range become one count
  chip. Its tooltip lists every item, and the screen-reader table lists them too. The chip takes
  the most urgent state (past due, blocked, open, done). Text contrast on the chip is 4.78:1 or
  more.
- **Dependency tooltips:** each node on the dependency map has a `<title>` with the full task name
  and state, because long names are truncated on the drawing.
- **Map list targets:** the list view's links and buttons are at least 24 px tall (WCAG 2.2
  target size).
- **Relationship map labels:** no collision found at 1024–1920 px on the demo data, so no change
  was made.

## 9. Login

- #153 (integrated here) reserves the demo accounts block's space only when the server runs in
  demo mode, so the form no longer jumps.
- **Checked with demo mode on (port 4710) and off (port 4714)** on the integrated production build
  in Edge, Firefox and WebKit, at 390 and 1440 px (`login-check`, 12 runs):

  | Check                                                  | Demo on                                            | Demo off                                                                                                        |
  | ------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | Layout shift during load (Edge, `PerformanceObserver`) | 0.0001 at 390 px, 0 at 1440 px                     | 0.0001 at 390 px, 0 at 1440 px                                                                                  |
  | "Sign in" button position, all three engines           | Identical: y = 967 px (390) and 893 px (1440)      | Identical: y = 557 px (390) and 548 px (1440)                                                                   |
  | CSP violations in the console                          | 0                                                  | 0                                                                                                               |
  | Demo accounts                                          | 8 "Explore as …" buttons; `GET /demo/accounts` 200 | None; `GET /demo/accounts` 404                                                                                  |
  | Tab order                                              | The "Explore as …" buttons, then the form          | Email → Password → Show password → Forgot password → Sign in (WebKit skips the link, as Safari does by default) |

  Firefox and WebKit do not expose the layout-shift API, so their CLS is not measured; the
  identical button position across engines is the evidence there.

- **CSP is unchanged** from v0.13.0 and identical with demo mode on and off:
  `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`,
  `form-action 'self'`. The `style-src 'unsafe-inline'` entry was already present on v0.13.0.

## 10. Skills and tools actually used

- **Skills invoked in this closure:** `security-review` (the review in §5). The signature phase
  before it used UI UX Pro Max, Frontend Design, Emil Kowalski design engineering and dataviz.
- **Tools:**
  - Lighthouse 13.5 through `scripts/lighthouse.mjs` and `npx lighthouse`;
  - Playwright (Edge, Firefox and WebKit, captures and pointer events);
  - axe-core, Vitest, ESLint, Prettier and TypeScript;
  - gitleaks in Docker and `npm audit`;
  - the repository's backup, restore and demo scripts.
- **Not available and not used:** Impeccable, Graphify and Headroom are not installed.

## 11. Commits in this closure

Local commits on `feature/final-signature-release` after `1f18bfc` (oldest first):

| Commit    | What                                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| `86676c7` | Merge of `fix/effect-advisory` (#152)                                                  |
| `3218f3c` | Merge of `fix/login-demo-cls` (#153)                                                   |
| `90bb7b3` | perf(dashboard): one scoped sales read instead of fifteen requests (ADR-073)           |
| `97c7f98` | fix(web): readable Gantt markers, dependency tooltips, map list touch targets          |
| `6ccf721` | fix(demo): no invoice due or paid before it was issued                                 |
| `5b158b4` | Merge of the updated #153 branch, which carries `main` at `94f7022`; no content change |
| `36c6b28` | feat(web): plan agenda on phones, pinch zoom on the relationship map                   |
| `16c3272` | feat(web): details sheet for a map selection below 1280 px                             |
| (next)    | test(demo): tour finance step follows the corrected invoice chronology                 |
| (next)    | docs: closure report, portfolio handoff, screenshots and record updates                |

The two merges of the fix branches also bring in `6cbfe33`, `1a59298`, `94f7022` and `7a2ed74`
from #152 and #153.

## 12. Approvals needed from the owner

Nothing below has been done. Each step needs the owner's explicit approval, in this order:

1. **Merge #153** (`fix/login-demo-cls`) into `main`. It is already updated from `main` and all
   7 CI checks are green.
2. **Push `feature/final-signature-release`** to update #151. This is a fast-forward of the PR
   branch from `1f18bfc` to the candidate (no force push), after merging the new `main` into it
   locally. Because the branch already contains #153's commits, that merge has no content. CI then
   runs on #151.
3. **Merge #151** once its CI is green. Then confirm that post-merge CI on `main` is green.
4. **Tag `v0.14.0`** on the merge commit and **publish the GitHub release** with the notes in §14.
5. Update the release records afterwards: the passport's release line and the project memory.

Separately, and not part of this release: the Render and Neon accounts for the public demo; and
the open Dependabot majors, which must not be merged automatically.

## 13. Not run

- **iOS Safari on a real device: NOT RUN.** WebKit in Playwright is the closest check.
- **Android Chrome on a real device: NOT RUN.** Phones were emulated in Edge and Playwright.
- **A human screen-reader session: NOT RUN.** axe, keyboard paths and the table and list
  equivalents are automated checks, not a substitute.
- **CodeQL: NOT RUN locally.** It runs in CI only, so it runs on #151 after the push (§12 step 2).
- **Field Core Web Vitals: none.** Nothing is deployed, so every performance figure is lab data.
- **Real-ClamAV upload test:** skipped in the API suite without `CLAMAV_TEST_HOST`, as on `main`.
- **Hosted deployment, real email, load tests, external penetration test: NOT RUN.**

## 14. Release notes (draft for v0.14.0)

> **ClientFlow v0.14.0: final signature**
>
> - **New look:** forest sidebar with grouped navigation, a refined palette with measured
>   contrast, page titles and breadcrumbs.
> - **Executive strip:** the agency's position above the fold, per role. Each figure says how it
>   is counted and links to its records. Money is never added across currencies.
> - **Relationship map:** who and what connects to a client, from stored links only, with search,
>   zoom (including pinch on touch screens), a details panel or sheet, and a list view.
> - **Client 360, pipeline Insights** (funnel, stage ageing, sources) and a **delivery portfolio**
>   (timeline, health, open work per person).
> - **Project plan** with a timeline, an agenda by day (the default on phones) and a dependency
>   map. Tasks due the same day are drawn once with a count.
> - **Finance trends** per currency and **estimated profitability** (finance and admins only).
> - **Client portal home:** decisions waiting, progress, schedule and balance.
> - **Faster dashboard:** one scoped read feeds the sales panels (about 28 API calls down to 13
>   on a phone), and the lower sections load as they scroll into view.
> - **Fixes:** the demo sign-in page no longer shifts; demo invoices are never due or paid
>   before they were issued; `effect` is pinned to 3.22.1 (GHSA-7589-6fvf-x4pw).
> - **For developers:** five read-only intelligence endpoints (ADR-072) and two additive fields
>   on `/insights/sales` (ADR-073). No migrations.
> - **Known:** the mobile dashboard is below the lab target of 90 (see the closure report §4).
>   There is no field data, because nothing is deployed.
