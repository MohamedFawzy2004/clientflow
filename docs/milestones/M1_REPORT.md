# ClientFlow Milestone M1 Report

**Milestone:** M1 — Foundation vertical slice · **Date:** 2026-10-24 · **Branch:** `feat/m1-foundation`
**Environment:** Windows 11 Home 10.0.26200, Node 24.19.0, npm 11.17.0, Docker Desktop 29.9.2 (PostgreSQL 17.6-alpine), Microsoft Edge 152 (Playwright channel `msedge`). Commands were run from Git Bash and from npm's `cmd.exe` shell. PowerShell itself was not used (see _Not run_).

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Monorepo + pinned toolchain · Docker Postgres · first migration (6 tables, composite cross-agency FK, check constraints, append-only audit trigger) · health endpoints · validated config · request IDs · redacted logging · security headers · typed error envelope · CLI owner bootstrap · login/logout · hashed server sessions with idle + absolute expiry · CSRF (session-bound + pre-session) and Origin checks · login throttling · scoped contacts create/list/detail · React shell, login, dashboard, leads list, add-lead dialog, lead detail, with loading/empty/filtered-empty/error/forbidden/not-found states |
| **FAILED (found and fixed during M1)** | 6 defects found by tests and browser review, all fixed and re-tested (see _Open bugs_ → "Fixed in M1")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **NOT RUN**                            | Interactive hidden-password prompt of the bootstrap CLI · PowerShell invocation · screen-reader walkthrough · Firefox/Safari · 200% zoom · production HTTPS/`__Host-` cookies · load/performance (NFR-02/03) · backup/restore drill · CI pipeline (none yet)                                                                                                                                                                                                                                                                                                                                                                |
| **DEFERRED**                           | Invitations, password reset, deactivation UI, sole-owner protection (M2) · contact edit/archive/lifecycle/timeline notes (M3) · everything in Phases 1–4 per `docs/REQUIREMENTS_TRACEABILITY.csv`                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Scope and FR/SEC/NFR IDs

- **Fully TESTED (21):** FR-I01, FR-I02, FR-C02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-16, NFR-05, US-01, US-02, US-04, US-21, T-AUTH-01, T-AUTH-02, T-AUTH-03, T-ACL-01, T-SEC-01, T-SEC-02, T-SEC-03, T-SEC-04.
- **Partially done, tested part recorded (29):** FR-I03, FR-I08 (enforcement only), FR-I11, FR-I12, FR-C01, FR-C05, FR-C06, SEC-01, SEC-02, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-17, SEC-25, NFR-01, NFR-04, NFR-10, NFR-15, US-05, US-16, US-17, T-ACL-03, T-ACL-04, T-SEC-05, T-UX-01, T-UX-02, T-UX-03.
- The notes column of the traceability CSV states what remains for each partial item.

## Implemented files / API routes / migrations

**Migration:** `prisma/migrations/20261024090758_init/migration.sql`. Tables `agencies`, `users`, `sessions`, `contacts`, `activities`, `audit_events`; composite FK `contacts(agency_id, owner_id) → users(agency_id, id)`; check constraints (normalized emails, non-blank names, hex token hash, phone format, expiry after creation); trigger `audit_events_no_update_delete`.

**API routes** (`apps/api/src/app.ts`):

| Method | Path                   | Auth           | Notes                                                                             |
| ------ | ---------------------- | -------------- | --------------------------------------------------------------------------------- |
| GET    | `/health/live`         | none           | `{status:"ok"}`                                                                   |
| GET    | `/health/ready`        | none           | DB ping; 503 when the DB is down; no internals                                    |
| GET    | `/api/v1/auth/csrf`    | optional       | Session-bound token when signed in, else pre-session token + cookie               |
| POST   | `/api/v1/auth/login`   | CSRF + Origin  | Generic 401, per-IP and per-email throttling, session rotation                    |
| POST   | `/api/v1/auth/logout`  | session + CSRF | Revokes the session row, audits                                                   |
| GET    | `/api/v1/auth/me`      | session        | Sanitized user + agency                                                           |
| GET    | `/api/v1/contacts`     | session        | `page`, `limit≤100`, `q`, `lifecycle`; role/owner scope                           |
| POST   | `/api/v1/contacts`     | session + CSRF | Strict DTO; contact + activity + audit in one transaction; scoped duplicate hints |
| GET    | `/api/v1/contacts/:id` | session        | 404 for missing, malformed or out-of-scope IDs                                    |

**Key source files:** `apps/api/src/modules/{auth,contacts,health}/*`, `apps/api/src/middleware/*`, `apps/api/src/lib/*`, `apps/api/src/cli/{bootstrap-owner,seed-dev}.ts`, `packages/contracts/src/index.ts`, `apps/web/src/{app,components/ui,features/{auth,leads,dashboard},lib,styles}/*`, `e2e/*`, `playwright.config.ts`, `docker-compose.yml`, `infra/postgres/init/01-create-databases.sql`.

**npm scripts (root):** `dev`, `db:up`, `db:down`, `db:migrate`, `db:migrate:dev`, `db:test:prepare`, `bootstrap:owner`, `seed:dev`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:web`, `e2e`, `build`.

## Screenshot / UI review evidence

Captured by `npm run e2e` (Playwright on Edge, real API + `clientflow_e2e`): `docs/milestones/m1-screenshots/`

- `leads-{360,390,768,1024,1280,1440,1920}.png`: all 7 spec viewports, each with an automated **no horizontal page overflow** assertion.
- `login-360.png`, `login-1440.png`, `lead-detail-360.png`, `lead-detail-1440.png`, `add-lead-360.png`, `add-lead-1440.png`, `dashboard-1440.png`.
- The add-lead dialog is asserted to fit inside the viewport, with its **Save** button visible, at 360 and 1440.

Manual review in the desktop app's browser pane on the dev database (seeded fictional data), at 1440 and 360. Visual defects found this way were fixed (see below). Every contrast pair was **measured** (`apps/web/src/styles/index.css` header). The spec's teal `#087F72` is 4.90:1 on white but only 4.47:1 on `#F1F5F9` and 4.33:1 on its tint, so teal text on tinted backgrounds uses `#056B61` (≥5.84:1).

## Tests actually run (command, environment, pass/fail)

| Command                                                                     | Result                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                              | **PASS**, 0 errors, 0 warnings                                                                                 |
| `npm run typecheck`                                                         | **PASS**, 0 errors (contracts, api, web)                                                                       |
| `npm run format:check`                                                      | **PASS**                                                                                                       |
| `npm test` (runs `prisma migrate deploy` on `clientflow_test`, then Vitest) | **PASS**: 4 files, **67 tests** (unit 22, database/health 7, auth 18, contacts 20)                             |
| `npm run test:web` (Vitest + RTL + jsdom)                                   | **PASS**: 2 files, **18 tests**                                                                                |
| `npm run e2e` (Playwright 1.64.1, Edge, axe-core 4.14)                      | **PASS**: **7 tests** (journey, isolation, sign-out, 7-viewport overflow, axe on login/leads/dialog, keyboard) |
| `npm run build`                                                             | **PASS**. Warning: web JS chunk 621 kB (188 kB gzip) exceeds Vite's 500 kB hint                                |
| Production API smoke: `node dist/server.js` + `GET /health/ready`           | **PASS**: `{"status":"ok","checks":{"database":"ok"}}`                                                         |
| `npm run bootstrap:owner` on an already bootstrapped dev DB                 | **PASS**: "Bootstrap refused: … can only run once.", exit 1, DB unchanged (1 agency, 1 owner)                  |

## DB-backed user journey demonstrated

1. `npm run seed:dev` → 1 agency, 7 users, 12 fictional leads in `clientflow` (verified with `psql` counts).
2. Browser pane: wrong password → generic banner, email kept, password cleared. Correct password → dashboard shows **5** leads for salesperson Nour, exactly the 5 of 12 Nour owns.
3. Add lead "Tamer Fawzi" with an email that duplicates an existing lead → 201, navigates to the detail page. The DB row has a normalized email/phone; `audit_events` records `contact.create` with `possibleDuplicateCount: 1`; `activities` has `Lead added by Nour Salem`. A `<script>` in the notes renders as text.
4. Search `?q=delta` → only "Ahmed Rostom" (Delta Logistics).
5. E2E repeats the journey on a clean DB and also reloads the page to prove persistence.

## Authorization and negative testing evidence

All of these are **direct API requests** (Supertest or Playwright `request`), not hidden-button checks:

- Unauthenticated `GET/POST /contacts` → 401, no rows written.
- Sales B `GET /contacts/{A's id}` → 404, with a body identical to that for a non-existent UUID; malformed IDs → 404; B's list/total/search exclude A's records; duplicate hints never reveal A's records.
- Owner/Admin/Sales manager see all agency leads; PM/MEMBER/FINANCE → 403 on list, detail and create.
- A contact in another agency is never returned, even to an owner; the DB itself rejects a cross-agency owner FK.
- Mass assignment: `ownerId`, `agencyId`, `version` in the body → 422 per field, nothing written; `role` in the login body → 422.
- CSRF: missing token → 403, forged token → 403, mismatched pre-session token → 403; foreign or missing `Origin` → 403.
- Sessions: logout then cookie replay → 401; absolute expiry → 401; idle timeout → 401; deactivated user's live session → 401; re-login revokes the previous session.
- Throttling: 3 failures for one email (test config) → 4th and 5th attempts 429, and the correct password is blocked too.
- SQL-like and wildcard search input (`' OR 1=1 --`, `%_%`, `\`) → inert; `50%` matches literally.
- Server failure → 500 with generic message + request ID, no stack, no internal host. Logs contain no password, session cookie, CSRF token, search terms or request-body emails (`[REDACTED]` present).
- `audit_events` UPDATE/DELETE → rejected by the trigger.

## Open bugs and security risks (severity and owner)

**Fixed in M1 (found by tests or review, re-tested):**

1. Search: Prisma `contains` did not escape `%`/`_`, so `%_%` matched everything (Medium). Fixed with `escapeLike` + regression test.
2. Dialog off-screen on mobile while animating: keyframes used `transform: translate`, which stacks with Tailwind v4's `translate` property (High UX). Fixed; E2E asserts the dialog fits at 360.
3. Focus not returned to the opener after closing a dialog (WCAG 2.4.3). Fixed in `Dialog` (ADR-015); E2E keyboard test.
4. Duplicate "Add lead" buttons on mobile (`hidden` lost to `inline-flex`). Fixed.
5. Table column widths summed to 110%, so dates wrapped. Fixed.
6. Expiry test violated the `expires_at > created_at` constraint. The constraint was correct; the test was fixed.

**Open:**

| #   | Issue                                                                                                                            | Severity                | Owner / when                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------- |
| O1  | Login rate limit uses an in-memory store; it is bypassed by running several API instances (ADR-007)                              | High at deploy, Low now | Engineering, before M11 deploy                 |
| O2  | Dev DB user is the Postgres superuser, so it could drop the audit trigger. Production needs a least-privilege app role           | Medium                  | Engineering, M11                               |
| O3  | "Next follow-up" uses the **browser's** timezone. If a user's device is not on Cairo time, the stored instant follows the device | Medium                  | Engineering, M3 (convert with agency timezone) |
| O4  | No breached-password check, only a small denylist                                                                                | Medium                  | Engineering, M2                                |
| O5  | Web bundle 621 kB (no route splitting yet)                                                                                       | Low                     | Engineering, M5                                |
| O6  | `tsx watch` stalls under non-terminal parents on Windows; automation uses `dev:once` (ADR-014)                                   | Low                     | Engineering, monitor                           |
| O7  | No CI yet (secret/dependency scanning, fresh-checkout build)                                                                     | Medium                  | Engineering, M2 (basic CI) / M11               |
| O8  | Login timing is equalized with a dummy hash, but not measured                                                                    | Low                     | Engineering, M11                               |

## Not run / blocked tests and exact steps to reproduce

Run these on your machine in **PowerShell** from the repo root (setup in `docs/16_WINDOWS_SETUP.md`):

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
```

- **Bootstrap with hidden password prompt (NOT RUN; needs an interactive terminal):** on an empty dev DB run `npm run bootstrap:owner -- --agency "Your Agency" --name "Your Name" --email you@example.com`, type a password, then run it again and confirm "Bootstrap refused".
- **Screen reader (NOT RUN):** with NVDA + Edge, sign in, add a lead and open it. Check that field labels, errors and the dialog title are announced.
- **200% zoom and Firefox (NOT RUN):** set the browser zoom to 200% on `/app/leads` and the add-lead dialog; repeat in Firefox.
- **Production cookie flags / HTTPS / HSTS (NOT RUN):** these need a staging deployment (M11).

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv`: 50 rows updated with test file references and this report as evidence. **21 TESTED, 29 IMPLEMENTING (partial, with notes), 149 NOT_STARTED.** GitHub: M1 task issues #14–#21 and the M1 epic #1 track the same IDs.

## Next milestone plan / decisions needed

**Recommended M2 — Identity and policy** (needs your approval before I start):

1. Invitations: owner/admin invites with a role and a one-time, expiring, hashed token; accept flow sets the password (FR-I04, FR-I05, T-AUTH-04, US-03).
2. Password reset with a dev email sink (no real email) and throttling (FR-I06).
3. Team page: deactivate/reactivate, revoke sessions, sole-owner protection, session rotation on role change (FR-I08, FR-I03 remainder, US-19).
4. Declarative permission matrix (spec §1.1) + reusable object-scope helper, with a role × endpoint negative test matrix (FR-I11, SEC-01/02/10).
5. Breached-password check (offline k-anonymity list or bundled top-100k) (SEC-03).
6. Basic GitHub Actions CI: lint, typecheck, unit + integration on a Postgres service, build, secret scan (NFR-11, T-OPS-02).
7. Fix O3 (agency-timezone conversion for "Next follow-up").

**Decisions needed from you (not blocking M2):** email provider for invitations in production (M2 uses a dev sink only); whether client portal acceptance is contractually binding (before M4/M7); invoice tax rules (before M9).

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل:** دلوقتي فيه نظام شغال فعلاً على PostgreSQL حقيقي. بتعمل owner مرة واحدة بس من الـ CLI، ولو جربت تاني بيرفض ومش بيغير حاجة. فيه تسجيل دخول آمن: الباسورد متشفر Argon2id، والـ session متخزنة كـ hash بس، ومعاها حماية CSRF. وبتقدر تضيف leads وتشوفها وتدور فيها من الموبايل والكمبيوتر.
- **الأمان اتجرب من الـ API مباشرة** مش من الواجهة بس. لو بياع حاول يفتح lead بتاعة بياع تاني بياخد 404 من غير أي تفاصيل. ولو حد بعت `ownerId` أو `agencyId` في الطلب بيترفض.
- **التستات:** ‏67 تست للـ API على قاعدة بيانات حقيقية، و18 تست للواجهة، و7 تستات end-to-end على Edge مع فحص accessibility وصور على 7 مقاسات شاشة. كلهم نجحوا.
- **لقينا 6 مشاكل وصلحناها**، أهمها إن البحث بـ `%` كان بيرجع كل حاجة، وإن الـ dialog كان بيطلع برا الشاشة على الموبايل.
- **ماتعملش لسه:** الـ invites والـ password reset وصفحة الفريق، ودول M2. كمان ماجربتش screen reader ولا PowerShell بنفسي، فالأوامر موجودة فوق عشان تشغلها انت.
- **محتاج منك:** موافقتك على M2 بس. باقي القرارات (مزود الإيميل، الضرايب، قانونية موافقة العميل) مش مستعجلة دلوقتي.
