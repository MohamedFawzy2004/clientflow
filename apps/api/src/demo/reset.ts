// One demo reset (ADR-066), after checkDemoTarget has accepted the database: wipe, seed through
// an in-process copy of the API on 127.0.0.1 (never the public server), then deliver every
// queued email into memory so the live server never mails the fictional addresses.
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import type { Db } from '../db/client.js';
import { runDueJobs } from '../jobs/worker.js';
import { MemoryMailer } from '../lib/mailer.js';
import { createLogger } from '../middleware/logger.js';
import type { FileStorage } from '../modules/files/storage.js';
import { seedDemo, type DemoCredential } from './seed.js';
import { wipeDemo } from './wipe.js';

const ORIGIN = 'http://demo-seed.invalid';

export interface DemoResetResult {
  removedFiles: number;
  droppedEmails: number;
  credentials: DemoCredential[];
}

export async function resetDemo(deps: {
  db: Db;
  storage: FileStorage;
  csrfSecret: string;
  files: { maxBytes: number; projectQuotaBytes?: number };
  log?: (msg: string) => void;
}): Promise<DemoResetResult> {
  const { db, storage } = deps;
  const wiped = await wipeDemo(db, storage);
  const mailer = new MemoryMailer();
  const logger = createLogger('warn');
  const app = createApp({
    db,
    logger,
    mailer,
    storage,
    config: {
      isProduction: false,
      appOrigins: [ORIGIN],
      csrfSecret: deps.csrfSecret,
      trustProxy: 0,
      publicUrl: ORIGIN,
      // The seeder signs in a dozen people from one address within seconds.
      rateLimits: { loginPerIp: 1000, tokenPerIp: 1000, apiPerIp: 100_000 },
      files: deps.files,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const credentials = await seedDemo(
      db,
      { base: `http://127.0.0.1:${port}`, origin: ORIGIN },
      deps.log,
    );
    const jobs = await runDueJobs({ db, mailer, logger, publicUrl: ORIGIN }, 1000);
    return { removedFiles: wiped.files, droppedEmails: jobs.done, credentials };
  } finally {
    server.close();
  }
}
