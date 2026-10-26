import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { DevSinkMailer, DisabledMailer } from './lib/mailer.js';
import { createLogger } from './middleware/logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);

const mailer =
  env.MAIL_TRANSPORT === 'dev-sink'
    ? new DevSinkMailer(env.MAIL_SINK_DIR, logger)
    : new DisabledMailer(logger);

const app = createApp({
  db,
  logger,
  mailer,
  config: {
    isProduction: env.NODE_ENV === 'production',
    appOrigins: env.APP_ORIGINS,
    csrfSecret: env.CSRF_SECRET,
    trustProxy: env.TRUST_PROXY,
    rateLimits: {
      ...(env.LOGIN_RATE_LIMIT_PER_IP ? { loginPerIp: env.LOGIN_RATE_LIMIT_PER_IP } : {}),
      ...(env.TOKEN_RATE_LIMIT_PER_IP ? { tokenPerIp: env.TOKEN_RATE_LIMIT_PER_IP } : {}),
      ...(env.API_RATE_LIMIT_PER_IP ? { apiPerIp: env.API_RATE_LIMIT_PER_IP } : {}),
    },
    publicUrl: (env.APP_PUBLIC_URL ?? env.APP_ORIGINS[0]!).replace(/\/+$/, ''),
    ...(env.WEB_DIST_DIR ? { webDistDir: env.WEB_DIST_DIR } : {}),
  },
});

const server = app.listen(env.API_PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.API_PORT, web: Boolean(env.WEB_DIST_DIR) },
    'ClientFlow API listening',
  );
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
