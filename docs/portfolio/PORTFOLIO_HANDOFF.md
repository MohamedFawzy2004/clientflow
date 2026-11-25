# ClientFlow: portfolio handoff

This is the one page to read before showing ClientFlow to anyone. It covers how to start the demo,
a 3 to 5 minute walkthrough, what to say about the numbers, and what not to claim.

ClientFlow is a CRM and delivery tool for small service agencies. It covers the path from lead to
signed proposal, project, tracked time, invoice and client portal. Each person sees only what their
role allows. Every amount stays in its own currency.

The release record is
[FINAL_CLOSURE_REPORT.md](../milestones/FINAL_CLOSURE_REPORT.md). The design story is the
[case study](../21_PORTFOLIO_CASE_STUDY.md).

## 1. Start the demo locally (Windows, PowerShell)

The prerequisites are Node 22, Docker Desktop and the repository cloned with `npm ci` already run.
[`docs/16_WINDOWS_SETUP.md`](../16_WINDOWS_SETUP.md) has the full setup.

```powershell
npm run db:up
```

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:5433/clientflow_demo"; npm run db:migrate
```

```powershell
$env:DEMO_MODE = "true"; npm run demo:reset -- --confirm clientflow_demo
```

```powershell
$env:DEMO_MODE = "true"; npm run dev
```

Open `http://localhost:5173`. The sign-in page shows one **Explore as …** button per role, so you
never type or publish a password. `demo:reset` refuses any database whose name does not contain
`demo`.

**To reset between viewers,** run the `demo:reset` line again. It rebuilds the whole fictional
agency through the real API in about a minute, dated to the day of the reset.

**To check the demo still works end to end:**

```powershell
npm run demo:tour
```

This runs 27 steps across every role in three browser engines.

## 2. Demo script (about 4 minutes)

Every person, company and amount below is fictional.

| Time | Sign in as | Go to                               | Show and say                                                                                                                                                                                            |
| ---- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | (none)     | Sign-in page                        | "Demo mode: one button per role, no shared password." The page does not shift while it loads                                                                                                            |
| 0:15 | Owner      | Dashboard                           | The executive strip: open pipeline, won, win rate, cash received, outstanding, estimated margin. Each tile states its rule and links to its records. EGP and USD are never added together               |
| 0:45 | Owner      | Dashboard, scroll down              | Next conversations, follow-up load, pipeline, won by month and lead sources. All of it comes from one scoped server read                                                                                |
| 1:05 | Owner      | Relationship map, then click a node | Only stored links are drawn. Click a client to open its details sheet. Switch to **List** for the same graph as text                                                                                    |
| 1:30 | Owner      | Client 360 (a client's page)        | Deals, proposals, projects, invoices and follow-ups on one page                                                                                                                                         |
| 1:50 | Owner      | Deals → Board, then **Insights**    | Drag a deal between stages, or move it with the keyboard. Insights shows the funnel, time in stage and lead sources                                                                                     |
| 2:20 | PM         | Delivery, then a project → **Plan** | Portfolio health, then the milestone timeline. Tasks due the same day are drawn once with a count. Switch to **Agenda** (the default on a phone). The dependency map shows the blocked pickup-slot task |
| 3:00 | Finance    | Finance report                      | Invoiced and received per month, per currency, ageing, and the profitability waterfall: signed budget → accepted changes → time cost → margin                                                           |
| 3:30 | Client     | Portal                              | What waits on the client, milestone progress and open balance. No costs, margins, internal notes or staff-only tasks appear here                                                                        |
| 3:50 | Sales      | Deals → Insights                    | The same view, limited to the rep's own deals and leads. Close by pointing out that permissions apply on the server, not just in the interface                                                          |

**On a phone** (or at 390 px in browser dev tools): the sidebar becomes a drawer, the dashboard
leads with the KPI strip, the map has zoom, pan and a list, deals have board and list views, and
the plan opens on the agenda. Nothing is removed on mobile.

## 3. Numbers you may quote

All numbers are **local lab data** from one Windows 11 laptop, not field data from real users.
Say so whenever you quote one. The figures and method are in the closure report §4.

- Tests on the release candidate: API integration on real PostgreSQL, web component tests,
  end-to-end tests in Edge, Firefox and WebKit, and the demo tour. The counts are in the closure
  report §5.
- Lighthouse, median of 5 runs: dashboard **78 on mobile** (range 75–82; **the target of 90 was
  not reached**) and **99 on desktop**; the demo sign-in page 85 on mobile, with no layout shift.
  The signature build before this work scored 72 and 98, with 28 API calls on the dashboard
  against 13 now. Quote the measured values, not the targets.
- Demo tour: 27 passed across every role in Edge, Firefox and WebKit. End-to-end: 82 · 82 · 83.
- `npm audit --omit=dev`: 0 vulnerabilities on the candidate. gitleaks found no leaks.

## 4. What not to claim

- **Not deployed and not publicly hosted.** The free Render and Neon plan is configured but waits
  on the owner's accounts. There is no live URL, uptime record or hosted monitoring.
- **Not production ready.** There has been no pilot with real users, no external penetration test
  and no human screen-reader session. iOS Safari on a real device was not tested; WebKit in
  Playwright is the closest check run.
- **No field Core Web Vitals.** Lighthouse figures are lab simulations.
- **Not accounting software and not an e-signature tool.** Invoices are tracked. A client's
  acceptance is an operational approval, not a legal signature.
- **The demo history is short.** The demo is built on the day of each reset, so monthly trends
  are mostly empty before that day, no project is completed and no invoice is overdue (every
  invoice is issued on the reset day). Closure report §6 explains why this was not faked.
- **Skills and tools:** list only the ones named in the closure report §10. Impeccable, Graphify
  and Headroom were not available and were not used.

## 5. Where things are

| Need                        | File                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Release record and verdicts | [`docs/milestones/FINAL_CLOSURE_REPORT.md`](../milestones/FINAL_CLOSURE_REPORT.md)                                                 |
| Screenshots (real captures) | [`docs/milestones/final-closure-screenshots/`](../milestones/final-closure-screenshots/)                                           |
| Case study                  | [`docs/21_PORTFOLIO_CASE_STUDY.md`](../21_PORTFOLIO_CASE_STUDY.md)                                                                 |
| Design system               | [`docs/design/redesign/01_DESIGN_SYSTEM.md`](../design/redesign/01_DESIGN_SYSTEM.md)                                               |
| Architecture and ADRs       | [`docs/25_ARCHITECTURE_OVERVIEW.md`](../25_ARCHITECTURE_OVERVIEW.md), [`docs/07_ARCHITECTURE_ADRS.md`](../07_ARCHITECTURE_ADRS.md) |
| Threat model and risks      | [`docs/11_THREAT_MODEL.md`](../11_THREAT_MODEL.md), [`docs/RISK_REGISTER.md`](../RISK_REGISTER.md)                                 |
| Hosting plan (not applied)  | [`docs/24_STAGING_AND_DEMO.md`](../24_STAGING_AND_DEMO.md)                                                                         |
