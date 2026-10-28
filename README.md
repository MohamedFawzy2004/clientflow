# ClientFlow

A secure **agency operations platform** for a single software & digital agency. It covers the path from lead → deal → versioned proposal → project handoff → tasks and deliverables → change requests → invoice tracking, plus an isolated client portal.

> **Status: M12 (commercial/portfolio release) complete on `feat/m12-release`, stacked on M1–M11.** A fictional demo workspace with a user for every role is built through the real API (`npm run demo:reset`, which refuses any non-demo database). User guides for each role, a case study, a threat model, a limited ASVS map and a release checklist are in `docs/`. The full end-to-end suite passes in Edge, Firefox and WebKit. **Not deployed yet**, and no real users have tested it: hosting, email provider, retention periods, a legal review and the pilot sessions are the owner's decisions.

![Dashboard of the demo workspace at 1440px](docs/milestones/m12-screenshots/dashboard-1440.png)

## What works today (M1 to M12)

- CLI-only owner bootstrap (refuses a second run). No public sign-up.
- Email + password sign-in with Argon2id, hashed server sessions, idle and absolute expiry, logout revocation, CSRF + Origin checks, login throttling.
- Leads: add, edit, archive/restore, convert to customer, reassign, and a timeline of notes, calls, emails and meetings. Filters for owner, source and follow-up state. Salespeople see only their own leads; managers see the whole agency. Enforced on the server and tested with direct API calls.
- Deals: a pipeline board (drag and drop, or a keyboard-friendly stage menu) and a list view. Amounts are exact, with totals kept per currency. Stale edits are refused (409). Won/lost need a reason, and closing twice records one event.
- Follow-ups: overdue, due today, upcoming and no-next-step queues in the agency timezone.
- Proposals: a service catalog, drafts with exact totals (14% VAT by default, every step explained), internal review before sending, and numbered versions that cannot change once submitted.
- Client portal: invite people at a customer to their own portal. They see only what was sent to their organization and accept, decline or ask for changes. Accepting wins the deal. It is recorded as operational approval, not an e-signature.
- Dashboard: pipeline, wins, win rate, proposals and follow-ups for a date range, per currency; managers filter by owner and export deals to CSV. Reminders show what is overdue or waiting on you.
- Projects: convert a client-accepted deal into a project in one safe step (retries never create duplicates), with the accepted scope as baseline, milestones, a handoff checklist, a team and project states. PMs and members see only their projects; sales see theirs read-only.
- Delivery: a task board (status select on every card, no drag needed), dependencies without loops, assignees who move only their own tasks, and time entries (members see their own, the manager sees all).
- Files: uploads are checked by type, file signature, active content and size, stored encrypted, and downloaded through 5-minute links bound to the user.
- Deliverables: private until the project manager publishes a version; the client approves, asks for a revision or rejects with a reason, once per version. History cannot be changed.
- Client portal for projects: shared per person; clients see status, milestones and published deliverables only, and anything else is a logged "not found".
- Scope changes: change requests from the client or the PM, priced estimates with internal approval, client accept/reject on a frozen version, and an atomic baseline update on acceptance. Extra work needs an accepted change or a written exception.
- Invoice tracking: drafts with exact totals, issued snapshots numbered INV-0001…, client-portal publishing, partial payments with reversals (Finance and Owner only), project money and estimated margin, a finance report per currency with aging, and CSV export.
- Automation: notification center and settings, background worker (`npm run jobs:once`, `npm run jobs:worker`; runs inside the API by default), scheduled reminders, and CSV import of contacts and deals with preview and undo.
- Operations: shared sign-in limits, verified backup and restore, readiness with job lag, system status, image scanning (see `docs/17_DEPLOYMENT.md`).
- Comments on deliverables and changes, shared by the team and the client, with edit history.
- Proposal PDFs, agency settings (profile, currency, timezone, working days).
- Team page: invite by email with one-time links, change roles, deactivate/reactivate, sign out everywhere. The last owner can never be removed.
- Forgot/reset password with single-use 30-minute links. Development emails go to a local sink, never sent.
- Offline breached/weak password check (zxcvbn-ts).
- Responsive UI from 360px to 1920px, with keyboard support and axe checks.
- Demo workspace: `npm run demo:reset -- --confirm <demo database>` builds the spec §21 demo set (9 staff, 3 client organizations, proposals, projects, invoices) through the real API, and every page says it is a demo. `npm run demo:tour` walks each role in Chromium, Firefox and WebKit.
- CI on every push: lint, typecheck, dependency audit, tests on Postgres, Playwright E2E, build, secret scan.

## Docs

- **Product source of truth:** [`CLIENTFLOW_MASTER_SPEC.md`](CLIENTFLOW_MASTER_SPEC.md)
- **Windows setup:** [`docs/16_WINDOWS_SETUP.md`](docs/16_WINDOWS_SETUP.md)
- **Deployment (not done yet):** [`docs/17_DEPLOYMENT.md`](docs/17_DEPLOYMENT.md)
- **User guides:** [`docs/guides/`](docs/guides/README.md) (Owner/Admin, sales, delivery, finance, client portal)
- **Case study:** [`docs/21_PORTFOLIO_CASE_STUDY.md`](docs/21_PORTFOLIO_CASE_STUDY.md)
- **Release checklist:** [`docs/15_RELEASE_CHECKLIST.md`](docs/15_RELEASE_CHECKLIST.md) · **pilot plan:** [`docs/22_PILOT_PLAN.md`](docs/22_PILOT_PLAN.md)
- **Security:** [threat model](docs/11_THREAT_MODEL.md) · [limited ASVS map](docs/12_ASVS_CHECKLIST.md) · [privacy and retention](docs/18_PRIVACY_RETENTION.md) · [runbook](docs/19_RUNBOOK.md)
- **Data model:** [`docs/08_DATABASE_ERD.md`](docs/08_DATABASE_ERD.md)
- **Milestone reports:** [M1](docs/milestones/M1_REPORT.md) · [M2](docs/milestones/M2_REPORT.md) · [M3](docs/milestones/M3_REPORT.md) · [M4](docs/milestones/M4_REPORT.md) · [M5](docs/milestones/M5_REPORT.md) · [M6](docs/milestones/M6_REPORT.md) · [M7](docs/milestones/M7_REPORT.md) · [M8](docs/milestones/M8_REPORT.md) · [M9](docs/milestones/M9_REPORT.md) · [M10](docs/milestones/M10_REPORT.md) · [M11](docs/milestones/M11_REPORT.md) · [M12](docs/milestones/M12_REPORT.md)
- **Requirements traceability:** [`docs/REQUIREMENTS_TRACEABILITY.csv`](docs/REQUIREMENTS_TRACEABILITY.csv)
- **Architecture decisions:** [`docs/07_ARCHITECTURE_ADRS.md`](docs/07_ARCHITECTURE_ADRS.md)
- **Risks:** [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md)
- **Task tracking:** GitHub [milestones](../../milestones) and [issues](../../issues)

## Stack

React 19 + TypeScript + Vite + React Router + TanStack Query + Tailwind CSS 4 · Express 5 + Zod 4 · PostgreSQL 17 + Prisma 7 · Vitest, Supertest, Testing Library, Playwright + axe.

## Quick start (Windows PowerShell)

```powershell
npm ci
Copy-Item .env.example .env   # then replace every placeholder (see docs/16_WINDOWS_SETUP.md)
npm run db:up
npm run db:migrate
npm run bootstrap:owner -- --agency "Your Agency" --name "Your Name" --email you@youragency.com
npm run dev                    # http://localhost:5173
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:web`, `npm run e2e`, `npm run build`.

## Security

Do not open public issues for vulnerabilities. Contact the maintainer privately. No real client data belongs in this repository: all seed and test data is fictional.
