# Windows setup (PowerShell)

Verified on Windows 11 with Node 24.19.0, npm 11.17.0, Docker Desktop 29.9.2, Microsoft Edge (for E2E). Commands run from the repository root.

## 1. Prerequisites

- **Node.js 24 LTS** (`node --version` → `v24.x`). The repo pins it in `.nvmrc` and `engines`.
- **Docker Desktop**, started and showing "Engine running". Check with `docker info`.
- **Git**.
- **Microsoft Edge** (preinstalled on Windows) for the end-to-end tests. No Playwright browser download is needed.

## 2. Install

```powershell
npm ci
```

npm 11 blocks dependency install scripts unless they are approved. The three approved ones (Prisma engines, Prisma CLI, esbuild) are listed in `package.json` → `allowScripts`. If npm prints `allow-scripts` warnings for anything else, review it before approving.

## 3. Configure secrets (local only)

```powershell
Copy-Item .env.example .env
# Generate two random values and paste them into .env:
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # POSTGRES_PASSWORD (use it in all three *_DATABASE_URL lines too)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # CSRF_SECRET
```

The API refuses to start while `.env` still contains the `change-me` or `replace-with` placeholders. Never commit `.env`.

## 4. Database

```powershell
npm run db:up        # Postgres 17 on 127.0.0.1:5433 (dev, test and e2e databases)
npm run db:migrate   # apply migrations to the dev database + generate the Prisma client
```

If you change the Postgres password after the first `db:up`, the existing Docker volume keeps the old one. Remove it with `docker compose down -v` (this deletes local dev data).

## 5. First owner (once per installation)

```powershell
npm run bootstrap:owner -- --agency "Your Agency" --name "Your Name" --email you@youragency.com
```

You are prompted for a password (minimum 12 characters, hidden input). Running it a second time is refused, and nothing changes.

**Optional fictional demo data (development only):**

```powershell
npm run seed:dev
```

This creates the owner (if the database is empty), six staff users and twelve fictional leads. Generated passwords are written to `apps/api/.dev-credentials.local.json` (gitignored). The seed refuses to run when `NODE_ENV=production`.

## 6. Invite your team (M2)

Sign in as the owner, open **Team**, then choose **Invite member**. In development, emails are not sent: they are written as JSON files to `apps/api/.mail-sink/`, and the dialog shows the one-time link so you can open it in another browser. Forgot-password links also land in that folder.

## 7. Run

```powershell
npm run dev
```

Open <http://localhost:5173>. The web app proxies `/api` to the API on port 4000.

## 8. Checks

```powershell
npm run lint
npm run typecheck
npm test            # API unit + integration tests on the real clientflow_test database
npm run test:web    # React component tests
npm run e2e         # Playwright + axe on clientflow_e2e (starts its own servers on 4100/5174)
npm run build
```

`npm run e2e` writes screenshots to `docs/milestones/m1-screenshots/` and an HTML report to `playwright-report/`.

## Troubleshooting

| Symptom                                                            | Fix                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Start Docker Desktop and wait for "Engine running".                                                                                        |
| `Invalid environment configuration`                                | A value in `.env` is missing or still a placeholder.                                                                                       |
| Web shows "We could not load your workspace"                       | The API is not running or not ready yet. Start it, then click **Try again**.                                                               |
| Port 5433/4000/5173 in use                                         | Stop the other process, or change `POSTGRES_PORT` / `API_PORT` in `.env` (then update the Vite proxy target with `VITE_API_PROXY_TARGET`). |
| Invitation or reset email "never arrives" in development           | Development never sends email. Open the newest file in `apps/api/.mail-sink/`.                                                             |
| `npm run e2e` times out starting servers                           | Make sure nothing else is using ports 4100/5174, and that Docker is running.                                                               |
