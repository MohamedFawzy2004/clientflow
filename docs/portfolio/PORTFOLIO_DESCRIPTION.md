# Portfolio project description

Copy-ready texts in three lengths. They state only what the repository shows. ClientFlow has **no customers, no production deployment and no measured business impact**. All screenshots and demo data are fictional.

## Short (about 50 words)

**ClientFlow** is a full-stack operations platform for a small software agency, covering everything from the first lead to the last invoice. It includes a client portal that keeps each client's data apart. It is built in TypeScript with React 19, Express 5, PostgreSQL 17 and Prisma, and tested against a real database and in three browser engines. It is a portfolio project, built with an AI coding agent.

## Medium (about 150 words)

**ClientFlow** follows a small agency's work end to end: leads and follow-ups, a deals pipeline, proposals with exact totals and frozen, numbered versions, then projects, tasks, deliverables, priced change requests and invoice tracking. Clients see only their own organization's items in a separate portal.

The engineering focus is correctness and security:

- server-side sessions with two-step sign-in for administrators;
- a permission matrix test that tries every role against every protected API route;
- database triggers that freeze approved records;
- idempotent conversions and payments;
- encrypted, virus-scanned file uploads.

It is a TypeScript monorepo (React 19, Express 5, PostgreSQL 17, Prisma 7, Zod). It has integration tests on real PostgreSQL, Playwright end-to-end tests in Edge, Firefox and WebKit, and 71 recorded architecture decisions.

It is a portfolio project, not a product in customer use. The code was written with Claude Code (an AI coding agent) under milestone gates: I defined the requirements, reviewed each report and approved every merge.

## Long (portfolio page)

Use [`docs/21_PORTFOLIO_CASE_STUDY.md`](../21_PORTFOLIO_CASE_STUDY.md). It has the problem, the solution, screenshots, decisions, verified results, limits and my role.

## Tags

TypeScript · React 19 · Express 5 · PostgreSQL 17 · Prisma 7 · Zod · TanStack Query · Tailwind CSS 4 · Vitest · Playwright · Docker · GitHub Actions · RBAC · TOTP · OWASP ASVS (self-assessed)

## Links

- Repository: https://github.com/MohamedFawzy2004/clientflow
- Public demo: _not deployed yet_. Add the URL only after it is live and checked.
