import { Router } from 'express';
import type { Db } from '../../db/client.js';

/** A due job waiting longer than this means the worker is down or overloaded (ADR-064). */
export const JOB_LAG_LIMIT_SECONDS = 15 * 60;

/** Seconds the oldest due, unstarted job has waited, or 0 when nothing is waiting. */
export async function jobLagSeconds(db: Db, now = new Date()) {
  const oldest = await db.outboxJob.findFirst({
    where: { state: 'PENDING', availableAt: { lte: now } },
    orderBy: { availableAt: 'asc' },
    select: { availableAt: true },
  });
  return oldest
    ? Math.max(0, Math.round((now.getTime() - oldest.availableAt.getTime()) / 1000))
    : 0;
}

/** Liveness and readiness. Responses never include versions, hosts or credentials. */
export function healthRouter(db: Db) {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Ready = the database answers. A lagging job queue is reported ("degraded") but does not
  // take the instance out of service: requests still work, emails and reminders are late.
  router.get('/ready', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      const lagging = (await jobLagSeconds(db)) > JOB_LAG_LIMIT_SECONDS;
      res.json({
        status: lagging ? 'degraded' : 'ok',
        checks: { database: 'ok', jobs: lagging ? 'lagging' : 'ok' },
      });
    } catch (err) {
      req.log?.error({ err }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable', checks: { database: 'unavailable' } });
    }
  });

  return router;
}
