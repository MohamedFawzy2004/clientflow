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

## ADR-027 — Clients accept proposals only in a signed-in portal session (ACCEPTED, M4)

Spec §1.1 says client approval needs "a verified portal session with organization association", not a shared link. The M3 report had proposed a one-time acceptance link; that was dropped, and the owner approved building a minimal portal in M4 instead.

- `client_organizations` hold the customer company. A contact may belong to one.
- CLIENT users are ordinary `users` rows with `role = CLIENT` and a required `client_org_id` (DB check: CLIENT ⇔ organization). There is no separate `client_portal_users` table: the role plus the column give the same boundary with less code. Spec §8.1 lists that table, so this is a deliberate simplification.
- People join through the existing hashed, one-time, 7-day invitation flow. The `invitations_staff_roles_only` check became `invitations_client_org_matches_role`.
- CLIENT users hold only `portal.access`, so every staff endpoint returns 403. Team and invitation screens never list them. An archived organization ends its users' sessions.
- `client_org_id` on contacts, users, invitations and proposals is a plain FK (nullable, see ADR-025); services check the agency.

## ADR-028 — Proposal arithmetic (ACCEPTED, M4)

- Prices are entered **excluding tax**. The default is VAT 14% (Egypt), editable per proposal, along with an optional whole-proposal discount.
- Rates are stored in basis points (1400 = 14.00%). Quantities are stored in hundredths (150 = 1.5). Amounts are BigInt minor units.
- line = quantity × unit price; discount = subtotal × discount%; tax = (subtotal − discount) × tax%. Each step rounds **half up** to the minor unit. The UI shows the rule and the base each percentage applies to.
- `computeProposalTotals` lives in the shared contracts, so the editor preview and the server use the same code. The server is authoritative, and a DB check keeps `total = subtotal − discount + tax`.
- Currency is fixed per proposal (from the deal). Only catalog services in that currency can be added.

## ADR-029 — Acceptance is "operational approval", not an e-signature (ACCEPTED, M4)

The owner chose this wording (FR-Q11, risk R8). The portal, the confirmation dialog, the staff view and the printed version all say that accepting records operational approval of an exact version and is not a formal electronic signature. The record still holds who, when, which version and the SHA-256 hash of the terms shown. Legal review is needed before presenting it as binding.

## ADR-030 — Immutable versions and serialized workflow, enforced by the database (ACCEPTED, M4)

- A trigger on `proposal_versions` refuses content changes once a version leaves DRAFT (status and workflow timestamps may still move forward). Client decisions are final, and non-draft versions cannot be deleted.
- A trigger on `proposal_items` refuses inserts, updates and deletes unless the parent version is DRAFT.
- `proposal_reviews` is append-only, like audit events.
- Partial unique indexes allow one version in preparation, one SENT and one ACCEPTED per proposal, and one client decision per version.
- Every workflow action (edit, submit, review, send, revise, client decision) locks the proposal row (`SELECT … FOR UPDATE`), so concurrent requests see each other's results. On top of that, versioned bodies return 409 on stale input.
- Approvers may approve proposals they wrote. Small agencies often have one owner; the review record keeps who approved.

## ADR-031 — Client decisions name the version by its content hash (ACCEPTED, M4)

The portal sends the hash of the version it displayed. The server accepts the decision only if that hash is the currently SENT, unexpired version. A superseded version returns "a newer version was sent". The same decision repeated (double click) returns 200 with no new records; a different decision on a decided version returns 409.

Sending a new version supersedes the old one. Accepting withdraws any version still in preparation, wins the deal through the normal path (`closed_by` = the client user, `accepted_proposal_version_id` set) and converts a lead to a customer. Accepted proposals cannot be revised; later changes go through change requests (M8).

## ADR-032 — Printable version now, generated PDF file later (ACCEPTED, M4)

FR-Q06 asks for a PDF export. M4 ships a print-optimised version (app chrome hidden; reference, amounts and dated acceptance shown) that browsers save as PDF. A server-generated, archived PDF needs a rendering dependency and file storage, so it moves to M5. FR-Q06 stays IMPLEMENTING.

## ADR-033 — Proposal PDFs rendered on the server with pdfkit and the built-in fonts (ACCEPTED, M5)

`pdfkit` 0.20.2 (MIT, pure JavaScript, no headless browser) renders a frozen version on request. The PDF contains the reference, scope, priced lines, totals with their explanation, terms, the dated acceptance (with the operational-approval notice) and the SHA-256 terms hash on every page. The renderer's input type has no internal-notes field, so notes cannot leak into it.

Only submitted versions have a PDF; drafts return 409. Portal users get only their organization's current version.

PDFs are generated on demand, not stored. The source version is immutable (ADR-030), so the content cannot change.

**Limitation:** the built-in PDF fonts cover Windows-1252 only, so Arabic and other non-Latin text prints as "?". The browser print view shows it correctly. Embedding a Unicode font with right-to-left shaping is a follow-up (risk R21).

## ADR-034 — One container serves the API and the web app on one origin (ACCEPTED, M5)

When `WEB_DIST_DIR` is set, the Express process serves the built SPA:

- `/assets/*` with a one-year immutable cache, and a plain 404 for missing files;
- `index.html` with `no-cache` for any non-API path;
- the API and `/health` keep their JSON responses.

Same origin means first-party `__Host-` cookies and no CORS configuration. Web responses get their own CSP: `default-src 'self'`, `script-src 'self'` (no inline scripts), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`. Inline style attributes are allowed for component libraries.

The multi-stage `Dockerfile`:

- builds everything, then copies only production dependencies and build output into a slim Node 24 image that runs as the `node` user;
- adds a separate `migrate` target that runs `prisma migrate deploy` as a release step;
- sets `HOST=0.0.0.0` in the image; local development keeps `127.0.0.1`.

CI builds both images and smoke-runs them against PostgreSQL. Hosting is not chosen yet; `docs/17_DEPLOYMENT.md` is provider-neutral.

## ADR-035 — Dashboard numbers and reminders (ACCEPTED, M5)

- **Scope:** every dashboard number is a database aggregate built from the same scope helpers as the list pages (`dealReadScope`, `contactReadScope`, `proposalReadScope`), so counts never include hidden rows (T-ACL-05).
- **Owner filter:** salespeople always see their own numbers. Asking for another owner returns **403** rather than being silently ignored. Managers (`dashboard.team`) may see the whole agency, filter to one owner, and get a per-owner table.
- **Money:** summed per currency only.
- **Dates:** ranges are inclusive agency-local dates, and the default is this month to date. "Won" and "lost" are counted by close date; "new leads" by creation date. Pipeline and proposal counts describe the current state.
- **Reminders** are computed from live data on each request; there is no notifications table yet. They are personal: the viewer's own follow-ups and proposals, plus reviews for approvers. Email and push notifications come with automation (M10).

## ADR-036 — CSV export rules (ACCEPTED, M5)

Only `reports.export` holders (Owner, Admin, Sales manager) can export, and only rows they could see on screen; the owner filter works as on the dashboard.

- **Formula injection:** any cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets an apostrophe prefix, so spreadsheets show it as text (OWASP CSV injection). Every cell is quoted, with quotes doubled.
- **Format:** UTF-8 with BOM (so Arabic names open correctly in Excel) and CRLF line endings. Amounts are exact decimal strings in a separate currency column.
- **Limits and audit:** at most 5,000 rows. Each export writes an `export.deals` audit event with the row count and filters, never the data.

## ADR-037 — Route-level code splitting with React Router `lazy` (ACCEPTED, M5)

Every screen is its own chunk, loaded on first visit. Sign-in and the two shells stay in the main bundle, so the first paint does not wait for a second request. The main bundle went from 790 kB to 299 kB (228 kB → 93 kB gzip). Shared form and validation code (about 240 kB) loads with the first app screen. Shared UI modules are kept out of page files: the portal page imports shared components, never a staff page.

## ADR-038 — Idempotent handoff: the result is stored in the same transaction (ACCEPTED, M6)

`POST /deals/:id/convert-to-project` requires an `Idempotency-Key` (a UUID). `idempotency_records` holds one row per `(agency, scope, key)`, with the SHA-256 of the request (deal, manager, title, dates), the actor and the resulting project ID. That row is written **inside** the conversion transaction, so it exists only if the project does.

The handler checks for a stored result twice: before starting, and again after taking the deal's row lock, because a concurrent request with the same key may have committed while it waited.

| Situation                                           | Result                                   |
| --------------------------------------------------- | ---------------------------------------- |
| Same key, same request, same user                   | 200, the same project, `replayed: true`  |
| Same key, different request or different user       | 409                                      |
| Different key for a deal that already has a project | 409                                      |
| A unique-index race the lock did not prevent        | Answered from whatever the winner stored |

The web dialog creates one key when it opens and reuses it on retry, so a lost response cannot create a second project.

**Fault injection (T-HAND-02):** `AppDeps.hooks.beforeHandoffCommit` is a test-only fault-injection point. `server.ts` never sets it.

## ADR-039 — The project points at the accepted version; the budget excludes tax (ACCEPTED, M6)

The scope baseline is `projects.baseline_version_id`, the client-accepted proposal version. Versions are immutable (ADR-030), so the project references the version instead of copying it. A DB check keeps `deal_id` and `baseline_version_id` both set or both empty.

The budget baseline is `subtotal − discount` in the proposal's currency, excluding VAT: what the agency earns for the work. The accepted total including tax is shown next to it.

Milestones are seeded from the proposal's milestones text: one per line, or per "·", ";" or "|", at most 20. Without any, the defaults are Kick-off, Delivery and Handover.

## ADR-040 — Who sees and changes projects (ACCEPTED, M6)

Following spec §1.1:

- **Owner and Admin:** all projects.
- **PM and Member:** projects they manage or belong to.
- **Sales Manager and Sales:** "read linked", i.e. projects made from deals they can read, read-only.
- **Finance:** nothing until billing views exist (M9).
- **Client:** nothing; portal project sharing comes in M7.

Changing a project needs `projects.manage`, plus being its manager unless the user is Owner or Admin. Only Owner and Admin can change the manager. Members can join only if they have a delivery role (Owner, Admin, PM, Member). Anything out of scope answers 404.

## ADR-041 — Deals won by override are not converted; and handed-off deals stay won (ACCEPTED, M6)

A deal won by manager override (ADR-024) has no agreed scope, so conversion returns 409 and points to manual project creation (Owner, Admin, PM). Once a deal has a project, reopening it returns 409. The reopen takes the same `deals` row lock as the conversion, so the two cannot interleave.

## ADR-042 — Test-only rate-limit overrides (ACCEPTED, M6)

The E2E suite grew past the per-IP limits (about 50 sign-ins and more than 1,000 API calls in 15 minutes from 127.0.0.1). `LOGIN_RATE_LIMIT_PER_IP`, `TOKEN_RATE_LIMIT_PER_IP` and `API_RATE_LIMIT_PER_IP` raise them for the E2E server. `loadEnv` refuses them when `NODE_ENV=production` (tested). Per-email limits are not configurable.

## ADR-043 — File storage: a port with an encrypted local-disk adapter (ACCEPTED, M7)

The owner has not chosen hosting yet (O-hosting), so uploads go through a `FileStorage` port (`put`, `get`, `remove`). The only adapter today is `LocalEncryptedStorage`:

- Each file is encrypted with AES-256-GCM, a random 96-bit nonce per file and the tag stored on the `files` row. The key is `FILE_ENCRYPTION_KEY` (64 hex characters, required; the app refuses to start without it).
- Objects are named by a random UUID (`storage_key`), so no user input ever reaches a path. The original name is display-only and sanitized.
- The directory (`FILE_STORAGE_DIR`, `/data/files` volume in the image) is never served statically. Writes go to a `.part` file and are renamed only after the whole upload passed.

An S3-compatible adapter (R2, S3, Backblaze) can implement the same port once hosting is chosen; then presigned URLs and the provider's server-side encryption replace the local key. **Backups must include both the files and the key**: without the key the files are unreadable.

## ADR-044 — Upload checks: allowlist, signatures, active content, built-in scan (ACCEPTED, M7)

- **Allowlist by extension:** pdf, png, jpg/jpeg, webp, gif, docx, xlsx, pptx, zip, txt, csv, md. The server sets the content type from this table and ignores the browser's.
- **Signature check:** the first bytes must match the claimed type (for example `%PDF-`, the PNG header, `PK\x03\x04` for Office files and zip).
- **Text files** must be UTF-8 without NUL bytes and must not contain HTML or script markers.
- **HTML, SVG, scripts and executables** are refused outright (FR-X07).
- **Size:** `FILE_MAX_BYTES` per file (default 25 MB; at most 100 MB, also a DB check) and `FILE_PROJECT_QUOTA_BYTES` per project (default 2 GB).
- **EICAR:** the EICAR test signature is detected, which proves the quarantine path end to end.

The checks run while the bytes stream to storage. A file that fails any of them is removed and refused (422 or 413), and a FAILURE audit event is written. `scan_status` exists for a later asynchronous scanner: only `CLEAN` files can be downloaded, versioned or published, and publishing checks again.

**This is not an antivirus.** A real scanner (ClamAV sidecar or a provider service) is deferred to the hosting decision and tracked as risk R25.

## ADR-045 — Downloads through short-lived, user-bound links (ACCEPTED, M7)

`POST /files/:id/download-url` (staff) and `POST /portal/files/:id/download-url` (clients) return `/api/v1/files/download/<token>`. The token is an HMAC (key derived from the app secret, separate from CSRF) over the file ID, the user ID and an expiry 5 minutes ahead.

Using a link also needs the same user's session, and access is checked again at download time, so revoking a share or removing a member stops links that were already handed out.

Responses are always attachments, with `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store` and CORP same-origin. Request logs redact the token from the path.

## ADR-046 — Portal sharing per client user, and what clients see (ACCEPTED, M7)

A project is shared with named CLIENT users of the project's client organization (`project_portal_shares`, spec §8.1 `client_project_shares`). A DB trigger refuses anyone else.

- Handed-off projects take the organization from the accepted proposal. A manual project can be linked to one, and changing that link revokes every active share.
- Archived projects leave the portal.
- **Portal payloads contain:** project title, state and dates, milestones, and published deliverable versions with their notes and files.
- **Portal payloads never contain:** tasks, time, budget, internal notes, team names (apart from the agency name) or unpublished versions.
- Out-of-scope portal requests (another organization's project, deliverable or file, or an unshared project) return the same 404 as unknown IDs and write a `portal.access_denied` DENIED audit event (T-ACL-02).

## ADR-047 — Task permissions and dependency cycles (ACCEPTED, M7)

**Permissions.** Delivery data (tasks, time, files, deliverables) needs the new `delivery.work` permission (Owner, Admin, PM, Member) plus project scope. Sales get the linked project overview only (403 on delivery endpoints).

| Who                              | What they may do with tasks                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Project manager (or Owner/Admin) | Create tasks, edit every field, change dependencies, cancel and reopen                                                 |
| Assignee                         | Move their own task between To do, In progress, Blocked, In review and Done (US-11), and nothing else                  |
| Any project participant          | Log their own time. Only the author edits or deletes an entry. Members see their own time; the manager sees everyone's |

Removing a member returns their open tasks to "unassigned".

**Dependencies.** Both tasks of a dependency belong to one project (composite FKs) and a task cannot wait for itself (DB check). Cycles are refused by a recursive CTE run under the project row lock, so two opposite links sent at once cannot both land (tested). A task waiting for open tasks cannot become Done (spec §9). The documented override is deferred.

**Cost rates** are not stored until finance (M9, FR-F06).

## ADR-048 — Deliverable lifecycle and client decisions (ACCEPTED, M7)

The statuses follow spec §9: DRAFT → READY (a version with a clean file) → PUBLISHED (explicit, project manager only) → APPROVED or REVISION_REQUESTED → (new version) READY → … ARCHIVED at any time.

- The client decides on the latest published version only, naming it by ID: approve, request a revision or reject (a reason is required for the last two, DB check).
- One decision per version is enforced by a unique index under a row lock; the same decision repeated is idempotent.
- The spec has no REJECTED deliverable status, so a rejection is stored as the decision REJECTED and sends the deliverable back to REVISION_REQUESTED.
- While a version is with the client, no new version can be added. After approval the deliverable is closed.
- Published versions and decisions are immutable: DB triggers block updates and deletes.
- The review date is advisory: when it passes, the deliverable shows as overdue and is never approved by silence (FR-S10).
- The project manager receives a link-only email about each decision (SEC-24).
- A project cannot move to Completed while a deliverable is waiting for the client (spec §9). Archiving the deliverable is the authorized waiver.

## ADR-049 — One streamed upload request instead of upload-intent / complete (ACCEPTED, M7)

Spec §10 lists `upload-intent`, `complete` and `download`, a shape designed for presigned object-storage uploads. With local storage the API receives the bytes itself, so M7 uses one request: `POST /projects/:id/files` with the raw body and the name in `X-File-Name`. The bytes are checked and encrypted as they stream in, so nothing unchecked is ever kept.

A refused upload's remaining body is drained up to 2× the limit, so the client receives the error instead of a reset connection; past that the connection is closed. When an S3 adapter arrives, the intent/complete pair can be added in front of the same checks.

## ADR-050 — Change requests: versions, internal approval and client acceptance (ACCEPTED, M8)

A change request (CR-n per project) holds the requester's words (what should change and why). The project manager's estimate lives in numbered versions:

- the scope delta (shown to the client);
- work items, one per line;
- effort in minutes (internal, never in the portal);
- the price excluding tax, in minor units of the project currency;
- tax at the accepted proposal's rate (14% if there is none);
- an optional new due date.

The flow follows spec §9 and J4:

- `REQUESTED` (by the client in the portal or by the PM) → `ESTIMATING` (draft version).
- **Priced change:** → `IN_REVIEW`. An Owner or Admin approves it (`changes.approve`) or sends it back with a reason. Then → `AWAITING_CLIENT` when sent.
- **Change without a price** (for example a date-only change): sent directly → `AWAITING_CLIENT`.
- `AWAITING_CLIENT` → `ACCEPTED` or `REJECTED`, decided by the client.
- `WITHDRAWN` at any open step, with a reason.

Sending computes a SHA-256 over the client-visible content and freezes the version (DB trigger: content, hash and number can never change; a decided, superseded or withdrawn version is final). The client decides by naming that hash, like proposals (ADR-030). The portal shows only sent versions; internal review reads as "Estimating".

Self-approval (O16) is still open: an Owner who manages a project can approve their own priced change, as for proposals.

## ADR-051 — Only an accepted change moves the baseline, in one transaction (ACCEPTED, M8)

The original baseline stays the accepted proposal version (ADR-039). Under row locks on the change and the project, accepting a change:

- adds the version's price to `projects.budget_minor`;
- moves `due_on` when the change sets a new date;
- creates one task per work item with `scope = CHANGE` and a link to the change;
- records the budget before and after and the old due date on the version;
- writes the decision (unique per version), history and audit.

Rejecting writes only the decision. One decision per version; repeating the same decision returns the same result (T-SCOPE-01/02, US-18). The project page shows the original budget, every accepted change and the current budget. A project cannot be completed while a change waits for the client, and accepting is refused on a closed project.

## ADR-052 — Extra work is either an accepted change or a documented exception (ACCEPTED, M8)

Every task has a scope: `BASELINE`, `CHANGE` (an accepted change of the same project) or `EXCEPTION` (a written reason of at least 10 characters). DB checks and a trigger enforce the same rules as the API, so a task cannot silently point at a change that was not accepted (FR-S05). Creating an exception is audited. The board shows extra-work badges, and the Time tab splits minutes between original scope, accepted changes and exceptions (spec J4 step 5).

## ADR-053 — Comment threads shared by the team and the client (ACCEPTED, M8)

Deliverables and change requests have one comment thread each (FR-X08).

- **Who comments:** staff with delivery access on the project, and clients who can see the item in the portal. Elsewhere it is a 404 plus a DENIED audit event.
- **Edit and delete:** authors edit or delete only their own comments. Each edit or delete appends the earlier text to `project_comment_revisions` (append-only, DB trigger); a deleted comment shows as "deleted".
- **History:** the team sees the history of every comment; clients see the history of their own comments.
- **Notifications:** a client comment sends the project manager a link-only email. In-app notifications arrive with M10.

## ADR-054 — Invoices are tracked, not collected; issuing freezes a snapshot (ACCEPTED, M9)

ClientFlow records invoices and the payments the agency confirms. It never moves money, stores card data or connects to a bank (FR-F01). Every invoice screen says so.

- **States:** `DRAFT → ISSUED → PARTIALLY_PAID → PAID`, plus `VOID`. `OVERDUE` is derived (issued or partly paid, past due, balance open) and is never stored.
- **Drafts:** they are edited as a whole (lines, tax %, due date, terms, internal note) under the invoice's `version`. Lines bill a milestone or an accepted change of the invoice's project, or free text. The invoice uses its project's currency.
- **Issuing:** under a row lock, issuing takes the next number, computes the totals with the proposal math (exact minor units, tax rounded half up, ADR-030), and copies the customer name, contact and the agency's issuer details onto the invoice (FR-F02).
- **Database rules:** a trigger freezes the content once an invoice is issued, makes void final and blocks deleting an issued invoice. Lines change only on drafts. Checks keep the status consistent with the paid amount, and keep the paid amount between 0 and the total.
- **Portal:** an issued invoice reaches the portal only when it is published. Clients see their own organization's published invoices, without internal notes, payment references or staff names (FR-X03). Anything else is a 404 with a DENIED audit event.

## ADR-055 — Payments are append-only, idempotent and never overpay (ACCEPTED, M9)

Only Finance and the Owner record payments (FR-F04; Admins manage invoices but do not touch money).

- **Recording:** each payment is a new row: amount, received date, method, reference and note (FR-F03). It needs an `Idempotency-Key` header. A retry with the same key and body returns the first result (200, `replayed`). The same key with a different body is a 409 (SEC-15).
- **Overpayment:** the invoice row is locked, so two people paying the same balance cannot both land. An amount above the open balance is refused with the exact balance in the message.
- **Mistakes:** a payment is never edited or deleted (DB trigger). It is reversed by a REVERSAL row linked to it, with a reason, and the balance reopens. Each payment and reversal is audited.
- **Void:** voiding needs a reason, and is allowed only when nothing is paid (reverse the payments first). The number and history stay.
- **Card numbers:** references and notes that look like a card number (13 or more digits) are refused by the API and by a DB check (SEC-14).

## ADR-056 — Cost rates and estimated margin (ACCEPTED, M9)

Cost rates are internal hourly costs per person with an "effective from" date. Changes keep the earlier rates for earlier time, and every change is audited (FR-A06 for this setting).

- **Time cost:** for each logged minute, the rate in effect that day, counting only rates in the project's currency. There is no currency conversion.
- **Margin:** the agreed budget (proposal plus accepted changes) minus that cost. It is always labelled "estimated", and it says what share of logged time had a usable rate and whose time had none (FR-F06, FR-F07, US-23).
- **Kept apart:** expected (budget, excluding tax), invoiced (issued, not void) and received (cash) are separate figures, never mixed (FR-F05).
- **Reports:** totals are per currency and are never added across currencies. The CSV export is limited to what the reader may see; cells are neutralized against formula injection, and each export is audited (FR-F09).

## ADR-057 — Defaults chosen for open M9 questions (ACCEPTED, M9 — owner confirmed on 2026-10-28)

The owner did not answer these, so M9 ships with these defaults. Each can be changed later without a data migration:

1. **Numbering:** one agency-wide sequence, `INV-0001`, `INV-0002`, … A number is taken only when an invoice is issued; drafts have none, and void invoices keep theirs. Per-year or per-client prefixes would be a formatting change.
2. **Who sees cost rates:** Owner and Admin set them, Finance reads them. Nobody else sees them, including the person whose rate it is.
3. **What a PM sees:** for projects they manage, the money summary and the estimated margin, but not other people's rates (only the names of people without a rate). PMs read their projects' invoices but cannot change them or record payments.

## ADR-058 — Transactional outbox and a database-backed worker (ACCEPTED, M10)

Background work (emails, reminder scans) goes through an `outbox_jobs` table instead of Redis/BullMQ, because ClientFlow has one database and modest volume (spec §11.1 allows "a DB-backed outbox worker"). The approach has five parts:

- **Same transaction:** a job is written in the transaction of the change that needs it. A rolled-back change sends nothing, and a committed one is never forgotten (spec §8.2 "writes + outbox").
- **Claiming:** a worker claims due jobs with `FOR UPDATE SKIP LOCKED` and a 2-minute claim. Several workers can run at once without taking the same job. If a worker dies, its job becomes due again when the claim expires, and the attempt still counts.
- **Retries:** waits grow from 30 s, 1 min, 2 min and so on, up to 1 hour (±20%). After `max_attempts` (6 by default) a job is DEAD. Owners and Admins see dead jobs in Settings and can retry them, which is audited. The stored error is the error class and the first line of the message, with email addresses removed.
- **No duplicate emails:** each send carries an idempotency key, and the notification row records `emailed_at`. The dev sink and test mailer drop repeats with the same key, and a real provider adapter must pass the key on. Delivery is still at-least-once if a provider ignores keys; this is documented, not hidden.
- **Payloads:** jobs hold IDs only (checked against a schema, at most 4 KB by DB check), never addresses, names or tokens. Invitation and password-reset emails stay synchronous because their links carry one-time tokens that must not sit in a table.

The worker runs inside the API process by default (`JOBS_ENABLED=true`, polling every `JOBS_POLL_SECONDS`), or as its own process with `npm run jobs:worker`. Reminder scans are scheduled as `reminders.scan` jobs, one per agency and time slot (dedupe key). Each scan takes a per-agency advisory lock. Finished jobs are deleted after 30 days; dead jobs are kept.

## ADR-059 — In-app notifications with per-category channels (ACCEPTED, M10)

**Where notifications come from.** `notify()` runs inside the event's transaction. It drops the actor, clients, deactivated users and other agencies. It then applies each recipient's channel choice and queues an email job for those who want one. Events:

| Event                                                                                       | Who is notified                                         | Category        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------- |
| A client requests or decides on a change, decides on a deliverable or proposal, or comments | The PM; also whoever wrote the version or owns the deal | CLIENT_ACTIVITY |
| A change or proposal is submitted for approval                                              | The approvers                                           | APPROVALS       |
| A change or proposal is approved or sent back                                               | The author                                              | APPROVALS       |
| A task is assigned                                                                          | The assignee                                            | TASKS           |

**Reminders** come from the scheduled scan:

| Reminder                                                         | Who                   | Category        |
| ---------------------------------------------------------------- | --------------------- | --------------- |
| Follow-ups and next steps that became overdue in the last 7 days | The owner             | FOLLOW_UPS      |
| Proposals that expire within 3 days                              | The deal owner        | FOLLOW_UPS      |
| Tasks due today or overdue (last 7 days)                         | The assignee          | TASKS           |
| Issued invoices past due with a balance                          | Owner, Admin, Finance | INVOICES        |
| Deliverables or changes waiting on the client for 3+ days        | The PM                | CLIENT_ACTIVITY |

Each reminder has a dedupe key, so it is created once per item and due date. "Today" is the agency's timezone.

**Channels.** Without a saved choice, every category is in-app. Email is on only for CLIENT_ACTIVITY, which keeps the M7/M8 emails PMs already got. Turning in-app off while keeping email stores the row as not shown in the list.

**Emails** are link-only, with a generic sentence and no names, amounts or message text (SEC-24). The subject is fixed per event type. Every email links to the settings page.

**Access.** Only the recipient can list, count or mark a notification; anyone else gets a 404. Links are app paths built by the server, and a DB check keeps them under `/app/`. A title is a snapshot from when the event happened: if someone later loses access to the record, the title stays but the link answers 404 (R34). Portal users have no notification center yet; they keep their link-only emails.

## ADR-060 — CSV import: preview, commit and undo (ACCEPTED, M10)

**Who.** Contacts and deals can be imported by Owners, Admins and Sales managers, the roles that read every contact. The permission check runs before the larger body (2 MB) is read. Every other route keeps the 32 KB JSON limit.

**Limits.** 1 MB of UTF-8 text, 2,000 rows, 40 columns, 5,000 characters per cell. A BOM is removed, semicolon-separated files are detected, and line endings are normalised. Text with replacement characters is refused with "save as CSV UTF-8". Parsing uses `csv-parse` 7.0.3 (MIT, no dependencies) with relaxed quotes, so hand-made cells like `=HYPERLINK("…")` are read as text.

**Preview.** The server suggests a column mapping from the headers (English and Arabic). It checks each row with the same rules as the forms. It flags duplicates of existing records (contacts by email or phone, deals by contact and name) and of earlier lines. Line numbers are where each row starts.

**Commit.**

- It needs an `Idempotency-Key` and the preview's file hash. A different file is a 409.
- It re-runs every check inside one transaction, under a per-agency advisory lock, so two imports at once cannot both create the same contact.
- It creates only ready rows; duplicates are skipped unless chosen.
- Nothing is merged into an existing record.

**What is stored.**

- Each created record keeps `import_run_id`.
- The run keeps the file hash and counts, but not the file (FR-A07: no extra copy of personal data).
- The audit event has counts only.

**Formula cells** are stored as text, rendered as text, and neutralized by the existing CSV exports.

**Undo** archives the records the import created that nobody has changed since: contacts with no deals, deals that are open and have no proposals. Nothing is deleted. Changed records are kept, and both counts are reported.

## ADR-061 — Outbound webhooks deferred (ACCEPTED, M10)

The M10 epic lists outbound webhooks (FR-A04, FR-A05, SEC-19, T-SEC-06), but the approved M10 proposal did not include them, and no integration needs them yet. They are deferred until the owner names an integration.

When they are built, they will use the outbox (ADR-058) with signed payloads, per-endpoint secrets and rotation. SSRF defenses will block loopback, private and link-local ranges, and the address will be checked again at connect time.

## ADR-062 — Brute-force limits shared in PostgreSQL; general API limit per instance (ACCEPTED, M11)

Sign-in per IP, failed sign-ins per account, one-time links per IP and reset requests per account are counted in `rate_limit_counters`, using one atomic `INSERT … ON CONFLICT` per counted request. This closes O1. The limits:

- hold across restarts and across every API instance;
- use hashed email keys;
- are pruned hourly by the worker;
- fail closed: if the database is down, sign-in fails anyway.

The general per-IP API limit (1,000 requests per 15 minutes) stays in memory per instance, which supersedes ADR-007 for the auth limiters. It is a coarse abuse guard, and a database write on every request is not worth it. With N instances the effective ceiling is N × 1,000, which is acceptable for one agency.

Tests build apps without the shared store, so each test counts on its own. A dedicated test checks that two instances and a "restart" share counts, and that counting is atomic under 20 concurrent hits.

## ADR-063 — Portable, verifiable backups and isolated restores (ACCEPTED, M11)

Platform-managed PostgreSQL backups with point-in-time recovery, plus volume snapshots, remain the first line. On top of them, `npm run backup` writes a portable backup: a custom-format `pg_dump`, a copy of the encrypted file store, and `manifest.json`. The manifest holds migrations, row counts per table, SHA-256 of everything, and a 16-hex fingerprint of the file key; never the key itself.

`npm run restore` checks the backup's checksums and the key fingerprint first. It then restores only into an empty database that is not the one in `DATABASE_URL`, and into an empty folder. It reconciles migrations and row counts, and decrypts every stored file against its recorded SHA-256 (T-OPS-01). The tools use `pg_dump`/`pg_restore` from PATH, or the same tools from `postgres:17.6-alpine` through Docker; passwords go through `PGPASSWORD`, never argv.

The M11 drill restored the E2E database (43 tables, 571 rows, files) and reported RECONCILED. It then applied the new M11 migration to that M10-era copy (NFR-14), and showed that each refusal case fails without side effects.

## ADR-064 — Monitoring without a vendor (ACCEPTED, M11)

No monitoring provider has been chosen, so ClientFlow exposes what any platform can use:

- **Readiness.** `/health/ready` is 503 when the database does not answer. When a due job has waited more than 15 minutes it reports `degraded` / `jobs: lagging` but stays 200: the instance still serves requests.
- **Logs.** One JSON line per request (request ID, user ID, path without the query string; no cookies, tokens or bodies). Unhandled rejections are logged. An uncaught exception is logged as fatal and the process exits, so the container restarts cleanly.
- **Status view.** `GET /ops/status` (Owner/Admin) and Settings → System status show database latency, job lag, pending and failed jobs, uptime, memory, whether limits are shared, and `APP_RELEASE`. Numbers only: no hosts, credentials or dependency versions.

Error tracking (Sentry or similar) can be added later through the logger, once the owner chooses one.

## ADR-065 — Lean, scanned runtime image; compress only static files (ACCEPTED, M11)

- **Pruning.** `scripts/prune-runtime.mjs` keeps only the packages the API and contracts reach (`npm ls --omit=dev`), minus `devOptional` ones. npm otherwise installs the web app's packages and the Prisma CLI, an optional peer of `@prisma/client`, together with Prisma Studio and an embedded Postgres. The image went from 835 to 518 MB and `node_modules` from 382 to 137 MB (O19). Argon2, pdfkit, csv-parse, pg and the generated client were checked to load in the pruned image.
- **Scanning.** Trivy 0.76.0 in CI fails on HIGH/CRITICAL advisories with a fix. Exceptions go in `.trivyignore`, each with a reason. CodeQL (`security-extended`) runs on every push. The secret scan (gitleaks) and `npm audit --omit=dev --audit-level=high` were already in CI.
- **What the first scan found.** All of the HIGH/CRITICAL Node findings were in the npm CLI bundled with the base image, which the runtime never runs, so npm, npx and corepack are removed. Debian updates are applied at build time, and a failed mirror download is fatal unless `OS_UPDATES=0` is passed (local builds without mirror access only). This machine could not reach the Debian mirrors, so CI is where the OS part of the gate is proven.
- **Compression.** The web app's own files are compressed (gzip/Brotli). API JSON is not, because responses can mix secrets such as CSRF tokens with reflected input (BREACH).
- **Loading order.** The app shells load on demand, and the screen's chunks start downloading while the session is checked.
