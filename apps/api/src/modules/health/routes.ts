import { Router } from 'express';
import type { Db } from '../../db/client.js';

/** Liveness and readiness. Responses never include versions, hosts or credentials. */
export function healthRouter(db: Db) {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', checks: { database: 'ok' } });
    } catch (err) {
      req.log?.error({ err }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable', checks: { database: 'unavailable' } });
    }
  });

  return router;
}
