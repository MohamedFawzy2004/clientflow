# ClientFlow

A secure **agency operations platform** for a single software & digital agency. It covers the path from lead → deal → versioned proposal → project handoff → tasks and deliverables → change requests → invoice tracking, plus an isolated client portal.

> **Status: M2 (identity & policy) complete on `feat/m2-identity-policy`, stacked on M1.** Owner bootstrap, invitations, password reset, team management, a declarative permission matrix and scoped lead management run on real PostgreSQL. 131 API, 33 UI and 12 end-to-end tests pass locally and in GitHub Actions CI. Nothing here is production-ready yet; see each milestone report.

![Team page at 1440px](docs/milestones/m2-screenshots/team-1440.png)

## What works today (M1 + M2)

- CLI-only owner bootstrap (refuses a second run). No public sign-up.
- Email + password sign-in with Argon2id, hashed server sessions, idle and absolute expiry, logout revocation, CSRF + Origin checks, login throttling.
- Leads: add, list (search, filter, pagination), detail with activity. Salespeople see only their own leads; managers see the whole agency. Enforced on the server and tested with direct API calls.
- Team page: invite by email with one-time links, change roles, deactivate/reactivate, sign out everywhere. The last owner can never be removed.
- Forgot/reset password with single-use 30-minute links. Development emails go to a local sink, never sent.
- Offline breached/weak password check (zxcvbn-ts).
- Responsive UI from 360px to 1920px, with keyboard support and axe checks.
- CI on every push: lint, typecheck, dependency audit, tests on Postgres, Playwright E2E, build, secret scan.

## Docs

- **Product source of truth:** [`CLIENTFLOW_MASTER_SPEC.md`](CLIENTFLOW_MASTER_SPEC.md)
- **Windows setup:** [`docs/16_WINDOWS_SETUP.md`](docs/16_WINDOWS_SETUP.md)
- **Milestone reports:** [M1](docs/milestones/M1_REPORT.md) · [M2](docs/milestones/M2_REPORT.md)
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
