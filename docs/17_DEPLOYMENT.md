# Deploying ClientFlow (staging / demo)

> **Status (M11):** the production image is built, scanned in CI and smoke-tested locally against PostgreSQL. A backup was restored into an isolated database and reconciled (`docs/milestones/m11-restore-drill.txt`). **Nothing has been deployed.** A hosting provider and an email provider still have to be chosen by the project owner. Read `docs/18_PRIVACY_RETENTION.md` and `docs/19_RUNBOOK.md` before real client data goes in.

## What you deploy

One container image (`Dockerfile`) runs the API **and** serves the built web app on the same origin (ADR-034). Session cookies stay first-party and there is no CORS to configure. A second image target, `migrate`, applies database migrations and exits.

| Image                  | Command                                                 | Purpose                                          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `clientflow` (default) | `docker build -t clientflow .`                          | Web + API, port 4000, unprivileged user          |
| `clientflow-migrate`   | `docker build -t clientflow-migrate --target migrate .` | `prisma migrate deploy`, run before each release |

Any platform that runs a container and a managed PostgreSQL 17 works: Render, Railway, Fly.io, a VPS with Docker, and so on.

## Requirements

- **PostgreSQL 17**, reachable only from the app. Use a dedicated database user that **is not a superuser** (risk O2). It needs `CREATE`/`ALTER` on its own database for migrations.
- **HTTPS in front of the container** (the platform's proxy or your own). The app refuses `http://` origins in production.
- **A domain**, e.g. `crm.youragency.com`.

## Environment variables

Set these as secrets in the platform. Never put them in the image or the repository.

| Variable                                      | Required | Example / rule                                                                                                                                                      |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | set      | `production` (already set in the image)                                                                                                                             |
| `DATABASE_URL`                                | yes      | `postgresql://clientflow_app:…@db-host:5432/clientflow?sslmode=require`                                                                                             |
| `APP_ORIGINS`                                 | yes      | `https://crm.youragency.com` (exact origin, https only, comma-separated if several)                                                                                 |
| `APP_PUBLIC_URL`                              | no       | Base URL for emailed links; defaults to the first origin                                                                                                            |
| `CSRF_SECRET`                                 | yes      | 32+ random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`                                                        |
| `FILE_ENCRYPTION_KEY`                         | yes      | 64 hex characters (32 bytes): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Back it up with the files: without it they cannot be read |
| `FILE_STORAGE_DIR`                            | no       | Default `/data/files` in the image. Mount a persistent volume there and include it in backups                                                                       |
| `FILE_MAX_BYTES` / `FILE_PROJECT_QUOTA_BYTES` | no       | Defaults 25 MB per file and 2 GB per project                                                                                                                        |
| `TRUST_PROXY`                                 | yes      | Number of proxies in front (usually `1`), so rate limits see the real client IP                                                                                     |
| `HOST` / `API_PORT`                           | set      | `0.0.0.0` / `4000` (already set in the image)                                                                                                                       |
| `WEB_DIST_DIR`                                | set      | `/app/apps/web/dist` (already set in the image)                                                                                                                     |
| `MAIL_TRANSPORT`                              | set      | `disabled` (already set). There is no real provider yet: invitation links are shown on screen to copy (risk O9)                                                     |
| `LOG_LEVEL`                                   | no       | `info`                                                                                                                                                              |
| `JOBS_ENABLED`                                | no       | `true` (default): the background worker runs inside the app. Set `false` only if a separate `node apps/api/dist/cli/jobs.js worker` process runs it                 |
| `JOBS_POLL_SECONDS` / `REMINDER_SCAN_MINUTES` | no       | Defaults 10 s and 15 min                                                                                                                                            |
| `APP_RELEASE`                                 | no       | The release name or git SHA, shown to Owner/Admin in Settings → System status                                                                                       |

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

## Known gaps before real client data

- **No real email provider (O9).** Invitation links are shown on screen to copy.
- **No antivirus engine for uploads (R25).**
- **Legal and privacy review** of `docs/18_PRIVACY_RETENTION.md` before real client data (SEC-23).
- **RPO/RTO** and the backup schedule are the owner's decision.
- **`prisma migrate` warns about OpenSSL** in the slim image. Migrations still apply.
