# ClientFlow

A secure **agency operations platform** for a single software & digital agency. It covers the path from lead → deal → versioned proposal → project handoff → tasks and deliverables → change requests → invoice tracking, plus an isolated client portal.

> **Status:** in active development, milestone by milestone. Nothing in this repository is production-ready. Each milestone report in [`docs/milestones/`](docs/milestones/) states exactly what was implemented, tested, not run or deferred.

- **Product source of truth:** [`CLIENTFLOW_MASTER_SPEC.md`](CLIENTFLOW_MASTER_SPEC.md)
- **Requirements traceability:** [`docs/REQUIREMENTS_TRACEABILITY.csv`](docs/REQUIREMENTS_TRACEABILITY.csv)
- **Architecture decisions:** [`docs/07_ARCHITECTURE_ADRS.md`](docs/07_ARCHITECTURE_ADRS.md)
- **Risks:** [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md)
- **Task tracking:** GitHub [milestones](../../milestones) and [issues](../../issues)

## Stack

React + TypeScript + Vite + React Router + TanStack Query · Express 5 + TypeScript + Zod · PostgreSQL + Prisma · server-side sessions · Vitest, Supertest, Playwright.

## Quick start (Windows PowerShell)

Setup instructions are added in M1 (`docs/16_WINDOWS_SETUP.md`).

## Security

Do not open public issues for vulnerabilities. Contact the maintainer privately. No real client data belongs in this repository: all seed data is fictional.
