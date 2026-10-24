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

Every state-changing `/api/v1` request needs (a) an `Origin`/`Referer` in the configured allowlist and (b) an `X-CSRF-Token` header. For authenticated requests, the token is `HMAC-SHA256(CSRF_SECRET, session token hash)`. It is bound to the session, never stored, and can be re-served by `GET /auth/csrf` after a page reload. (Implementation note: the first draft planned a stored `csrf_hash` column, which became unnecessary.) For the pre-session login request, the token is a signed double-submit cookie (`cf_csrf_pre`, nonce + HMAC). SameSite is defence in depth, never the only control.

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

## ADR-013 — Test databases are migrated, never reset by tooling (ACCEPTED, 2026-10-24)

Prisma 7 refuses `migrate reset` when it detects an AI agent, unless the user gives explicit consent. That is a good guard. Tests do not need a reset anyway: `npm test` runs the non-destructive `prisma migrate deploy` on `clientflow_test`, and each test file empties its tables with `TRUNCATE` (which also skips the audit append-only trigger, as intended for disposable data). E2E uses a third database, `clientflow_e2e`. `scripts/with-test-db.mjs` refuses to run if the test URL equals `DATABASE_URL`.

## ADR-014 — Automation starts the API without `tsx watch` (ACCEPTED, 2026-10-24)

On Windows, `tsx watch` stalled silently when spawned by non-terminal parents (the Playwright `webServer` and the desktop preview launcher), while the same command works in a terminal. Automation therefore uses `npm run dev:once -w @clientflow/api` (plain `tsx`). Interactive development keeps `npm run dev` with watch mode. Revisit when tsx is upgraded.

## ADR-015 — Dialogs own initial focus and focus return (ACCEPTED, 2026-10-24)

Radix Dialog returns focus only to its own `Trigger`, but ClientFlow opens dialogs from ordinary buttons (header and mobile CTAs). `components/ui/dialog.tsx` records the focused element when a dialog opens, focuses the first `[data-autofocus]` field, and restores focus on close. React `autoFocus` is not used inside dialogs, because it moves focus before the opener can be recorded. Covered by the E2E keyboard test.

## ADR-016 — Mailer adapter with a dev sink; no real provider yet (ACCEPTED, M2)

Invitations and password resets go through a `Mailer` interface. `MAIL_TRANSPORT=dev-sink` writes each message to a gitignored folder and logs only its kind and file name. `disabled` drops messages. The dev sink is refused in production, because it stores one-time links in plain text. A real provider (e.g. Resend, Postmark, SES) is the owner's decision and needs its own adapter, domain verification and bounce handling. Until then, invitations still work: the inviter sees the one-time link once and shares it directly. Password reset needs a real provider in production.

## ADR-017 — One-time tokens: hashed at rest, sent in URL fragments, consumed under row locks (ACCEPTED, M2)

Invitation (7 days) and reset (30 minutes) tokens are 256-bit random values. Only SHA-256 hashes are stored. Links put the token in the URL **fragment** (`#token=`), which browsers never send to servers or in `Referer`; the page reads it once, removes it from the address bar, and posts it in the request body. Consumption uses `SELECT … FOR UPDATE`, so concurrent use succeeds once (tested). Unknown, used, expired and revoked tokens all return the same `400 TOKEN_INVALID`. A partial unique index allows one open invitation per email; replacing an invite revokes the old link. The inviter sees the raw invite link once (an admin can already create accounts, so this grants no extra power). Reset tokens are never returned by the API.

## ADR-018 — Partial indexes outside the Prisma schema are safe (VERIFIED, M2)

Prisma's schema language cannot express the partial unique indexes or check constraints written by hand in the migrations. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` on 2026-10-24 produced an **empty migration**, so future `migrate dev` runs will not drop them. Re-check this command whenever a migration touches those tables.

## ADR-019 — Password policy: offline zxcvbn-ts score ≥ 3 + personal-info check (ACCEPTED, M2)

New passwords (bootstrap, invite acceptance, reset) must be 12–128 characters, score at least 3 with `@zxcvbn-ts` (MIT; about 49k breach-corpus passwords plus pattern matchers, fully offline), and must not contain the user's email local part or name parts of 4+ characters. Login only checks length, so tightening the policy never locks existing users out. A k-anonymity breach API (e.g. HIBP) was not chosen: it would add an external dependency and egress (SSRF-controlled, M10). It can be added later as an opt-in adapter.

## ADR-020 — Forms validate on submit, then live (ACCEPTED, M2)

E2E found that blur validation on an autofocused, empty field shifted the layout under the pointer, so a click on "Forgot password?" missed. All forms now use `mode: 'onSubmit'` with `reValidateMode: 'onChange'`: no errors appear before the first submit, then they update as the user types.

## ADR-021 — Team management rules (ACCEPTED, M2)

Owner and Admin hold `team.*`. Only owners hold `team.manage_owners`: granting OWNER, or changing, deactivating or signing out an owner. Nobody changes their own role or status through team endpoints, so the acting owner always remains, and the last-owner lock (`FOR UPDATE` on owner rows) is defense in depth for races. Role change and deactivation revoke all of the member's sessions in the same transaction; deactivation also voids unused reset links. Edits carry the member's `version`, and stale edits get `409 CONFLICT_STALE_VERSION`. CLIENT can never be granted through staff endpoints (also enforced by a check constraint on invitations).

## ADR-022 — Shared contracts split into a base module plus feature modules (ACCEPTED, M3)

`packages/contracts/src/index.ts` only re-exports `base`, `permissions`, `time`, `money` and `crm`. The CRM schemas once imported values from `index.ts`, and that circular import left them `undefined` at runtime. Feature modules now import from `base.ts` and never from the barrel.

## ADR-023 — Money: BigInt minor units in the database, decimal strings on the wire (ACCEPTED, M3)

Amounts are stored as `BIGINT` minor units with a DB check (0 to 9×10¹⁴) and a supported-currency check (EGP, USD, EUR, GBP, SAR, AED; all have 2 decimals). JSON carries amounts as decimal strings (`"245000.50"`), never as numbers. `parseMoneyToMinor` parses user input with string arithmetic and rejects exponents, negatives and extra decimals. `formatMoney` formats from the string. Totals are computed per currency (`groupBy`) and are never added across currencies; there is no FX conversion. Changing a deal's currency requires re-entering the amount, so a value can never silently change meaning.

## ADR-024 — Marking a deal WON before proposals exist: manager override (ACCEPTED, M3, revisit in M4)

FR-D05 allows WON only with an accepted proposal or a documented, authorized override. Proposals arrive in M4. Until then, WON needs `deals.override_won` (Owner, Admin, Sales manager) **and** a written reason. The reason is stored on the deal and shown in its history. Salespeople see the button disabled with an explanation, and the API returns 403 for them. Winning a deal whose contact is still a LEAD converts that contact to CUSTOMER in the same transaction (same ID, history kept). In M4 the normal WON path will come from an accepted proposal, and the override stays as the exception.

## ADR-025 — `deals.closed_by_id` uses a simple foreign key (ACCEPTED, M3)

Owner, contact, pipeline and stage use composite `(agency_id, …)` foreign keys, so cross-agency links are impossible. `closed_by_id` started that way too, but Prisma cannot model a composite FK on a nullable column that shares `agency_id` with other relations without schema drift. A follow-up migration (`20261024184612_deal_closed_by_fk`) replaced it with a simple FK to `users.id`. The closer is always the authenticated actor from the same agency, set by the server, never from input. `prisma migrate diff` is empty afterwards.

## ADR-026 — Sales record rules (ACCEPTED, M3)

- **Reassignment** (`sales.reassign`) is held by Owner, Admin and Sales manager. The spec names Owner/Admin; Sales manager is added because the role exists to run the team's pipeline. The new owner must be an active member of the agency with a sales-capable role (otherwise 422).
- **Archived contacts** are hidden from lists by default, stay readable by ID, and are read-only: every write returns 409 until the contact is restored.
- **Timeline entries** (note, call, email, meeting) may be back-dated but not dated more than 5 minutes in the future. They are ordered by `occurred_at`.
- **Deal visibility:** Sales see deals they own; managers see all deals in the agency. A deal cannot be attached to a contact the user cannot see. That returns 422 on `contactId`, the same response as an unknown ID, so it reveals nothing.
