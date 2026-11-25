# ClientFlow: Final Signature Release Report

- **Release:** final signature (agency and relationship intelligence on a new visual identity).
- **Branch:** `feature/final-signature-release`, based on `main` at `e84f959` (v0.13.0).
- **Date:** 2026-11-25.
- **State:** not pushed, not merged, not deployed, not released. Every check below ran on one
  Windows 11 laptop.
- **Recommended version:** **v0.14.0**. Every change is additive: new screens, read-only
  endpoints, one new response field. Nothing in the API or the database breaks.

Every screenshot and figure comes from the **fictional demo workspace** (`npm run demo:reset`),
built through the real API. No real client data was used.

## 1. Status verdicts

Each status is judged on its own, and meeting one does not imply the next.

| Status                    | Verdict                         | Why                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FUNCTIONALLY_COMPLETE** | **Met, with limitations (§12)** | Every area in the brief has working screens on real, permission-scoped data, covered by API, web and end-to-end tests. Charts were left out where the data cannot support them (§6). Limitations are listed, not hidden                                                                              |
| **SIGNATURE_UI_COMPLETE** | **Met**                         | Identity, shell, executive strip, intelligence screens, Client 360, relationship map, delivery plan, profitability and portal are built. Four critique rounds were done. The owner accepted the visuals from the screenshots on 25 Nov 2026 (§15)                                                    |
| **PORTFOLIO_READY**       | **Met on this branch**          | Case study, design system, architecture, threat model and 39 indexed screens at 1440 and 1920 px plus phone, with before/after. It becomes public only when the owner merges and pushes                                                                                                              |
| **LOCAL_DEMO_READY**      | **Met**                         | Every local gate passes on this branch: clean install, lint, types, build, 468 API and 112 web tests, 77 end-to-end tests in each of Edge, Firefox and WebKit, the 27-step demo tour, axe, overflow and the backup drill. `npm run demo:reset` rebuilds the fictional workspace through the real API |
| **PUBLIC_DEMO_READY**     | **Not met**                     | Nothing is deployed. Render and Neon still wait on the owner's accounts, so there is no live URL, no hosted monitoring and no check behind a real proxy                                                                                                                                              |
| **PRODUCTION_READY**      | **Not met**                     | No hosted staging, error tracking or alerting. No external penetration test, human screen-reader session or pilot with real users. Open threat-model risks remain. The 3 high `npm audit` advisories on `main` are unresolved                                                                        |

## 2. Inventory

24 commits on the branch (the last adds this report), 220 files, +13.9k and −1.4k lines, including
docs and 82 screenshot and evidence files.
No migration, no new table, no new dependency and no lockfile change.

| Layer     | Added or changed                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API       | `modules/intelligence/`: five read-only endpoints (ADR-072), plus a `profitability` block on finance insights for `finance.view` only. `invoices/service.ts` exposes the shared `costOfEntries` cost loop. The demo seed records 12 task dependencies                                         |
| Contracts | `intelligence.ts`: `RelationshipGraphData`, `SalesIntelligence`, `FinanceIntelligence` (with `profitability`), `DeliveryIntelligence`, `ProjectPlan`                                                                                                                                          |
| Web shell | Forest sidebar with collapsible groups, breadcrumbs, search, quick-create, page titles, refined tokens (`styles/index.css`)                                                                                                                                                                   |
| Web       | Executive strip (`dashboard/ExecutiveStrip.tsx`), Command Center sections, pipeline signals, drawer and Insights, Client 360, server-built relationship map, delivery portfolio, project plan (Gantt and dependency map), finance trends, profitability, client portal home and schedule line |
| Tests     | API: `intelligence.test.ts` (14 incl. profitability), permission matrix and route inventory (all routes), `demo.test.ts` (dependency count). Web: `intelligence.test.tsx`, `executive-strip.test.tsx`, plus the earlier redesign tests                                                        |
| Docs      | This report, the [screenshot index](final-signature-screenshots/README.md), design system (`docs/design/redesign/01_DESIGN_SYSTEM.md`), proposals, threat model, architecture overview, case study, demo guide, release checklist, risk register, passport, README                            |

## 3. Feature completion matrix

✅ built and tested · ◐ built with a stated limit · ✕ not built (reason given)

| Area (brief)     | Item                                                                                                                                                                        | State | Where / note                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Executive        | Open pipeline, won, win rate, received, invoiced, outstanding and overdue, estimated margin, active projects, delivery risks                                                | ✅    | Executive strip, role-aware; each tile has a rule, a link and a comparison                                                                   |
| Executive        | New leads, follow-ups, pending proposals                                                                                                                                    | ✅    | Command Center: next conversations, follow-up heat, results, proposals counts                                                                |
| Executive        | Revenue, costs                                                                                                                                                              | ◐     | Revenue as invoiced and received (cash). Cost is logged time at dated rates, an estimate. There is no general-ledger cost, by design         |
| Executive        | Role views, period filter, comparisons, drill-downs, definitions                                                                                                            | ✅    | Month / 3-month toggle. Integer comparisons. Every tile links to its records                                                                 |
| Relationship map | Persisted links only, filters, search, zoom/pan, focus, expand/collapse, details, list                                                                                      | ✅    | `/app/relationships`. Server graph per contact. Kinds the viewer cannot read are dropped                                                     |
| Client 360       | Identity, owner, source, deals, proposals, projects, invoices, follow-ups, lifecycle, map link                                                                              | ✅    | `/app/leads/:id`                                                                                                                             |
| Client 360       | Portal access, notes, timeline                                                                                                                                              | ✅    | Existing sections, restyled                                                                                                                  |
| Pipeline         | Drag and drop, keyboard, concurrency, validation                                                                                                                            | ✅    | Unchanged rules. E2E covered                                                                                                                 |
| Pipeline         | Stage totals per currency, owner, age, stalled, search and filters, list, deal detail                                                                                       | ✅    | Board, list and drawer                                                                                                                       |
| Pipeline         | Funnel, conversion, sources, stage ageing                                                                                                                                   | ✅    | Insights view                                                                                                                                |
| Pipeline         | Transition history                                                                                                                                                          | ◐     | Time in stage uses the stored `deal.stage_changed` activity. No stage-entry history is invented (proposal P1)                                |
| Delivery         | Portfolio, milestones, Gantt, dependency graph, blocked tasks, deadlines                                                                                                    | ✅    | `/app/delivery`, `/app/projects/:id/plan`                                                                                                    |
| Delivery         | Workload, planned vs logged                                                                                                                                                 | ◐     | Open tasks per person per due week and estimate against logged. No capacity model, so nothing is called "overloaded"                         |
| Financial        | Invoiced, received, outstanding, aging, payment trends per currency                                                                                                         | ✅    | Finance report                                                                                                                               |
| Financial        | Estimated margin, project profitability, waterfall, change-request impact                                                                                                   | ✅    | Profitability block: signed budget → accepted changes → time cost → margin                                                                   |
| Financial        | Cost breakdown                                                                                                                                                              | ◐     | Per project and per person (project finance tab). No cost categories exist in the data                                                       |
| Portal           | Overview, pending actions, progress, milestones, schedule                                                                                                                   | ✅    | Portal home and project page                                                                                                                 |
| Portal           | Proposals and approvals, deliverable reviews, feedback, change requests, invoices                                                                                           | ✅    | Existing org-scoped screens, restyled                                                                                                        |
| Visualization    | Area/line, funnel, heat, stacked/grouped bars, waterfall, graph, Gantt, meters                                                                                              | ✅    | §6                                                                                                                                           |
| Visualization    | Sankey, donut                                                                                                                                                               | ✕     | Sankey needs stage-to-stage flows, which are not stored. A donut adds nothing that the labelled bars do not already show, so it was left out |
| Consistency      | Auth, leads, deals, follow-ups, proposals, services, projects, tasks, deliverables, files, time, changes, invoices, portal, team, notifications, imports, settings, account | ✅    | Shared tokens and components. Checked in the 196-shot width matrix                                                                           |
| Demo data        | Several clients, won and lost deals, blocked tasks, change requests, paid, partly paid and overdue invoices, dependencies                                                   | ✅    | `apps/api/src/demo/seed.ts`, all through the real API                                                                                        |
| Demo data        | Completed project; history across several months                                                                                                                            | ◐     | Not seeded (§12)                                                                                                                             |

## 4. Before and after

The [screenshot index](final-signature-screenshots/README.md#before-and-after) pairs every v0.13.0
portfolio shot with its new screen. In short:

- **Dashboard:** seven equal KPI cards become a role-aware position strip. Each tile states its
  rule, compares with the previous period and links to its records.
- **Pipeline:** same board, plus signals, totals per currency and an Insights view.
- **Leads:** each contact page becomes a Client 360.
- **Project:** gains a Plan tab with a Gantt and a dependency map.
- **Finance:** gains trends and profitability.
- **Portal:** a list of proposals becomes a home: what waits on the client, progress and balance.
- **New screens:** relationship map, delivery portfolio, sales Insights, workload.

## 5. Screenshots

Folder: [`docs/milestones/final-signature-screenshots/`](final-signature-screenshots/).

- `1440/` and `1920/`: 17 required screens, each as a clean viewport shot and a full page.
- `mobile/`: 5 phone screens at 390 × 844.
- `zoom-200/` and `zoom-400/`: reflow checks.
- `report.json`: the 7-width matrix.
- `final-report.json`: overflow for this set, 0 px everywhere.

## 6. Chart data-source inventory

Every chart reads one permission-scoped endpoint. None stores or computes values in the browser
beyond sums, per-currency grouping and integer percentages.

| Chart                             | Component        | Endpoint and fields                                                          | Permission                                                                      | Text alternative                       |
| --------------------------------- | ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| Executive strip                   | `ExecutiveStrip` | `insights/sales`, `insights/finance`, `insights/delivery`, `reports/finance` | Per tile: `dashboard.sales`, `invoices.read.*`, `finance.view`, `delivery.work` | Tiles are text (`dl`)                  |
| Pipeline stage flow               | `StageFlow`      | `GET /deals/board` (open deals per stage, totals per currency)               | `deals.read.*`                                                                  | Labelled values under each segment     |
| Follow-up load                    | `DayHeat`        | `GET /follow-ups`                                                            | follow-up read                                                                  | Counts printed in cells                |
| Won value by month                | `MonthlyColumns` | `GET /deals?status=WON`, by close month, one chart per currency              | `dashboard.sales`                                                               | "Show as table"                        |
| Lead sources                      | `BarList`        | `GET /contacts?source=…` counts (all, and customers)                         | contacts read                                                                   | Counts printed                         |
| Stage funnel                      | `StageFunnel`    | `insights/sales` `stages[].open`, `totals`                                   | `dashboard.sales`                                                               | Values printed                         |
| Time in stage                     | `HeatTable`      | `insights/sales` `stages[].age`                                              | `dashboard.sales`                                                               | It is a table                          |
| Opened / won / lost by month      | `MonthBars`      | `insights/sales` `monthly`                                                   | `dashboard.sales`                                                               | Screen-reader table                    |
| Invoiced and received by month    | `PairedColumns`  | `insights/finance` `monthly[currency].points`                                | `invoices.read.all` or `.project`                                               | Screen-reader table                    |
| Aging bar                         | finance report   | `reports/finance` `totals[].aging`                                           | `finance.view`                                                                  | Buckets printed                        |
| Profitability waterfall and table | `Profitability`  | `insights/finance` `profitability`                                           | `finance.view` (server returns null otherwise)                                  | Amounts printed, table                 |
| Portfolio timeline                | `Timeline`       | `insights/delivery` `projects[].startOn/dueOn/milestones`                    | `delivery.work`                                                                 | Focusable region, health table         |
| Workload by week                  | `HeatTable`      | `insights/delivery` `people[].dueByWeek`                                     | `delivery.work`                                                                 | It is a table                          |
| Project plan Gantt                | `Timeline`       | `projects/:id/plan` milestones and task due dates                            | `delivery.work` and project scope                                               | Milestone list                         |
| Portal progress meters            | `PortalOverview` | `portal/projects` `milestones.done/total`                                    | client, own org                                                                 | `role="meter"` with value text         |
| Portal schedule line              | `PortalSchedule` | `portal/projects/:id` `startOn`, `dueOn`, `milestoneList`                    | client, own org                                                                 | Hidden drawing; milestone list is text |

## 7. Graph data-source inventory

| Graph               | Nodes                                                                                                    | Edges (all stored foreign keys)                                                                                              | Leak controls                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationship map    | Contact, owner, client organization, deals, proposals, projects, project manager, deliverables, invoices | contact→owner, contact→org, deal→contact, proposal→deal, project→deal, project→manager, deliverable→project, invoice→project | Each kind uses its existing read scope. A kind the viewer cannot read comes back empty with `readable: false`, adding no node, label, count or metadata. Capped at 50 per kind with `truncated`. An out-of-scope contact answers 404 |
| Task dependency map | Tasks of one project that have a dependency                                                              | `TaskDependency` rows                                                                                                        | `delivery.work` and the project's read scope. Tasks with no dependency are left out, and nothing is inferred                                                                                                                         |

## 8. Architecture

```
web (React 19, TanStack Query)                     api (Express 5, Prisma 7, PostgreSQL 17)
  ExecutiveStrip ──┬─ GET /insights/sales    ──► intelligence/service ─► deals, activity
                   ├─ GET /insights/finance  ──►        │                invoices, payments,
                   │                                    └─ costOfEntries ◄─ invoices/service
                   ├─ GET /insights/delivery ──►        projects, tasks, time (scoped)
                   └─ GET /reports/finance   ──► invoices/service (finance.view)
  RelationshipMap ── GET /contacts/:id/graph ──► per-kind read scopes, readable flags
  ProjectPlan ────── GET /projects/:id/plan  ──► milestones, tasks, TaskDependency
  Portal* ────────── GET /portal/...         ──► org-scoped portal services (unchanged)
```

- Every read is behind `requirePermission`, then the record's own scope helper
  (`projectReadScope`, `invoiceScope` and others).
- Queries are batched (`findMany` and `groupBy` per kind), so there is no N+1. Money stays in
  BigInt minor units per currency.
- See [ADR-072](../07_ARCHITECTURE_ADRS.md) and the
  [architecture overview](../25_ARCHITECTURE_OVERVIEW.md).

## 9. Security regression review

| Check                                                       | Result                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| New routes in the route inventory and the permission matrix | All five are listed. The matrix test fails on any unlisted route                                                                 |
| Profitability (costs, margins) reaches only `finance.view`  | Tested: the PM response is `null`, and the raw body contains no `estimatedCostMinor`                                             |
| Cost rates in another currency are never converted          | Tested: they are left out, and completeness drops to 75%                                                                         |
| Graph leaks (nodes, labels, counts, metadata)               | Tested per role: unreadable kinds are empty with `readable: false`, and out-of-scope contacts answer 404                         |
| Portal                                                      | No new portal endpoint. The home and schedule use only the existing org-scoped responses, which carry no notes, costs or margins |
| Executive strip                                             | No new endpoint. Each hook is disabled unless the role holds the permission, so no request is sent only to get a 403             |
| Secrets                                                     | gitleaks on `main..HEAD`: 24 commits, **no leaks**                                                                               |
| Security headers, CSP, rate limits, auth                    | Unchanged; the existing tests pass                                                                                               |

The [threat model](../11_THREAT_MODEL.md) gains rows for aggregates, graphs and profitability.

## 10. Test evidence

| Check                                         | Result                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install (`npm ci`)                      | Pass (second attempt). The first failed with EPERM because the running demo servers held `esbuild.exe`. The servers were stopped and the install repeated                                                                                |
| Prettier, ESLint, TypeScript (all workspaces) | Pass. Prettier's only warning is `.redesign-storage/`, a local folder excluded from git                                                                                                                                                  |
| API integration tests, real PostgreSQL        | **468 passed, 1 skipped** (38 files, 6.2 min). The skip is the real-ClamAV test, which needs `CLAMAV_TEST_HOST`                                                                                                                          |
| Web component tests                           | **113 passed** (17 files), including the executive strip helpers, its tile count per role and the profitability waterfall                                                                                                                |
| End-to-end, Edge · Firefox · WebKit           | **77 of 77 in each engine**: Edge 7.1 min, Firefox 14.3 min, WebKit 9.1 min. No retries counted as passes; no test skipped. After the layout-shift fix (a loading-state change on the dashboard) Edge ran again: **77 passed** (7.1 min) |
| Demo tour, every role                         | **27 passed** (2.9 min), every demo role through the real API                                                                                                                                                                            |
| Production build                              | Pass                                                                                                                                                                                                                                     |
| Migrations                                    | None new. All 18 apply with "No pending migrations"                                                                                                                                                                                      |
| Backup and restore drill                      | `npm run backup`, then `npm run restore` into an empty database: **RECONCILED**. 18 migrations, 46 tables, 817 rows, 4/4 files decrypted to their checksums                                                                              |
| axe (WCAG 2.2 AA rules)                       | **0 violations** on 30 runs: 15 screens (staff and portal) at 1440 and 360 px                                                                                                                                                            |
| Keyboard paths                                | 8 of 8 scripted paths, including skip link, command palette, deal drawer, stage select, focus ring and the map's list view                                                                                                               |
| Contrast                                      | Every token pair measured; see the design system. Text ≥ 4.5:1, graphics ≥ 3:1                                                                                                                                                           |
| Reduced motion                                | Transitions collapse to about 0 ms                                                                                                                                                                                                       |
| Horizontal overflow                           | **0 px on all 214 checks**: 196 shots at 360, 390, 768, 1024, 1280, 1440 and 1920 px across roles, plus 9 pages at 200% and 9 at 400% zoom ([report.json](final-signature-screenshots/report.json))                                      |
| gitleaks                                      | No leaks                                                                                                                                                                                                                                 |
| `npm audit`                                   | 3 high, 7 moderate. All already on `main`, and the lockfile is unchanged (§11)                                                                                                                                                           |

**Not run:** a human screen-reader session, real Safari or iOS, any hosted deployment, real email
delivery, or an external penetration test.

## 11. Performance and dependencies

**Bundle:** each route is a lazy chunk.

| Chunk            | gzip    |
| ---------------- | ------- |
| Entry            | 86.6 kB |
| Dashboard        | 10.7 kB |
| Relationship map | 7.8 kB  |
| Session (shared) | 35 kB   |

**Lighthouse (lab data, 2026-11-25).** Lighthouse 13.5.0, performance category only, signed
in as the demo owner by `scripts/lighthouse.mjs`. Mobile is Lighthouse's default (simulated slow
4G, 4× CPU slowdown); desktop uses `--preset=desktop`. Both builds were served by
`node apps/api/dist/server.js` on 127.0.0.1 against the same demo database: `main` (`e84f959`)
on :4711 and this branch on :4710. Production mode refuses plain-http origins, so both ran with
`NODE_ENV=test`, as in docs/23 §5.1. The runs alternate between `main` and the branch, so
machine drift hits both. Machine load was about 30% (other apps open), so absolute scores sit
below the 4 Nov baseline (dashboard mobile 86, desktop 99). Compare the two columns, not the
historic numbers. There is no field (CrUX or RUM) data.

| Page and profile            | `main` median (3 runs)           | Branch median (3 runs)           |
| --------------------------- | -------------------------------- | -------------------------------- |
| Dashboard, mobile           | 86 (81–86)                       | 78 (77–79)                       |
| LCP · FCP · TBT · CLS       | 3.43 s · 2.83 s · 119 ms · 0.000 | 4.07 s · 3.19 s · 171 ms · 0.000 |
| Dashboard, desktop          | 92 (91–99)                       | 98 (98–98)                       |
| LCP · FCP · TBT · CLS       | 0.80 s · 0.62 s · 0 ms · 0.174   | 1.01 s · 0.69 s · 4 ms · 0.018   |
| Sign in, signed out, mobile | 71 (70–71)                       | 70 (69–70)                       |
| LCP · FCP · TBT · CLS       | 2.80 s · 2.56 s · 131 ms · 0.456 | 2.95 s · 2.71 s · 97 ms · 0.454  |

What the runs found:

- **Layout shift, fixed on this branch.** The first series showed dashboard CLS 0.253 on mobile
  and up to 0.404 on desktop: the executive strip grew in steps as each query returned and pushed
  the rest of the page down. The strip now shows a placeholder grid with the final tile count
  for the role, taken from its permissions, until every query has returned. A role check in a
  real browser confirmed the count for all 7 staff roles. Afterwards: CLS 0.000 on mobile and
  0.018 on desktop, against 0.174 on `main`. A single-currency tile does not move. Each extra
  currency adds one 20 px line when the data arrives.
- **Mobile dashboard: 8 points below `main`. Not fixed.** The JavaScript is about the same size
  (204 kB against 199 kB on the first view, split into different chunks). The difference comes
  from what the redesigned dashboard loads on first view: the Inter font with its optical-size
  axis (72 kB against 48 kB), four insight requests for the strip (60 kB of JSON against 19 kB),
  3 kB more CSS, and 62 requests against 33. Desktop is better than `main` (98 against 92)
  because the layout shift is gone.
- **Sign-in page layout shift, pre-existing.** CLS is about 0.45 on both builds. It appears only
  with `DEMO_MODE` on: the demo accounts block is fetched after first paint and inserted above
  the form, so the vertically centred panel moves. It is the same on `main`, and it is listed
  as a follow-up in §12.

**API:** the intelligence endpoints batch their queries per kind, so there is no N+1. Profitability
adds three batched queries and one `groupBy`.

**Dependencies:** no package was added, removed or upgraded.

- **`npm audit` on `main`:** 3 high, because `prisma` 7.10.1 pulls `effect` ≤ 3.22.0, which has a
  ReDoS advisory. It runs when the Prisma CLI parses config, not on user input. npm's only fix is
  a downgrade to `prisma` 6.12. Also 7 moderate, because `typescript-eslint` pulls a vulnerable
  `minimatch`; this is development only. Both belong in their own PR.
- **Dependabot PRs**, reviewed and **not merged**:
  - #150: minor and patch group, 23 updates;
  - #148 and #149: CodeQL action 4.39.4;
  - majors, each needing its own migration PR: #133 TypeScript 7, #134 `@eslint/js` 10,
    #136 ESLint 10, #135 `@types/node` 26 and #137 `@hookform/resolvers` 7.

## 12. Known limitations

- **Demo chronology.** The API stamps records with "now" (deal won, proposal accepted, invoice
  issued), while dates a person enters (project start, due dates, payment dates) can be in the
  past. Some screens therefore show visible inconsistencies:
  - "Project start 3 Nov" sits before "Became a client 24 Nov";
  - one paid invoice reads "issued 24 Nov, due 14 Nov".

  Two fixes are possible: back-dated issue on invoices, which is a business-rule change, or a
  seed clock that writes outside the workflow. Both need the owner's decision.

- **Trends span one month.** For the same reason, monthly charts and the period comparisons are
  mostly empty before November. They are correct for the data.
- **No completed project in the demo.** The demo dataset is pinned by spec §21 and `demo.test.ts`.
  Adding one changes that spec.
- **Relationship map labels** crowd around a busy centre. The list view is unaffected.
- **Dependency map labels** truncate long task titles; the list under the map shows them in full.
- **Gantt task markers** on the same day overlap.
- **Profitability is an estimate:** budget minus logged time at dated rates. It is not accounting
  profit, and it is understated where rates are missing, which the screen says.
- **Mobile dashboard performance:** 78 against 86 on `main` in the same lab conditions (§11).
  The cause is a larger font file, the strip's extra requests and more requests in all. Possible
  remedies are a font without the optical-size axis, or one combined endpoint for the strip. Both
  are follow-ups.
- **Sign-in layout shift in demo mode** (CLS about 0.45, the same on `main`). The demo accounts
  block appears after first paint. Reserving its space only when the server runs in demo mode
  would fix it. This is a follow-up.
- **Full-page screenshots:** the sticky sidebar ends at viewport height, and the phone's floating
  button sits where the viewport ended. Both are capture artifacts, not layout faults.

## 13. Critique rounds

- **Round 1** (redesign screens):
  - funnel labels collided with the bars;
  - monthly charts mixed currencies;
  - a screen-reader table widened the page at 360 px;
  - a Gantt tick was clipped.

  All fixed.

- **Round 2** (portal, zoom):
  - repeated empty text on the portal;
  - a decision link clashed with the proposal link;
  - axe found scroll-region and hidden-focus issues;
  - Client 360 overflowed by 9 px at 400% zoom.

  All fixed.

- **Round 3** (this pass, against the UI UX Pro Max checklist):
  - The executive strip said "last month" for the current month, and its margin note was
    ambiguous. Fixed.
  - Finance and Sales got 3 tiles in a 4-column grid, leaving holes. Fixed with balanced columns
    and an odd last tile that spans two columns.
  - Approved portal deliverables still said "please review by". Fixed: the line now shows the
    date they were shared.
  - The portal schedule showed status by colour alone. Fixed: planned milestones are hollow
    rings.
  - The strip's definition text was 11 px. Raised to 12 px.
  - The dependency map was empty in the demo. Fixed: 12 stored dependencies are now seeded
    through the API.
- **Round 4, measurement (Lighthouse, §11).** The executive strip caused layout shift on load:
  CLS 0.253 on mobile and up to 0.404 on desktop. Fixed with a placeholder grid in the role's
  final shape (`expectedTiles`, unit-tested per role). Two items stay open: the mobile score
  gap (8 points) and the pre-existing sign-in shift in demo mode, both in §12.

## 14. Skills and tools actually used

- **Skills invoked:**
  - UI UX Pro Max: critique checklist and searches for charts, colour-only status and text size;
  - Frontend Design;
  - Emil Kowalski design engineering;
  - dataviz.
- **Repository tooling:**
  - Vitest and Playwright (E2E, captures);
  - axe-core;
  - ESLint, Prettier, TypeScript;
  - the repository's backup, restore and Lighthouse scripts;
  - gitleaks in Docker;
  - `npm audit`.
- **Not used:** Impeccable, Graphify and Headroom are **not installed**. Accessibility, security
  and performance followed the repository's own checks; no separate skill packs were installed.

## 15. Owner acceptance checklist

- [x] Open the 1440 and 1920 viewport shots in the [screenshot index](final-signature-screenshots/README.md)
      and accept or reject the visual direction (forest shell, executive strip, map, portal).
      **Accepted by the owner on 25 Nov 2026.**
- [ ] Decide on demo chronology (§12): leave it, allow back-dated invoice issue, or a seed clock.
- [ ] Decide whether the demo should gain a completed project (changes spec §21).
- [ ] Approve pushing `feature/final-signature-release` and opening the PR (§17).
- [ ] After merge, approve tagging **v0.14.0** with the release notes (§16).
- [ ] Separately: the `npm audit` route (wait for Prisma or add an `effect` override) and each
      Dependabot major.
- [ ] Separately: Render and Neon accounts for the public demo.

## 16. Release notes (draft for v0.14.0)

> **ClientFlow v0.14.0: final signature**
>
> - **New look:** forest sidebar with grouped navigation, refined palette with measured contrast,
>   page titles and breadcrumbs.
> - **Executive strip:** the agency's position above the fold, per role. Each figure says how it
>   is counted and links to its records. Money is never added across currencies.
> - **Relationship map:** who and what connects to a client, from stored links only, with search,
>   zoom, a details panel and a list view.
> - **Client 360, pipeline Insights** (funnel, stage ageing, sources) and **delivery portfolio**
>   (timeline, health, open work per person).
> - **Project plan** with a Gantt and a dependency map.
> - **Finance trends** per currency and **estimated profitability** (finance and admins only).
> - **Client portal home:** decisions waiting, progress, schedule and balance.
> - **For developers:** five read-only endpoints (ADR-072). No migrations.
> - **Known:** in lab tests the mobile dashboard scores 78 against 86 for v0.13.0, because of a
>   larger font and more requests. Desktop is faster (98 against 92). See the report, §11.

## 17. Proposed PR (not opened, not pushed)

**Title:** Final signature release: agency and relationship intelligence. The body is in the
local scratch file `pr-body.md`. It summarises §2, §9 and §10. Push and PR creation wait for the
owner's approval.
