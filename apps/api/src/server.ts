import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { createLogger } from './middleware/logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);

const app = createApp({
  db,
  logger,
  config: {
    isProduction: env.NODE_ENV === 'production',
    appOrigins: env.APP_ORIGINS,
    csrfSecret: env.CSRF_SECRET,
    trustProxy: env.TRUST_PROXY,
  },
});

const server = app.listen(env.API_PORT, '127.0.0.1', () => {
  logger.info({ port: env.API_PORT }, 'ClientFlow API listening');
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
