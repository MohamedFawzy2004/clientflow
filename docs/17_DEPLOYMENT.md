# Deploying ClientFlow (staging / demo)

> **Status (M5):** the production image is built and was smoke-tested locally against PostgreSQL (see `docs/milestones/M5_REPORT.md`). **Nothing has been deployed.** A hosting provider and an email provider still have to be chosen by the project owner.

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

| Variable            | Required | Example / rule                                                                                                  |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | set      | `production` (already set in the image)                                                                         |
| `DATABASE_URL`      | yes      | `postgresql://clientflow_app:…@db-host:5432/clientflow?sslmode=require`                                         |
| `APP_ORIGINS`       | yes      | `https://crm.youragency.com` (exact origin, https only, comma-separated if several)                             |
| `APP_PUBLIC_URL`    | no       | Base URL for emailed links; defaults to the first origin                                                        |
| `CSRF_SECRET`       | yes      | 32+ random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`    |
| `TRUST_PROXY`       | yes      | Number of proxies in front (usually `1`), so rate limits see the real client IP                                 |
| `HOST` / `API_PORT` | set      | `0.0.0.0` / `4000` (already set in the image)                                                                   |
| `WEB_DIST_DIR`      | set      | `/app/apps/web/dist` (already set in the image)                                                                 |
| `MAIL_TRANSPORT`    | set      | `disabled` (already set). There is no real provider yet: invitation links are shown on screen to copy (risk O9) |
| `LOG_LEVEL`         | no       | `info`                                                                                                          |

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
2. Run `clientflow-migrate` against the database. Migrations are additive in M1–M5.
3. Replace the running `clientflow` container. Wait for `/health/ready` to report `{"status":"ok"}`.

## Health checks

- `GET /health/live`: the process is up (also used by the image's `HEALTHCHECK`).
- `GET /health/ready`: the database answers. Use this one for the platform's readiness probe.

## Known gaps before real client data (M11)

- **Rate limits are in memory:** run **one** instance until a shared store exists (O1).
- **No real email provider (O9).**
- **Backups and restore are not set up:** the platform's managed PostgreSQL backups must be turned on and a restore tested.
- **No monitoring or alerting.**
- **The image is 831 MB:** pruning dependencies is planned (M5 report).
- **`prisma migrate` warns about OpenSSL** in the slim image. Migrations still apply.
