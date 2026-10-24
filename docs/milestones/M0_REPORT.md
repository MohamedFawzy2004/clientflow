# ClientFlow Milestone M0 Report — Discovery & baseline

**Date:** 2026-10-24 · **Status:** COMPLETE (documentation only, no product code)

## Workspace audit (commands run on the owner's Windows 11 machine)

| Check | Result |
|---|---|
| Workspace | Fresh folder: only `CLIENTFLOW_MASTER_SPEC.md`, not a git repository |
| `node --version` | v24.19.0 (LTS, inside Prisma's `^24.11.0` engines range) |
| `npm --version` | 11.17.0 (pnpm 11.24.0 also present, not used) |
| `git --version` | 2.45.1.windows.1 |
| `docker --version` / `docker compose version` | 29.9.2 / v5.6.1. The daemon was **not running** at audit time, so Docker Desktop was started |
| `psql` | Not installed (not required: `docker exec` is used) |
| Ports 5433 / 4000 / 5173 | Free |
| `REQUIREMENTS_TRACEABILITY.csv` | Not supplied, so it was **generated** from the spec |

## Outputs

- `docs/REQUIREMENTS_TRACEABILITY.csv`: 199 rows (89 FR, 25 SEC, 10 AI-SEC, 15 NFR, 24 US, 36 test cases), each with phase, milestone and status.
- `docs/07_ARCHITECTURE_ADRS.md`: ADR-001…012, including the resolved conflicts.
- `docs/RISK_REGISTER.md`
- `docs/specification/`: copy of the execution contract. The master spec stays at the repo root.
- Public GitHub repository with milestones M0–M13 and tracking issues (see the README).

## Conflicts found and resolved

1. Bootstrap/sessions in M1 (start-here) vs M2 (spec §18): ADR-001.
2. "No homemade auth tokens" vs opaque hashed sessions: ADR-002.
3. Contact scopes for PM/FINANCE depend on later modules: ADR-009.

## Blocking questions

None for M1. Before M7 and M9, the owner must decide on a storage/email provider, invoice tax rules, and whether client acceptance is contractually binding (spec §28).
