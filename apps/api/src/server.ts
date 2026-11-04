import { createApp } from './app.js';
import { loadEnv, mfaRequiredRoles } from './config/env.js';
import { createDb, dbOptionsFromEnv } from './db/client.js';
import { ClamdScanner } from './lib/clamav.js';
import { createMailer } from './lib/mailer.js';
import { DemoRefused, checkDemoTarget } from './demo/guard.js';
import { resetDemo } from './demo/reset.js';
import { deriveMfaKey } from './lib/totp.js';
import { startWorker } from './jobs/worker.js';
import { createLogger } from './middleware/logger.js';
import { LocalEncryptedStorage } from './modules/files/storage.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL, dbOptionsFromEnv(env));

const mailer = createMailer(env, logger);

const storage = new LocalEncryptedStorage(
  env.FILE_STORAGE_DIR,
  Buffer.from(env.FILE_ENCRYPTION_KEY, 'hex'),
);

try {
  storage.checkWritable();
} catch (err) {
  logger.fatal(
    { dir: env.FILE_STORAGE_DIR, err: err instanceof Error ? err.message : String(err) },
    'File storage folder is not writable; check the disk mount and its owner',
  );
  process.exit(1);
}

const publicUrl = (env.APP_PUBLIC_URL ?? env.APP_ORIGINS[0]!).replace(/\/+$/, '');

const scanner = env.CLAMAV_HOST ? new ClamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : undefined;
if (!scanner)
  logger.warn('No antivirus scanner configured (CLAMAV_HOST): uploads get built-in checks only');

// Public demo (ADR-071): a fresh, fictional workspace every time the process starts. On a free
// host the disk is wiped on each restart, so the seeded files are rebuilt with the data. Every
// demo:reset safety check applies; a refusal stops the process before anything is deleted.
if (env.DEMO_RESET_ON_BOOT) {
  try {
    const target = await checkDemoTarget(db, {
      demoMode: env.DEMO_MODE,
      confirm: env.DEMO_RESET_ON_BOOT,
    });
    const started = Date.now();
    const result = await resetDemo({
      db,
      storage,
      csrfSecret: env.CSRF_SECRET,
      files: { maxBytes: env.FILE_MAX_BYTES, projectQuotaBytes: env.FILE_PROJECT_QUOTA_BYTES },
    });
    // Counts only: the generated passwords are never logged (visitors use "Explore as …").
    logger.info(
      {
        database: target.database,
        accounts: result.credentials.length,
        removedFiles: result.removedFiles,
        ms: Date.now() - started,
      },
      'Demo workspace rebuilt on start',
    );
  } catch (err) {
    logger.fatal(
      { err: err instanceof DemoRefused ? err.message : err },
      'Demo reset on start failed; not starting',
    );
    await db.$disconnect();
    process.exit(1);
  }
}

const app = createApp({
  db,
  logger,
  mailer,
  storage,
  ...(scanner ? { scanner } : {}),
  sharedRateLimits: true,
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
    publicUrl,
    ...(env.WEB_DIST_DIR ? { webDistDir: env.WEB_DIST_DIR } : {}),
    files: { maxBytes: env.FILE_MAX_BYTES, projectQuotaBytes: env.FILE_PROJECT_QUOTA_BYTES },
    mfa: {
      key: deriveMfaKey(Buffer.from(env.FILE_ENCRYPTION_KEY, 'hex')),
      requiredRoles: mfaRequiredRoles(env),
    },
    ...(env.DEMO_MODE ? { demo: { writesPerWindow: env.DEMO_WRITE_LIMIT_PER_IP } } : {}),
  },
});

// Emails and reminders (ADR-058). Safe with several processes: claims use SKIP LOCKED.
const worker = env.JOBS_ENABLED
  ? startWorker(
      { db, mailer, logger, publicUrl },
      { pollMs: env.JOBS_POLL_SECONDS * 1000, scanMs: env.REMINDER_SCAN_MINUTES * 60_000 },
    )
  : null;

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
    await worker?.stop();
    await db.$disconnect();
    process.exit(0);
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// A bug that escapes every handler is logged as one structured line, never silently lost. An
// uncaught exception leaves the process in an unknown state, so it exits and the supervisor
// (Docker restart policy) starts a fresh one (ADR-064).
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason : String(reason) }, 'Unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception; exiting');
  setTimeout(() => process.exit(1), 100).unref();
});
