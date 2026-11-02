import { type Request, type Response, Router } from 'express';
import type { OpsStatus } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { requirePermission } from '../../middleware/auth.js';
import { JOB_LAG_LIMIT_SECONDS, jobLagSeconds } from '../health/routes.js';

const startedAt = Date.now();

/**
 * System status for Owner/Admin (ADR-064): is the database quick, is the worker keeping up, where
 * are limits counted. Job counts are for this agency; lag is for the whole queue.
 */
export function opsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  router.get(
    '/ops/status',
    requirePermission('jobs.manage'),
    (req: Request, res: Response, next: (err?: unknown) => void) => {
      void (async () => {
        const t0 = performance.now();
        await db.$queryRaw`SELECT 1`;
        const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
        const agencyId = req.auth!.user.agencyId;
        const [pending, dead, lag] = await Promise.all([
          db.outboxJob.count({ where: { agencyId, state: 'PENDING' } }),
          db.outboxJob.count({ where: { agencyId, state: 'DEAD' } }),
          jobLagSeconds(db),
        ]);
        const data: OpsStatus = {
          release: process.env.APP_RELEASE?.slice(0, 64) ?? null,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          database: { latencyMs },
          jobs: { pending, dead, oldestDueSeconds: lag, lagging: lag > JOB_LAG_LIMIT_SECONDS },
          rateLimits: deps.sharedRateLimits ? 'postgres' : 'memory',
          memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        };
        res.json({ data, meta: { requestId: req.requestId } });
      })().catch(next);
    },
  );
  return router;
}
