# Staging and public demo (no paid resources)

> **Status:** prepared and verified locally on 2026-11-04. **Nothing is deployed.** The public demo needs the owner's Render and Neon accounts (both free, no payment method). Decision record: ADR-071. How-to: `docs/17_DEPLOYMENT.md`.

## 1. Decisions taken

| Question            | Decision                                                         | Why                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Staging             | **Local production-like staging** (`docker-compose.staging.yml`) | No free host gives a persistent disk, a private database with backups and 3–4 GB for ClamAV. The paid `render.yaml` waits for the pilot. |
| Public demo         | **Render Free web + Neon Free PostgreSQL** (`render.demo.yaml`)  | Both free without a card (check at sign-up). The demo needs no disk, because it rebuilds itself on every start.                          |
| Demo access         | **"Explore as …" role buttons** on the sign-in page              | No password is ever published; each visitor gets an ordinary session.                                                                    |
| Uploads in the demo | **Off**; the seeded files stay viewable                          | No antivirus on a free host, and the disk is wiped on each restart.                                                                      |
| Demo reset          | **On every start** (`DEMO_RESET_ON_BOOT`)                        | A free service sleeps after about 15 idle minutes, so each wake is a clean demo. No reset endpoint exists.                               |

## 2. Architecture

**Local staging** (your PC, $0):

```
browser / staging-check ──HTTPS──> Caddy (internal CA, 127.0.0.1:8443; HTTP 8080 → HTTPS)
                                        │
                                        v
          app (the production image: migrate → start; TRUST_PROXY=1; MAIL_TRANSPORT=disabled)
            │                    │                      │
            v                    v                      v
  PostgreSQL 17           ClamAV 1.5.4           volume /data/files
  (clientflow_app,        (every upload,         (encrypted, persistent)
   not a superuser;        fails closed)
   127.0.0.1:5434 for
   backups only)
```

**Public demo** ($0):

```
visitor ──HTTPS──> Render Free web service "clientflow-demo" (same Docker image)
                     DEMO_MODE=true · DEMO_RESET_ON_BOOT=clientflow_demo · MAIL_TRANSPORT=disabled
                     uploads off · role sign-in · write cap · JOBS_POLL_SECONDS=60
                       │ TLS (sslmode=require), generated password
                       v
                   Neon Free project "clientflow-demo", database clientflow_demo (fictional only)

GitHub Actions (free): CI → "Deploy demo" (manual, needs green CI) → Render deploy hook
                       "Demo health" every 6 hours → opens an issue on failure
```

**Isolation:**

- The demo has its own Render service, Neon project, database, `CSRF_SECRET` and `FILE_ENCRYPTION_KEY`. It shares no secret, database or storage with staging or any real workspace.
- Every reset first checks that the database name contains `demo` and is typed back, and that every agency in it is a demo agency.

## 3. Providers and free-tier limits

Checked in November 2026, mostly from third-party summaries. Check each provider's own pricing page at sign-up, and stop if one asks for a card.

| Provider                              | Free tier                                                                                                                                  | Fit               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **Render Free web**                   | 512 MB; sleeps after ~15 min idle, ~1 min to wake; 750 instance-hours/month per workspace; no persistent disk; no pre-deploy step or shell | **Demo app**      |
| Render Free Postgres                  | 1 GB; expires 30 days after creation (+14-day grace); no backups                                                                           | No                |
| **Neon Free**                         | 0.5 GB per project; 100 CU-hours/month; scales to zero after 5 min idle; public endpoint (IP allow-list is paid)                           | **Demo database** |
| Fly.io                                | No free tier for new accounts (trial only); card required                                                                                  | No                |
| Koyeb                                 | One small free service; sources say a card is required                                                                                     | No                |
| Oracle Always Free, Google Cloud, AWS | Need a payment card on file                                                                                                                | No                |
| Cloudflare R2                         | 10 GB free; the app has no S3 storage driver yet                                                                                           | Later, with code  |

Measured locally with the production image and a 512 MB memory cap:

- the demo rebuilt itself on start in about 5 seconds;
- it then ran at about 200 MB of memory.

## 4. Costs and limitations

**Costs:** none now. Paid staging (`render.yaml`: web + disk + Postgres + ClamAV) is a decision for the pilot. ClamAV is the largest part of its cost.

**Demo limitations, stated on the sign-in page:**

- The first visit after a quiet period takes about a minute.
- Changes disappear on the next start.
- No emails, no payments, no uploads.
- One instance, with no uptime promise.
- If 750 hours or 100 CU-hours run out, the demo stops until the next month. The fallback is the local demo (`npm run demo:reset`, `npm run demo:tour`) or a screen recording.

**Local staging limitations:**

- It proves the image, TLS, cookies, headers, CSRF/Origin, database role, ClamAV, worker, persistence, migrations and backup/restore.
- It does not prove a cloud proxy chain: TRUST_PROXY is reported SKIP locally (R58).

## 5. Secret and configuration management

- **No secret is in the repository.** gitleaks runs in CI, and `.env`, `.env.*`, `*.local.json`, `*.crt` and `deploy/staging/.env.staging` are gitignored.
- **One set of secrets per environment,** never shared: local staging, the demo, and later the paid staging.
- **Where they live:**
  - Local staging: `deploy/staging/.env.staging` on your PC.
  - Demo: Render's environment settings (`sync: false`), plus the Neon connection string.
  - GitHub: the deploy hook URL only, as a secret.
- **Your password manager holds:**
  - each `FILE_ENCRYPTION_KEY`, needed with any backup;
  - the Neon password;
  - the Render deploy hook URL.

### Environment variable checklist: public demo (Render)

| Variable                                      | Value                                                                                                    | Where              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------ |
| `DATABASE_URL`                                | Neon **direct** connection string (not `-pooler`), database `clientflow_demo`, ending `?sslmode=require` | Render (secret)    |
| `APP_ORIGINS`                                 | `https://clientflow-demo.onrender.com` (the address Render shows)                                        | Render             |
| `FILE_ENCRYPTION_KEY`                         | 64 hex characters, new for the demo                                                                      | Render (secret)    |
| `CSRF_SECRET`                                 | generated by Render                                                                                      | Render             |
| `DEMO_MODE` / `DEMO_RESET_ON_BOOT`            | `true` / `clientflow_demo`                                                                               | `render.demo.yaml` |
| `MAIL_TRANSPORT`                              | `disabled` (the app refuses a sending transport in demo mode)                                            | `render.demo.yaml` |
| `TRUST_PROXY`                                 | `1`                                                                                                      | `render.demo.yaml` |
| `JOBS_POLL_SECONDS` / `REMINDER_SCAN_MINUTES` | `60` / `60`                                                                                              | `render.demo.yaml` |
| `DEMO_WRITE_LIMIT_PER_IP`                     | default 120 per 15 min                                                                                   | optional           |
| `RENDER_DEMO_DEPLOY_HOOK`                     | Render deploy hook URL                                                                                   | GitHub secret      |
| `DEMO_URL`                                    | the demo address                                                                                         | GitHub variable    |

### Environment variable checklist: local staging

`deploy/staging/.env.staging`, copied from `deploy/staging/staging.env.example`:

- `STAGING_PG_ADMIN_PASSWORD`
- `STAGING_APP_DB_PASSWORD`
- `CSRF_SECRET`
- `FILE_ENCRYPTION_KEY`
- `LOG_LEVEL`

The compose file sets everything else (production mode, origin, ClamAV, proxy count, mail off).

## 6. CI/CD release process

1. A pull request goes to `main`. The six CI jobs must pass: quality, API tests on PostgreSQL, E2E, image + Trivy + migration smoke, gitleaks, CodeQL. **Recommended owner step:** branch protection on `main` requiring them.
2. Merge, then run **Actions → Deploy demo** from `main`. It:
   - refuses if CI on that commit did not pass;
   - calls the Render deploy hook;
   - waits for `/health/ready`;
   - checks the security headers.
     Optionally, give the `demo` environment required reviewers, so every deploy waits for your approval.
3. Render builds the image. The container migrates (advisory lock), rebuilds the demo, then starts listening. Render routes traffic only once its health check passes.
4. **Local staging release:** `npm run staging:up`, then `npm run staging:check`, then a backup and restore drill.

## 7. Monitoring and alerting (free)

- **Demo health workflow,** every 6 hours. It checks:
  - `/health/live`;
  - `/health/ready` reporting `ok`;
  - the demo sign-in list;
  - HSTS, CSP and nosniff headers.
    On failure it opens or comments on one `demo-health` issue, and GitHub emails you. It runs every 6 hours rather than every few minutes, so the free limits last.
- **Logs:** Render's log viewer (JSON lines with request IDs; search `"level":50`). Locally: `npm run staging:logs`.
- **In-app:** Settings → System status for the Owner (database, jobs, scanner, release).
- **Later, optional:** Sentry's free plan for error grouping. Not added now.

## 8. Backup and restore

- **Demo:** no backups, on purpose. The data is fictional and rebuilt on every start, so the reset is the restore.
- **Local staging:** before each migration and every quarter, run `npm run backup` against `127.0.0.1:5434`, then `npm run restore` into `clientflow_staging_restore` and keep the `RECONCILED` output. Verified on 2026-11-04: 46 tables, 63 rows and 1 file reconciled.
- **Paid staging/pilot (later):** Render point-in-time recovery and disk snapshots, plus the same portable backup (`docs/17_DEPLOYMENT.md`).

## 9. Rollback and incident response

- **Bad demo release:** in Render, use Rollback to the previous deploy. Migrations so far are additive, so older code runs on the newer schema. A restart rebuilds the demo.
- **Bad migration:**
  - demo: roll back, and the next start rebuilds the data;
  - staging: restore the pre-migration backup into a new database and point the app at it.
- **Suspected demo abuse or compromise** (procedures in `docs/19_RUNBOOK.md`):
  1. suspend the service in Render, which stops all traffic;
  2. rotate `CSRF_SECRET` and the Neon password;
  3. redeploy, which resets the demo;
  4. read the logs by request ID;
  5. if needed, lower `DEMO_WRITE_LIMIT_PER_IP`.

## 10. Demo abuse protection

| Requirement                                 | How it is met                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Dedicated database and file storage         | Its own Neon project and container disk; nothing shared                                                 |
| Fictional data only, no link to client data | The seeder creates a fictional agency; the reset refuses any database holding a non-demo agency         |
| Controlled demo access                      | "Explore as …" per role: rate-limited, form-token protected, demo agency only, no published password    |
| Safe rate limiting                          | Existing per-IP API and sign-in limits, plus the demo write cap (120 per 15 min)                        |
| No live payments                            | The app has no payment integration; invoices only record payments                                       |
| No external email                           | `MAIL_TRANSPORT=disabled`, enforced at start in demo mode                                               |
| Protected uploads                           | Uploads and file deletion refused (403 `DEMO_RESTRICTED`); the UI says so                               |
| No public reset endpoint                    | None exists; the reset runs only inside the process at start                                            |
| Reliable reset                              | On every start, with the same safety checks as `demo:reset`                                             |
| Clear labelling                             | "Explore the demo" panel on sign-in, and the "Demo workspace" notice on every page                      |
| No lockouts or account minting              | Password reset, two-step changes, people changes, invitations and workspace settings refused in the API |

## 11. Verification (2026-11-04, Windows 11, Docker Desktop)

- **Local staging, production image:**
  - all 15 migrations applied by the image;
  - the app database user is not a superuser;
  - `npm run staging:check` reported all checks passed, with TRUST_PROXY skipped locally. That covers HTTPS redirect, HSTS, CSP, cookies (`__Host-`, Secure, HttpOnly, SameSite), CSRF, Origin, CORS, two-step sign-in, shared sign-in limits, virus scanner, jobs and sign-out.
- **Uploads and persistence:** an upload was scanned CLEAN by the real ClamAV. After an app restart it downloaded with a matching SHA-256.
- **Worker:** processed its job.
- **Backup and restore:** `RECONCILED`.
- **Boot reset refusal:** the image with `DEMO_MODE=true` and `DEMO_RESET_ON_BOOT` against the non-demo staging database refused, logged the reason and did not start. The staging data was unchanged.
- **Demo boot, image under a 512 MB cap:**
  - rebuilt the demo in about 5 s at about 200 MB;
  - role sign-in worked;
  - invitations, uploads, two-step setup and workspace settings answered 403 `DEMO_RESTRICTED`;
  - seeded files downloaded;
  - a visitor's change was gone after a restart.
- **Not verified, needing the owner's accounts:** the real Render and Neon deploy, the deploy hook, the scheduled health check, and TRUST_PROXY behind Render's proxy.

## 12. Owner decisions and steps still needed

1. **Create accounts, no card:** Render (sign in with GitHub) and Neon. If either asks for a payment method, stop and tell me.
2. **Neon:**
   - create the project `clientflow-demo` and the database `clientflow_demo`;
   - copy the **direct** connection string into your password manager.
3. **Render:** New → Blueprint → this repository → `render.demo.yaml`. Enter `DATABASE_URL`, `APP_ORIGINS` and `FILE_ENCRYPTION_KEY`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **GitHub:**
   - secret `RENDER_DEMO_DEPLOY_HOOK`;
   - variable `DEMO_URL`;
   - optionally, reviewers on the `demo` environment.
5. **Approve the first deploy:** run **Deploy demo**, then check the demo from your computer. It signs in with "Explore as Owner" (there is no password), and also confirms that restricted actions are refused. A virus-scanner WARN is expected, because uploads are off in the demo:
   ```bash
   node scripts/staging-check.mjs --base https://clientflow-demo.onrender.com --demo-role OWNER
   ```
6. **Still open from earlier:**
   - branch protection on `main`;
   - a license;
   - a release tag;
   - when the pilot starts, the paid staging (`render.yaml`).
