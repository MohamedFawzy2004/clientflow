// Background jobs from the command line (ADR-058).
//   npm run jobs:once    scan reminders now and run every due job, then exit
//   npm run jobs:worker  run the worker as its own process (with JOBS_ENABLED=false on the API)
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { runReminderScan } from '../jobs/reminders.js';
import { runDueJobs, startWorker } from '../jobs/worker.js';
import { DevSinkMailer, DisabledMailer } from '../lib/mailer.js';
import { createLogger } from '../middleware/logger.js';

const mode = process.argv[2];
if (mode !== 'once' && mode !== 'worker') {
  console.error('Usage: jobs.ts once | worker');
  process.exit(2);
}

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const mailer =
  env.MAIL_TRANSPORT === 'dev-sink'
    ? new DevSinkMailer(env.MAIL_SINK_DIR, logger)
    : new DisabledMailer(logger);
const deps = {
  db,
  mailer,
  logger,
  publicUrl: (env.APP_PUBLIC_URL ?? env.APP_ORIGINS[0]!).replace(/\/+$/, ''),
};

if (mode === 'once') {
  const agencies = await db.agency.findMany({ select: { id: true } });
  let reminders = 0;
  for (const a of agencies) reminders += (await runReminderScan(db, a.id, new Date())).created;
  const jobs = await runDueJobs(deps, 1000);
  // Counts only: no names, addresses or links.
  console.log(JSON.stringify({ reminders, ...jobs }));
  await db.$disconnect();
} else {
  const worker = startWorker(deps, {
    pollMs: env.JOBS_POLL_SECONDS * 1000,
    scanMs: env.REMINDER_SCAN_MINUTES * 60_000,
  });
  const stop = async () => {
    await worker.stop();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
