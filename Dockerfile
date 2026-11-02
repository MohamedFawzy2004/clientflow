# ClientFlow production image (ADR-034): one process serves the API and the built web app on the
# same origin, so session cookies stay first-party and CORS stays closed.
#
#   docker build -t clientflow .                           # runtime image (last stage)
#   docker build -t clientflow-migrate --target migrate .  # one-off: prisma migrate deploy
#
# Configuration comes only from environment variables at run time (see docs/17_DEPLOYMENT.md).
# Nothing secret is baked into the image.

ARG NODE_IMAGE=node:24.19.0-bookworm-slim

# 1. All dependencies, for building.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --no-audit --no-fund

# 2. Build contracts, API (with the generated Prisma client) and web.
FROM deps AS build
COPY . .
# prisma.config.ts requires DATABASE_URL to be set; generate never connects, so a dummy is enough
# for this step only (it is not part of any image layer's environment).
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

# 3. Production dependencies of the API and contracts only.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace @clientflow/api --workspace @clientflow/contracts \
  && npm cache clean --force

# Release step: applies pending migrations, then exits. Run before starting a new runtime version.
# Prisma warns that it cannot detect OpenSSL in the slim image; migrations still apply (verified
# locally, M5 report). Installing openssl here is listed as a follow-up.
FROM build AS migrate
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# 4. Runtime (the default, last stage): no compilers, no dev tools, no source, unprivileged user.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=4000 \
    WEB_DIST_DIR=/app/apps/web/dist \
    MAIL_TRANSPORT=disabled
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 4000) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/server.js"]
