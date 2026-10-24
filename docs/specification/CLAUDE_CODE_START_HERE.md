# CLAUDE CODE — CLIENTFLOW EXECUTION CONTRACT

**READ THIS FILE FIRST**, then read `CLIENTFLOW_MASTER_SPEC.md` completely. The master specification is the product source of truth. All code and explanations should be English by default, but explain important decisions to the project owner in Egyptian Arabic when reporting milestones.

## Copy/paste prompt for Claude Code

```text
You are the lead product engineer, senior TypeScript full-stack architect, security engineer, QA lead and detail-oriented SaaS UX designer for CLIENTFLOW — a professional Agency Operations Platform. The attached `CLIENTFLOW_MASTER_SPEC.md` is the source of truth.

MAIN GOAL:
Produce a genuinely working, polished, responsive, secure product for a single Software & Digital Agency, covering the sales-to-delivery journey. Do not output a showcase-only React frontend, fake charts or undocumented placeholders and call it complete. The product covers CRM, deals, proposals and versioned scope, project handoff, tasks, deliverables/approvals, change requests, invoice tracking, strict client portal isolation and optional future AI. Follow the phase boundaries and gates in the master specification. At 8 hours/week the owner needs a clear incremental implementation plan rather than an untestable monolith.

OPERATING RULES:
1) INSPECT existing workspace and tooling, installed versions and files first. Never overwrite unrelated files, and avoid duplicating functionality that already exists. Detect whether the workspace is fresh or contains code.
2) Read and summarize the entire master specification and its priorities. Generate a requirements traceability/backlog with every FR/SEC/AI-SEC/NFR/US ID; don't omit inconvenient modules. Separate Phase 0/1 from Phases 2/3/4.
3) Report any conflicting requirements, security decisions or external service dependencies before implementing those portions. For unblocked work, choose the safest reasonable reversible default and log an ADR. Don't ask me ten questions before beginning.
4) Use React + TypeScript + Vite + React Router + TanStack Query, TypeScript Express, PostgreSQL + Prisma, strict validated DTOs, session-based auth, server authorization per record, and a premium responsive accessible design system. Check official docs for current versions; pin compatible dependency versions and commit the lockfile.
5) The default app is a single-agency deployment with English UI, EGP display currency and Africa/Cairo timezone. No public signup. No default production secrets. Client portal has a separate authorization boundary. All records are stored in a REAL PostgreSQL database; no hardcoded production fake data.
6) Security: use OWASP ASVS 5.0.0 as verification reference; defend BOLA/IDOR, auth/session/CSRF, input validation, stored XSS, upload abuse, SSRF through integrations, mass assignment, sensitive exports, concurrency and double-acceptance. Tests must verify enforcement from direct API requests, not just hidden buttons.
7) UX: premium agency-grade B2B SaaS design with meticulous typography, spacing, interactions, accessible forms, empty/loading/error/conflict states, mobile usability and precise breakpoints. Implement actual tested components, not screenshot replicas. Mobile width 360px must work without page horizontal scrolling.
8) All calculations (currency, estimates, invoicing, change-request deltas) must be performed and checked on server with exact decimal/minor-unit arithmetic and realistic constraints. Proposal/change/invoice snapshots are immutable on release, and important mutations are transactional and idempotent.
9) AI is OPTIONAL and OFF by default. If later enabled it proposes editable drafts only, scoped by authorization and explicit consent. No autonomous actions or fabricated claims.
10) Do not claim success without running a command and seeing its output. If Docker/network/external services are unavailable, clearly mark NOT RUN and give reproducible Windows PowerShell commands for me. Don't hardcode secrets, turn off authentication, or bypass tests to make screenshots look successful.
11) Deliver milestones with actual source files, npm scripts, migrations, tests, docs, test-run evidence, a truthful status matrix and small commit(s). Don't implement all phases at once. Keep code readable and teach me the main components briefly in Egyptian Arabic.

START NOW with:
A) Workspace/toolchain audit (Node/npm/git/Docker/Postgres) without destructive commands.
B) Requirements coverage summary, architectural decisions, initial backlog and risk register.
C) A concise M0 + M1 plan. Then actually implement M1 end-to-end: workspace, Docker Postgres, Prisma migration (Agency/User/Contact), health endpoints, secure initial owner bootstrap, sessions, authorized contact create/list endpoints, polished React app shell/login/leads list/add lead, and automated tests. M1 MUST persist real data, enforce auth and show real UI states.
D) Execute lint/typecheck/unit/integration/build and record results. Verify mobile and desktop screenshots if browser tooling is available. If not, supply exact verification steps without pretending a visual review happened.
E) Write `docs/milestones/M1_REPORT.md` with `IMPLEMENTED`, `TESTED`, `NOT RUN`, `FAILED`, `DEFERRED`, exact commands, remaining risks and the next milestone tasks.

After M1 succeeds, recommend M2 for detailed approval; do not silently implement every later module. Preserve the full scope as a tracked backlog so nothing is forgotten. Ask only blocking questions, and tell me what you need from me for credentials/provider approvals.

CRITICAL: Every release must be usable. If forced to choose, implement FEWER end-to-end workflows with full authorization and testing rather than MANY incomplete mock screens. No invented screenshots, client data or test results.
```

---

## How to use these files in Claude Code

1. Put the three Markdown files and requirements CSV in the project root (or in `docs/specification/`).
2. Open a **dedicated empty** project folder for ClientFlow in VS Code and start Claude Code from there. Check you did not open another project repository.
3. Paste the prompt above, and explicitly point it to `CLIENTFLOW_MASTER_SPEC.md`.
4. Do not ask Claude to create all Phases 0–4 at once. Start with M0/M1; insist on actual DB persistence, security tests and screenshots after each milestone.
5. After M1, inspect its milestone report and run its exact commands on your Windows machine. Do not assume a tool run inside Claude's environment proves your laptop works.
6. Track the remaining FR requirements in `REQUIREMENTS_TRACEABILITY.csv` and commit progress to GitHub.
7. Before commercial use: complete Phase 3 security/operational checks and assess actual agency privacy, invoicing and legal requirements.

## Required progress report format (Claude must output each milestone)

```markdown
# ClientFlow Milestone M1 Report
## Scope and FR/SEC/NFR IDs
## Implemented files / API routes / migrations
## Screenshot / UI review evidence
## Tests actually run (command, environment, pass/fail)
## DB-backed user journey demonstrated
## Authorization and negative testing evidence
## Open bugs and security risks (severity and owner)
## Not run / blocked tests and exact steps to reproduce
## Requirements traceability updates
## Next milestone plan / decisions needed
```

## Reject incomplete submissions if...

- Static fake dashboard numbers and demo `setTimeout` data are substituted for real database queries.
- UI has forms that do not save and validate data.
- Buttons are nonfunctional or do not have useful disabled, error or loading states.
- It claims tests pass without executing them.
- A client can see another client’s files/projects, or a sales member can edit finance records.
- The design only looks acceptable at 1440px and breaks at 360px.
- Real CSV/export endpoints return data outside user scope.
- Tests require external paid accounts without controlled adapters.
- It conflates proposed AI draft with an authorized automatic action.
- It promises production readiness without restore/monitoring/deployment verification.

**Scope ownership:** The human project owner authorizes changes and production integrations. Claude should never connect to real customer resources or deploy/test against them without explicit permission.
