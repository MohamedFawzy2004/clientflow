# ClientFlow Milestone M2 Report

**Milestone:** M2 — Identity and policy · **Date:** 2026-10-24 · **Branch:** `feat/m2-identity-policy` (PR #32, stacked on M1 PR #22)
**Environments:** Windows 11 (Node 24.19.0, Docker Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest` (Node 24 via `.nvmrc`, Postgres 17.6 service, Playwright Chromium).

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Declarative permission matrix + `requirePermission` · invitations (create / replace / revoke / resend / preview / accept) · password reset (request / confirm) with dev mail sink · team management (role change, deactivate, reactivate, sign out everywhere) with last-owner lock and optimistic `version` · offline zxcvbn-ts password policy · agency-timezone follow-up fix (M1 risk O3) · Team, accept-invitation, forgot- and reset-password screens · GitHub Actions CI (lint, typecheck, audit, build, Postgres tests, E2E, gitleaks) |
| **FAILED (found and fixed during M2)** | 5 defects, all fixed and re-tested (see _Open bugs_ → "Fixed in M2")                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **NOT RUN**                            | Real email delivery (no provider chosen) · screen-reader walkthrough · Firefox/Safari · 200% zoom · interactive bootstrap prompt (carried over from M1)                                                                                                                                                                                                                                                                                                                                                                                        |
| **DEFERRED**                           | Audit-log viewer for owners · profile/preferences (FR-I07) · agency settings (FR-I09/I10) · SAST and container scanning (M11) · real email provider adapter (needs your choice)                                                                                                                                                                                                                                                                                                                                                                |

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:** FR-I03, FR-I04, FR-I05, FR-I06, FR-I08, SEC-03, US-03, US-19, T-AUTH-04, NFR-11 and T-OPS-02 (fresh-checkout CI green on GitHub Actions; see _CI evidence_).
- **Progressed, still partial (notes in the CSV):** FR-I11, FR-I12, FR-A03, SEC-02, SEC-10, SEC-17, SEC-18, SEC-21, SEC-24, T-ACL-03, NFR-01, NFR-04, NFR-10, NFR-15, T-UX-03.

## Implemented files / API routes / migrations

**Migration** `prisma/migrations/20261024105035_identity_and_policy`: purely additive. Adds `users.version`, plus the `invitations` and `password_reset_tokens` tables with hash-format, expiry and state checks; a partial unique index (one open invitation per email); a unique accepted-user index; and a staff-roles-only constraint. `prisma migrate diff` against the live DB is empty, so the hand-written indexes are safe (ADR-018).

**API routes** (new in M2):

| Method     | Path                                           | Access                      | Notes                                                    |
| ---------- | ---------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| GET        | `/api/v1/users`                                | `team.read` (Owner, Admin)  | Members with status and active-session count             |
| PATCH      | `/api/v1/users/:id`                            | `team.manage`               | `{role, version}` only; revokes the member's sessions    |
| POST       | `/api/v1/users/:id/deactivate` · `/reactivate` | `team.manage`               | `{version}`; deactivation revokes sessions + reset links |
| POST       | `/api/v1/users/:id/revoke-sessions`            | `team.manage`               | Sign out everywhere                                      |
| GET / POST | `/api/v1/invitations`                          | `team.read` / `team.invite` | Create returns the one-time link once                    |
| POST       | `/api/v1/invitations/:id/revoke` · `/resend`   | `team.invite`               | Old link dies on resend                                  |
| POST       | `/api/v1/invitations/preview` · `/accept`      | public + form CSRF          | Token in body; accept signs in                           |
| POST       | `/api/v1/auth/password-reset/request`          | public + form CSRF          | Always 202; per-IP and per-email throttles               |
| POST       | `/api/v1/auth/password-reset/confirm`          | public + form CSRF          | Single use; revokes all sessions                         |

**Key files:** `packages/contracts/src/{permissions,time}.ts`, `apps/api/src/modules/{invitations,team}/*`, `apps/api/src/modules/auth/{password-reset,sign-in}.ts`, `apps/api/src/lib/{mailer,password}.ts`, `apps/web/src/features/team/*`, `apps/web/src/features/auth/{ActivateInvitePage,PasswordResetPages,AuthCard}.tsx`, `apps/web/src/components/ui/confirm-dialog.tsx`, `.github/workflows/ci.yml`, `.gitleaks.toml`, `e2e/m2.spec.ts`.

## Screenshot / UI review evidence

`docs/milestones/m2-screenshots/` (captured by `npm run e2e:screenshots` against the real API + `clientflow_e2e`):
`team-1440.png`, `team-360.png`, `invite-created-1440.png`, `activate-invite-360.png`, `reset-password-360.png`. Each page in the E2E journey is asserted to have **no horizontal overflow**, and axe found **no serious/critical** violations on the Team page, accept-invitation page and forgot-password page.

Manual check in the browser pane on the dev DB: a salesperson sees no Team link, and `/app/team` shows an explanation. The owner's Team page lists the 7 real dev users, with "You" and "View only" on themselves. (Later pane screenshots were blocked because the app window was minimized; content was checked as page text instead, and the visual review relies on the E2E screenshots above.)

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                          | GitHub Actions      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                 | **PASS**            |
| `npm audit --omit=dev --audit-level=high`     | **PASS**, 0 vulnerabilities                                                                                                              | **PASS**            |
| `npm test` (real Postgres)                    | **PASS**, **131 tests**: unit 28, database 7, auth 18, contacts 20, invitations 22, password reset 10, team 18, role × endpoint matrix 8 | **PASS**            |
| `npm run test:web`                            | **PASS**, **33 tests**: login 5, leads 13, team 7, auth flows 8                                                                          | **PASS**            |
| `npm run e2e` (Edge locally, Chromium in CI)  | **PASS**, **12 tests** (M1 7 + M2 5)                                                                                                     | **PASS** (Chromium) |
| `npm run build`                               | **PASS**                                                                                                                                 | **PASS**            |
| gitleaks 8.24.3 (Docker, full history)        | **PASS**, no leaks in 9 commits                                                                                                          | **PASS**            |

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. The owner opens Team and invites `lina.hassan@e2e.test` as Sales. The dialog shows the one-time link, and the **same link** is in the dev mail sink.
2. In a fresh 360px browser, Lina opens the link. The token is read and then **removed from the address bar**. A common password (`password1234`) is rejected; a passphrase is accepted. She lands signed in, sees no Team link, and `GET /api/v1/users` returns **403**. Re-opening the link shows "This invitation link does not work".
3. While Lina's session is live, the owner deactivates her (with a confirmation step). Her next page load goes to sign-in and `/auth/me` returns **401**.
4. A salesperson uses "Forgot password?". The reset email lands in the sink; they set a new password; the **old password fails** and the new one works.

## Authorization and negative testing evidence

All by direct API requests:

- **Role × endpoint matrix:** each of 7 staff roles calls 9 endpoints. The expected table is hand-written from spec §1.1, not derived from the code. Denied calls return 403 **and** leave contacts, invitations and target users unchanged (version, role, active). Signed out, every endpoint returns 401.
- **Invitations:** single use; 3 concurrent accepts of one token produce exactly one user (`[201, 400, 400]`). Expired, revoked and unknown tokens return one identical 400 body. Email and role cannot be changed at accept (422). Admins cannot invite or revoke owner invitations; nobody can invite CLIENT. Existing member → 409. Mass-assignment fields → 422.
- **Password reset:** known, unknown and deactivated emails get byte-identical 202 bodies, and only the active account gets mail. Older links are voided by newer ones. Two concurrent confirms → `[200, 400]`. Expired links and links of deactivated users are rejected. Every session is revoked and a notification is sent. Throttle: the 3rd request in a window → 429. Tokens and new passwords never appear in logs.
- **Team:** deactivation blocks a live session immediately and voids reset links. Role change revokes sessions and audits `{from, to}`. Stale version → 409, nothing changed. PATCH accepts only `role` + `version` (name, email, active, agencyId → 422). No self-changes. Admins cannot touch owners or grant OWNER. Other-agency users → 404. Two owners demoting each other at the same time still leave exactly one owner.
- **Password policy:** offline zxcvbn-ts rejects `qwertyuiop12`, `Welcome2026!` and passwords containing the user's name or email local part.

## Open bugs and security risks (severity and owner)

**Fixed in M2 (found by tests, CI or review):**

1. Blur validation on autofocused empty fields shifted the layout, so a click on "Forgot password?" missed (UX, Medium). All forms now validate on submit, then live (ADR-020). Caught by E2E.
2. E2E setup quoted arguments for `cmd.exe` even on Linux, so CI created the agency named `"E2E Studio"` with literal quotes. Caught by CI.
3. gitleaks flagged fictional test passphrases. Fixed with a narrow fixture allowlist, no path exclusions, verified locally with the same gitleaks version (no leaks in 9 commits).
4. Team queries ran even for roles without access (harmless 403s, wasted requests). Now gated on `team.read`.
5. A team test was misnamed: it claimed to test the last-owner 409 but actually hit the admin-cannot-touch-owners 403. Renamed, and the concurrent test documents the real guard.

**Open:**

| #   | Issue                                                                                                                                                             | Severity                         | Owner / when                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| O1  | Rate limits still in-memory (single instance only)                                                                                                                | High at deploy                   | Engineering, M11                                   |
| O2  | Dev DB user is superuser (audit trigger could be dropped)                                                                                                         | Medium                           | Engineering, M11                                   |
| O4  | **Closed in M2**: breached-password check added                                                                                                                   | —                                | —                                                  |
| O3  | **Closed in M2**: follow-ups use the agency timezone                                                                                                              | —                                | —                                                  |
| O5  | Web bundle 653 kB (196 kB gzip), up from 621 kB in M1; no route splitting yet                                                                                     | Low                              | Engineering, M5                                    |
| O6  | `tsx watch` stalls under non-terminal parents (ADR-014)                                                                                                           | Low                              | Monitor                                            |
| O7  | **Closed in M2**: CI with dependency audit and secret scanning (SAST/container scanning: M11)                                                                     | —                                | —                                                  |
| O9  | **No real email provider.** Password reset cannot reach users in production until one is chosen. Invitations work via the shown link                              | Medium (blocks production reset) | **Project owner decision**                         |
| O10 | The last-owner `FOR UPDATE` path (409) is race-only and not deterministically reproduced in tests; the invariant (≥ 1 active owner) is asserted under concurrency | Low                              | Engineering                                        |
| O11 | The passphrase-shaped gitleaks allowlist (`word-word-word-NN`) would also ignore a real secret of that exact shape                                                | Low                              | Engineering; keep the convention for fixtures only |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional: refresh docs/milestones/*-screenshots
```

- **Invite flow by hand (NOT RUN by me in your browser):** sign in as owner → Team → Invite member → open the shown link in a private window → accept. The email copy is in `apps/api/.mail-sink/`.
- **Screen reader, Firefox, 200% zoom:** NOT RUN (same steps as the M1 report, plus the Team and accept-invitation pages).
- **Real email delivery:** BLOCKED until you choose a provider.

## CI evidence

CI is defined in `.github/workflows/ci.yml` and runs on every push to `main`/`feat/**` and on PRs (ubuntu-latest, Node 24, Postgres 17.6 service).

| Job                                     | Result on commit `24f34ab` (GitHub Actions)                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Lint, typecheck, audit, build           | **PASS**                                                                             |
| Unit + integration (PostgreSQL)         | **PASS** (131 API + 33 web tests)                                                    |
| Secret scan (gitleaks 8.24.3)           | **PASS** (after the fixture allowlist; the first two runs failed, see _Fixed in M2_) |
| End-to-end (Playwright + axe, Chromium) | **PASS** (12 tests; the first run **FAILED** on the quoting bug, fixed in `260eba1`) |

NFR-11 and T-OPS-02 (fresh-checkout install, lint, typecheck, unit/integration, build) are TESTED from the green jobs above.

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` updated for 26 IDs (tests appended, statuses and notes refreshed); see the CSV for the per-ID remainder. GitHub: M2 issues #23–#31 are linked to PR #32; epic #2 ticks the fully tested IDs.

## Next milestone plan / decisions needed

**Recommended M3 — Sales CRM** (needs your approval):

1. Contacts: edit with optimistic `version` (409 on stale), archive/restore, LEAD → CUSTOMER conversion preserving the ID (FR-C01, FR-C07, US-06, T-CRM-01).
2. Activity timeline: notes and manual call/email/meeting logs with length limits and inert rendering (FR-C08).
3. Owner reassignment by managers, with history (FR-D08 pattern for contacts).
4. Pipelines and stages (stable IDs, ordered), deals with amount in minor units + currency, list and Kanban with a keyboard fallback, won/lost with reasons (FR-D01–D08, US-07, T-DEAL-01).
5. Follow-up queue: overdue and no-next-step views (FR-D07, J1 step 5).
6. Extend the role × endpoint matrix to every new endpoint; add contact/deal PATCH mass-assignment tests (T-ACL-03).

**Decisions needed from you:**

- **Email provider** for production (e.g. Resend, Postmark, Amazon SES). Needed before real password resets. A domain you control will need SPF/DKIM records.
- (Before M4) Whether client acceptance of proposals is meant to be contractually binding in your market, or "operational approval" only (spec FR-Q11).

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M2:** بقى فيه صفحة **Team** للـ owner والـ admin. منها بتعزم حد بإيميله ودوره، وهو بيفتح اللينك ويختار اسمه وباسورده ويدخل على طول. وتقدر تغيّر دور أي حد، أو توقّف حسابه، أو تخرّجه من كل الأجهزة.
- **نسيت الباسورد:** شغال. بيوصل لينك صالح مرة واحدة لمدة 30 دقيقة. ولما الباسورد يتغير، كل الأجهزة اللي كانت فاتحة بتخرج.
- **الأمان:**
  - لو حد اتوقف حسابه، بيخرج **فورًا** حتى لو كان فاتح.
  - مستحيل الوكالة تفضل من غير owner، حتى لو اتنين owners حاولوا يشيلوا بعض في نفس اللحظة.
  - الـ admin مايقدرش يلمس حساب الـ owner.
  - الباسوردات الضعيفة أو اللي فيها اسمك أو إيميلك بتترفض، والفحص ده بيحصل على السيرفر نفسه من غير ما الباسورد يطلع لأي خدمة برا.
- **التستات:** ‏131 تست للـ API، منهم جدول بيجرب كل دور (7 أدوار) على كل endpoint. و33 تست للواجهة، و12 end-to-end. وكمان بقى فيه **CI على GitHub** بيشغّل كل ده على كل push.
- **لقينا 5 مشاكل وصلحناها**، أهمها إن لينك "Forgot password?" كان ساعات مابيتضغطش بسبب رسالة خطأ بتظهر وتزق الصفحة.
- **محتاج منك قرار واحد مهم:** أنهي خدمة إيميل هنستخدمها في الإنتاج (Resend أو Postmark أو SES). من غيرها الـ reset مش هيوصل للناس الحقيقيين. الـ invites شغالة دلوقتي لأنك بتنسخ اللينك وتبعته بنفسك.
