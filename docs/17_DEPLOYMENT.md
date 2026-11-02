# Deploying ClientFlow (staging / demo)

> **Status (M12.1):** ready for staging on Render with Resend email (see [Staging on Render](#staging-on-render-m121)). Not deployed until the owner applies the Blueprint.
>
> **Status (M12):** a demo workspace can be built and reset safely (see [Demo workspace](#demo-workspace)).
>
> **Status (M11):** the production image is built, scanned in CI and smoke-tested locally against PostgreSQL. A backup was restored into an isolated database and reconciled (`docs/milestones/m11-restore-drill.txt`). **Nothing has been deployed.** A hosting provider and an email provider still have to be chosen by the project owner. Read `docs/18_PRIVACY_RETENTION.md` and `docs/19_RUNBOOK.md` before real client data goes in.

## What you deploy

One container image (`Dockerfile`) runs the API **and** serves the built web app on the same origin (ADR-034). Session cookies stay first-party and there is no CORS to configure. A second image target, `migrate`, applies database migrations and exits.

| Image                  | Command                                                 | Purpose                                          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `clientflow` (default) | `docker build -t clientflow .`                          | Web + API, port 4000, unprivileged user          |
| `clientflow-migrate`   | `docker build -t clientflow-migrate --target migrate .` | `prisma migrate deploy`, run before each release |

Any platform that runs a container and a managed PostgreSQL 17 works: Render, Railway, Fly.io, a VPS with Docker, and so on.

The migrations create the `pg_trgm` extension, which indexes contact search. It ships with PostgreSQL, is a trusted extension, and Render, Railway and most managed services allow it. If a server does not offer it, the migration logs a warning and skips those indexes; search still works, only more slowly on large lists.

## Requirements

- **PostgreSQL 17**, reachable only from the app. Use a dedicated database user that **is not a superuser** (risk O2). It needs `CREATE`/`ALTER` on its own database for migrations.
- **HTTPS in front of the container** (the platform's proxy or your own). The app refuses `http://` origins in production.
- **A domain**, e.g. `crm.youragency.com`.

## Environment variables

Set these as secrets in the platform. Never put them in the image or the repository.

| Variable                                         | Required    | Example / rule                                                                                                                                                      |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                       | set         | `production` (already set in the image)                                                                                                                             |
| `DATABASE_URL`                                   | yes         | `postgresql://clientflow_app:…@db-host:5432/clientflow?sslmode=require`                                                                                             |
| `DB_POOL_MAX`                                    | no          | Connections per API process, default `10`. Keep the total of all processes below the server's `max_connections`                                                     |
| `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` | no          | Defaults 15000 and 3000. A statement past either limit is stopped and the request gets 503 with `Retry-After`                                                       |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`              | no          | Default 120000. The server ends a transaction left idle this long, releasing its locks                                                                              |
| `DB_CONNECT_TIMEOUT_MS`                          | no          | Default 5000. Longest a request waits for a free pool connection before 503                                                                                         |
| `APP_ORIGINS`                                    | yes         | `https://crm.youragency.com` (exact origin, https only, comma-separated if several)                                                                                 |
| `APP_PUBLIC_URL`                                 | no          | Base URL for emailed links; defaults to the first origin                                                                                                            |
| `CSRF_SECRET`                                    | yes         | 32+ random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`                                                        |
| `FILE_ENCRYPTION_KEY`                            | yes         | 64 hex characters (32 bytes): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Back it up with the files: without it they cannot be read |
| `FILE_STORAGE_DIR`                               | no          | Default `/data/files` in the image. Mount a persistent volume there and include it in backups                                                                       |
| `FILE_MAX_BYTES` / `FILE_PROJECT_QUOTA_BYTES`    | no          | Defaults 25 MB per file and 2 GB per project                                                                                                                        |
| `TRUST_PROXY`                                    | yes         | Number of proxies in front (usually `1`), so rate limits see the real client IP                                                                                     |
| `HOST` / `API_PORT`                              | set         | `0.0.0.0` / `4000` (already set in the image)                                                                                                                       |
| `WEB_DIST_DIR`                                   | set         | `/app/apps/web/dist` (already set in the image)                                                                                                                     |
| `MAIL_TRANSPORT`                                 | set         | `disabled` in the image. `resend` sends through Resend (ADR-068); `dev-sink` is refused in production                                                               |
| `RESEND_API_KEY`                                 | with resend | A Resend key with sending access only (`re_…`)                                                                                                                      |
| `MAIL_FROM`                                      | with resend | `ClientFlow <noreply@mail.youragency.com>`, on a domain verified in Resend                                                                                          |
| `CLAMAV_HOST` / `CLAMAV_PORT`                    | no          | The ClamAV service (port 3310). When set, every upload is scanned and refused while the scanner is unreachable                                                      |
| `MFA_REQUIRED_ROLES`                             | no          | Roles that must use two-step sign-in (ADR-069). Default `OWNER,ADMIN` in production; `none` to turn the requirement off (not recommended)                           |
| `LOG_LEVEL`                                      | no          | `info`                                                                                                                                                              |
| `JOBS_ENABLED`                                   | no          | `true` (default): the background worker runs inside the app. Set `false` only if a separate `node apps/api/dist/cli/jobs.js worker` process runs it                 |
| `JOBS_POLL_SECONDS` / `REMINDER_SCAN_MINUTES`    | no          | Defaults 10 s and 15 min                                                                                                                                            |
| `DEMO_MODE`                                      | no          | `false` (default). `true` only on a demo deployment: allows `demo-reset` and refuses a sending mail transport (ADR-066)                                             |
| `APP_RELEASE`                                    | no          | The release name or git SHA, shown to Owner/Admin in Settings → System status                                                                                       |

The app **refuses to start** with placeholder secrets, an `http://` origin, or the development mail sink.

## First release

```bash
# 1. Migrate the empty database
docker run --rm -e DATABASE_URL="$DATABASE_URL" clientflow-migrate

# 2. Start the app (on your platform: image + env vars + port 4000 + health check /health/ready)
docker run -d --name clientflow -p 4000:4000 --env-file production.env clientflow

# 3. Create the one owner account (no public sign-up exists)
docker exec -e BOOTSTRAP_OWNER_PASSWORD='…a long passphrase…' clientflow \
  node apps/api/dist/cli/bootstrap-owner.js --agency "Your Agency" --name "Your Name" --email you@youragency.com
```

Then sign in at `https://crm.youragency.com/login` and invite the team from **Team**.

**Demo data:** `seed:dev` refuses `NODE_ENV=production` on purpose. For a public demo, use a separate demo database and agency, and enter fictional data through the app.

## Each later release

1. Build both images from the same commit.
2. Take a backup (below), then run `clientflow-migrate` against the database. All migrations so far (M1–M11) are additive; the M11 one was rehearsed on a restored copy (NFR-14).
3. Replace the running `clientflow` container. Wait for `/health/ready` to report `{"status":"ok"}`.

## Health checks and monitoring

- `GET /health/live`: the process is up (also the image's `HEALTHCHECK`).
- `GET /health/ready`: the database answers (503 when not). `{"status":"degraded","checks":{"jobs":"lagging"}}` (still 200) means background jobs have waited over 15 minutes: emails and reminders are late, the app still works. Use it for the readiness probe and alert on `degraded`.
- **Logs** are JSON lines on stdout, one per request, with a request id and no cookies, tokens or bodies. Unhandled errors are logged as one `error`/`fatal` line; an uncaught exception restarts the container. Ship stdout to the platform's log search and alert on `"level":50` and above.
- **Settings → System status** (Owner/Admin): database response time, oldest waiting job, failed jobs, uptime, memory, and whether sign-in limits are shared.

## Background worker and rate limits

The worker (emails, reminders) runs inside each app container and is safe with several containers. Sign-in and one-time-link limits are counted in PostgreSQL, so they hold across restarts and instances. The general per-IP API limit (1,000 requests per 15 minutes) is counted per instance (ADR-062).

## Backups and restore (NFR-08, T-OPS-01)

Two things make up a backup: the **database** and the **encrypted file volume** (`FILE_STORAGE_DIR`). The **`FILE_ENCRYPTION_KEY`** is kept apart, in the secret manager: without it the files cannot be read, and it is never inside a backup.

- **Platform backups:** turn on the managed PostgreSQL's daily backups with point-in-time recovery, and the volume's snapshots, at the same schedule. Keep at least 30 days (see the retention document).
- **ClientFlow backup** (portable, verifiable): from an operations machine with the repository, Docker or `pg_dump` 17, and access to the database and a copy of the file volume:

  ```bash
  DATABASE_URL=… FILE_STORAGE_DIR=/path/to/files FILE_ENCRYPTION_KEY=… npm run backup -- --out backups/2026-11-01
  ```

  It writes `db.dump`, `files/` (still encrypted) and `manifest.json` (row counts, migrations, checksums, key fingerprint). Store it encrypted and off the host. It contains personal data.

- **Restore** only into an **empty, separate** database and folder; the tool refuses the live database:

  ```bash
  DATABASE_URL=<live, for the refusal check> FILE_ENCRYPTION_KEY=… npm run restore -- \
    --from backups/2026-11-01 --target-url postgresql://…/clientflow_restore --storage-dir /restore/files
  ```

  It reports `RECONCILED` only when the migrations and every table's row count match, and every stored file decrypts to its recorded checksum. Then point a staging app at the restored copy, sign in and check a few records by eye.

- **Drill:** repeat the restore every quarter and after any change to backups, and keep the output (M11 drill: `docs/milestones/m11-restore-drill.txt`).
- **RPO/RTO:** to be decided by the project owner (NFR-08). With daily platform backups plus point-in-time recovery, a few minutes of data loss and about an hour to restore are realistic starting points.

## Image security

CI builds the image and fails on HIGH/CRITICAL advisories that have a fix (Trivy). Exceptions are listed in `.trivyignore`, each with a reason. The runtime image has no npm, npx or compilers and runs as the `node` user. Debian security updates are applied at build time; a build without mirror access fails, unless `--build-arg OS_UPDATES=0` is passed (local builds only). Rebuild and redeploy at least monthly, so base-image fixes reach production.

## Staging on Render (M12.1)

Staging is for the pilot and for checks on a real host. It holds **no real client data** until the
release checklist allows it. Everything below is done by the project owner in the Render and
Resend dashboards; nothing in the repository contains a secret.

`render.yaml` (a Render Blueprint, validated against Render's schema) creates:

| Resource                         | Plan in `render.yaml`  | Why                                                                        |
| -------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `clientflow-staging` web service | `0.5c-512mb`           | The Docker image (app + API). Paid, because it needs a disk and pre-deploy |
| Disk `clientflow-files`, 1 GB    | —                      | Encrypted uploads at `/data/files`. Render snapshots it daily, kept 7 days |
| `clientflow-staging-db`          | `0.5c-1g`, Postgres 17 | Reachable only from services in your Render account                        |
| `clientflow-clamav` private svc  | `2c-4g`                | Antivirus for uploads; ClamAV needs 3–4 GB of memory                       |

Check the current prices on Render's pricing page before applying: the antivirus service is the
largest part. To start without it, delete the `clientflow-clamav` service and the two `CLAMAV_*`
lines from `render.yaml`. Uploads then keep the built-in checks only, as today (R25).

### 1. Email: Resend

1. Create a Resend account. Add a domain you control, preferably a subdomain such as
   `mail.youragency.com`.
2. Add the DNS records Resend shows (SPF and DKIM, plus its bounce record) at your DNS provider.
   Wait until Resend shows the domain as verified.
3. Add a DMARC record for the domain, starting in monitoring mode:
   `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@youragency.com`. Tighten it to
   `p=quarantine` once reports look clean.
4. Create an API key with **sending access only**, limited to that domain. Keep it in your password
   manager.

### 2. The file encryption key

Generate it once and keep it in your password manager. Without it, uploaded files cannot be read,
and backups never contain it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Apply the Blueprint

1. In Render: **New → Blueprint**, connect the GitHub repository, choose the branch to deploy
   (`main` once the release is merged).
2. Render asks for the values marked `sync: false`:
   - `APP_ORIGINS`: `https://clientflow-staging.onrender.com` (Render shows the exact address;
     change it later if you add a custom domain);
   - `FILE_ENCRYPTION_KEY`: the key from step 2;
   - `RESEND_API_KEY` and `MAIL_FROM` (for example `ClientFlow <noreply@mail.youragency.com>`).
3. Apply. Render builds the image, runs `node apps/api/dist/cli/migrate.js` before the release
   goes live (a failure keeps the previous release), and waits for `/health/ready`.
4. If the log says **"File storage folder is not writable"**, the disk was mounted with an owner
   the app cannot write as. Tell me and I will adjust the image.

Deploys are manual (`autoDeploy: false`): choose **Manual Deploy** in Render after each merge.

### 4. Create the owner account

In the service's **Shell** tab:

```bash
node apps/api/dist/cli/bootstrap-owner.js --agency "Your Agency" --name "Your Name" --email you@youragency.com
```

It asks for a password (hidden). It refuses to run a second time.

Then sign in at the staging address. Owners and Admins must turn on **two-step sign-in** before anything else: scan the QR code with an authenticator app and save the 10 recovery codes in your password manager. If you ever lose both, `node apps/api/dist/cli/reset-mfa.js --email you@youragency.com` in the Shell turns it off for that account.

### 5. Check the deployment

From your computer, with the staging address and the owner account:

```bash
node scripts/staging-check.mjs --base https://clientflow-staging.onrender.com --email you@youragency.com
```

It asks for your password and a code from your authenticator app. It checks HTTPS, cookies,
security headers, CSRF and origin rules, health, two-step sign-in, the virus scanner, and the
address the server sees for you (it prints whether `TRUST_PROXY` looks right). Keep its output
with the release records.

### 6. Restore drill on Render

The database accepts connections only from inside Render. For the drill:

1. In the database's **Access control**, temporarily add your current IP address.
2. Run `npm run backup` from your computer against the database's **external** connection string,
   with a copy of the disk's files (download them through the Shell, or use an empty folder if
   nothing was uploaded yet).
3. Run `npm run restore` into a separate, empty database (local, or a second Render database),
   and keep the `RECONCILED` output.
4. Remove your IP address from the access list again.

Render's own database backups and the daily disk snapshots remain the first line of recovery.

### 7. Custom domain (optional)

Add the domain in the service's **Settings → Custom Domains**, create the DNS record Render shows,
then set `APP_ORIGINS` to `https://` plus that domain and redeploy.

## Demo workspace

A demo is a **separate deployment with its own database and file volume**, never the real
workspace. It holds a fictional agency with a user for every role and three client organizations
(spec §21), built through the real API (ADR-066).

- Database: a name that contains `demo`, e.g. `clientflow_demo`.
- Environment: `DEMO_MODE=true` and `MAIL_TRANSPORT=disabled` (the app refuses a sending transport
  in demo mode). Everything else as above.
- Build or rebuild the demo (it deletes the current demo first):

  ```bash
  # From the repository (local or an operations machine)
  DATABASE_URL=…/clientflow_demo DEMO_MODE=true npm run demo:reset -- --confirm clientflow_demo
  # Inside the production image (no npm there)
  node apps/api/dist/cli/demo-reset.js --confirm clientflow_demo
  ```

  It refuses unless `DEMO_MODE=true`, the database name contains `demo` and is typed back, and the
  database is empty or holds only a demo workspace. Pointed at a real database by mistake, it stops
  before deleting anything.

- The new passwords are written to `apps/api/.demo-credentials.local.json` on the machine that ran
  it. They change on every reset.
- Every page shows a **Demo workspace** notice.
- Locally: `npm run demo:tour` rebuilds the demo in `DEMO_DATABASE_URL` and walks each role's main
  journey in Chromium, Firefox and WebKit.

A public demo still needs the owner's hosting choice, a reset schedule (for example nightly) and a
decision on how visitors get the demo accounts.

## Known gaps before real client data

- **Email (O9):** Resend is built in (ADR-068); the owner still has to verify a domain (SPF, DKIM, DMARC).
- **Antivirus (R25):** ClamAV is built in (ADR-070) and runs as its own Render service; without it, uploads get the built-in checks only.
- **Nothing is deployed yet:** the staging check and the hosted restore drill wait for the first deploy.
- **Legal and privacy review** of `docs/18_PRIVACY_RETENTION.md` before real client data (SEC-23).
- **RPO/RTO** and the backup schedule are the owner's decision.
- **Migrations** run from the app image (`node apps/api/dist/cli/migrate.js`, ADR-067); the separate `migrate` image with Prisma's CLI is still built and used by CI to check the result.
