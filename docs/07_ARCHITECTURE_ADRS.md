# Architecture Decision Records

Status values: `ACCEPTED`, `SUPERSEDED`, `PROPOSED`. Each ADR is reversible unless stated otherwise.

## ADR-001 — M1 includes bootstrap, login and sessions (ACCEPTED, 2026-10-24)

**Conflict:** `CLAUDE_CODE_START_HERE.md` puts owner bootstrap + sessions in M1, master spec §18 puts them in M2.
**Decision:** M1 ships CLI owner bootstrap, login/logout, server sessions, CSRF and contact-scoped authorization, because an authenticated lead path is impossible without them. Invitations, password reset, deactivation/session-revocation UI and the full permission matrix remain M2.

## ADR-002 — Opaque server sessions, hashed at rest (ACCEPTED)

Spec §11.1 excludes "homemade authentication tokens" but requires opaque server sessions.
**Decision:** 32 random bytes from `crypto.randomBytes` (256 bits, base64url) in an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie. Only the SHA-256 hash is stored in `sessions.token_hash`. Idle timeout 12 h, absolute lifetime 7 days, a new token is issued on every login, logout revokes the row. No JWTs. No custom cryptography.

## ADR-003 — Argon2id via `@node-rs/argon2` (ACCEPTED)

Prebuilt Windows/Linux/macOS binaries, no node-gyp toolchain needed. Parameters: memory 19 MiB, iterations 2, parallelism 1 (OWASP Password Storage Cheat Sheet minimum). Password policy: 12–128 characters, rejects a bundled list of common passwords. Unknown-email logins still run a dummy hash verification to equalize timing.

## ADR-004 — CSRF: session-bound synchronizer token + Origin check (ACCEPTED)

Every state-changing `/api/v1` request needs (a) an `Origin`/`Referer` in the configured allowlist and (b) an `X-CSRF-Token` header. For authenticated requests, the token is bound to the session row (`sessions.csrf_hash`). For the pre-session login request, the token is a signed double-submit cookie (`cf_csrf_pre`, HMAC-SHA256 using `CSRF_SECRET`). SameSite is defence in depth, never the only control.

## ADR-005 — Same-origin dev via Vite proxy, closed CORS (ACCEPTED)

The SPA calls `/api/*` on its own origin. In dev, Vite proxies it to the API, and in production a reverse proxy does the same. CORS is not enabled. Credentialed wildcard CORS is never used.

## ADR-006 — Money as integer minor units (ACCEPTED, implemented from M3/M4)

Stored amounts are `BigInt` minor units plus an ISO currency with an explicit exponent map (EGP=2, USD=2). Quantities use exact decimals (`decimal.js`). Floats are never used. Different currencies are never summed without an explicit FX source.

## ADR-007 — In-memory rate limiting for M1 (ACCEPTED, revisit before deploy)

`express-rate-limit` memory store, keyed by IP and by normalized email for login. This is only valid on a single API instance. A shared store (Postgres or Redis) is required before running more than one instance. Tracked in the risk register.

## ADR-008 — Prisma 7 with the pg driver adapter (ACCEPTED)

`prisma@7.10.x` (stable). The npm `latest` tag pointed to an 8.0 RC on 2026-10-24, so that version is explicitly avoided. The schema uses camelCase models mapped to snake_case tables and columns. Check constraints and composite cross-agency foreign keys are added as hand-written SQL inside the migration.

## ADR-009 — Contact visibility in M1 (ACCEPTED, revisit M6/M9)

OWNER, ADMIN and SALES_MANAGER see all agency contacts. SALES sees contacts it owns. PM, MEMBER and FINANCE are denied (403 on list). The spec's "PM linked" and "FINANCE billed customer" scopes need projects and invoices, so they are deferred. A by-ID request for a contact outside the caller's scope returns **404** with no detail.

## ADR-010 — No public signup; dev users via guarded seed (ACCEPTED)

The owner is created only by `npm run bootstrap:owner` (CLI). Additional local users come from `npm run seed:dev`, which refuses `NODE_ENV=production`, writes fictional data only, and stores generated passwords in a gitignored `apps/api/.dev-credentials.local.json`. Default credentials are never shipped.

## ADR-011 — npm workspaces monorepo (ACCEPTED)

The spec expects `package-lock.json`. Layout: `apps/api`, `apps/web`, `packages/contracts`, with `prisma/` at the root. Node 24 LTS is pinned via `.nvmrc` and `engines`.

## ADR-012 — Public GitHub repository for transparency (ACCEPTED, owner request 2026-10-24)

The project owner asked for the code and task tracking to be public on GitHub. Consequences: no secrets or real client data in the repo (enforced via `.gitignore` and `.env.example` placeholders), commits use the GitHub noreply address, and the backlog is tracked as GitHub milestones and issues linked to requirement IDs.
