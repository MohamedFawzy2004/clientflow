# Case study: ClientFlow

**An operations platform for a small software and digital agency: from the first lead to the last
invoice, with a client portal that keeps every client's data apart.**

![Dashboard of the demo workspace, 1440 px](portfolio/screenshots/dashboard-1440.png)

## The problem

Small agencies run on a patchwork: leads in a spreadsheet, quotes in documents, approvals in chat,
tasks in one tool and invoices in another. Three things go wrong again and again:

1. **Follow-ups slip.** Nobody sees which lead was promised a call yesterday.
2. **Scope creeps unpaid.** "Small" extra requests are done without a price or an approval.
3. **Approvals cannot be proven.** "Which version did the client accept?" has no reliable answer.

ClientFlow puts the whole path in one place and makes those three things visible and provable.

## What it does

```
Lead → Deal → Proposal (internal approval → client decision in the portal)
     → Project (tasks, time, deliverables, change requests)
     → Invoices and payments
```

| For               | They get                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Sales             | Leads with follow-up queues, a pipeline board, proposals with exact totals and numbered, frozen versions    |
| Sales managers    | Approval before anything reaches a client, team dashboard, CSV export and import                            |
| Project managers  | One-step, duplicate-proof handoff from won deal to project; task board; change requests priced and approved |
| Team members      | Their tasks and time, encrypted file uploads, deliverables with client feedback                             |
| Finance           | Invoices numbered on issue, partial payments with reversals, finance report per currency                    |
| Clients           | A portal with only their own proposals, shared projects, deliverables and invoices                          |
| Owners and admins | Team, roles, settings, system status and an audit trail; backup and restore commands                        |

| Sales pipeline                                                | Project task board                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![Deals board, 1440 px](portfolio/screenshots/deals-1440.png) | ![Task board, 1440 px](portfolio/screenshots/task-board-1440.png) |

| Client portal: a shared project                                           | The same screen on a phone (360 px)                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![Portal project, 1440 px](portfolio/screenshots/portal-project-1440.png) | ![Portal project, 360 px](portfolio/screenshots/portal-project-360.png) |

All screenshots show the **fictional demo workspace** (`npm run demo:reset`). No real client data
was ever used.

## How it was built

- **Stack:** TypeScript end to end. Express 5 API, PostgreSQL 17 through Prisma 7, React 19 with
  TanStack Query and Tailwind 4, Zod schemas shared by the API and the web app. One container serves
  both.
- **Milestones with gates.** Twelve milestones (M1–M12, plus M12.1), each a vertical slice from database to screen. Each
  ended with an honest report (implemented / tested / not run / failed), a traceability update, a
  pull request with CI, and an explicit go-ahead from the owner before the next started.
- **Tests that attack the API, not just the screens.** Every role is tried against every protected endpoint
  (the route inventory test fails the build if a route is missing from the matrix) to prove that hidden buttons are never the only protection. Integration tests run on
  real PostgreSQL; end-to-end tests drive real browsers with accessibility checks and a 360 px
  overflow check on every main screen.
- **The demo is built by the product itself.** `demo:reset` creates its data through the real API:
  people accept invitations, managers approve proposals, clients decide in the portal. So the demo
  can never show a state the product cannot reach.

## Engineering decisions worth a closer look

71 decisions are recorded in [`07_ARCHITECTURE_ADRS.md`](07_ARCHITECTURE_ADRS.md). A few that shaped
the product:

| Decision                                                                                             | Why                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Server sessions (hashed opaque tokens) instead of JWTs                                               | Instant revocation on sign-out or deactivation; nothing secret in the browser |
| A record outside your scope answers **404**, not 403                                                 | Users cannot discover what exists elsewhere                                   |
| Sent proposal versions, change versions, issued invoices and payments are frozen **in the database** | Approvals stay provable even if the API had a bug                             |
| A client decision carries the hash of the exact version shown                                        | "Which version did they accept?" always has one answer                        |
| Money as integer minor units with a currency, never summed across currencies                         | No rounding drift; no meaningless EGP + USD totals                            |
| Idempotency keys on project conversion, invoices and payments                                        | A double-click or retry never creates a second project or payment             |
| Transactional outbox for email and reminders                                                         | No email for a change that rolled back; retries without duplicates            |
| Extra work must point to an accepted change request, or carry a written reason                       | Scope creep becomes visible instead of silent                                 |
| Files encrypted per file (AES-256-GCM), downloaded via 5-minute links bound to the user              | A leaked folder or link is not enough to read client work                     |
| Compress static files only, never API JSON                                                           | Avoids the BREACH side channel                                                |
| Public demo: password-less "Explore as" per role, server-side demo guard, rebuilt on every start     | A free, safe public demo with no published passwords and no lasting changes   |

## Results

Measured on 2026-11-04 at commit `268c997` on one Windows laptop. The full record, including what
failed and what was not run, is the [Release Quality Passport](27_RELEASE_QUALITY_PASSPORT.md).

| Measure                       | Result                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Automated tests               | API 416 passed (1 skipped) on real PostgreSQL · web 95 · end-to-end 77 in each of Edge, Firefox, WebKit |
| Demo tour                     | Every role in three engines: 27 passed                                                                  |
| Role × route checks           | Every role against every protected route; a route inventory keeps the matrix complete                   |
| Screen widths                 | 360 to 1920 px plus 200% and 400% zoom, without page-level sideways scrolling                           |
| Local production-like staging | HTTPS via Caddy, real ClamAV, non-superuser database role: 28 checks passed, 1 skipped (proxy)          |
| Restore drill                 | 46 tables and every stored file reconciled into an empty database                                       |
| API speed (local, 10 users)   | p95 33–147 ms for reads, 64 ms for writes                                                               |
| Lighthouse (lab, mobile)      | Sign-in 91; dashboard 86, below the 90 target (desktop 99)                                              |
| What the audit caught         | A WebKit-only race in a test helper and a route missing from the route inventory, both fixed            |

## Limits, stated plainly

- **Not in customer use and not deployed.** Local production-like staging (HTTPS, Postgres, ClamAV) is
  verified; the free public demo and the paid pilot staging are configured, not applied.
- **No real users have tested it yet.** The pilot plan is ready ([`22_PILOT_PLAN.md`](22_PILOT_PLAN.md)).
- **Security is self-assessed:** threat model, a limited ASVS map and automated scanners. No external
  penetration test or certification. Two-step sign-in is TOTP, which is not phishing-resistant.
- **Accessibility:** automated axe checks, keyboard tests and zoom/reflow checks pass; a
  screen-reader session has not been done.
- **Capped lists:** projects, proposals and portal invoices show at most 200 rows, invoices and tasks 500, with no
  paging yet (QA finding Q1).
- **Not accounting software and not e-signature:** invoices are tracked operationally, and a client
  acceptance is an operational approval, not a legal signature.
- Measurements come from one Windows laptop, not a hosted environment.

## My role

I defined the product and its rules, set the milestone gates, reviewed each report and decided what
shipped, what waited and which trade-offs to accept. The code, tests and documents were written with
**Claude Code** (an AI coding agent) working under those gates: nothing was merged without passing
tests and my approval. The commit history and the milestone reports show every step, including what
failed and how it was fixed.

## Try it

```bash
npm ci
npm run db:up
DEMO_MODE=true npm run demo:reset -- --confirm clientflow_demo   # with DATABASE_URL set to the demo database
npm run demo:tour   # uses DEMO_DATABASE_URL; walks every role in three browser engines
```

See the [Windows setup](16_WINDOWS_SETUP.md), the [user guides](guides/README.md) and the
[deployment guide](17_DEPLOYMENT.md#demo-workspace).
