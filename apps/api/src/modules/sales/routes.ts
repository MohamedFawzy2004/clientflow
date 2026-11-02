import { type Request, type Response, Router } from 'express';
import { canAny } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { forbidden } from '../../lib/errors.js';
import { listAssignableUsers } from '../../lib/sales-owner.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { getFollowUps } from '../follow-ups/service.js';
import { getDefaultPipeline, toPipelineSummary } from '../pipelines/service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Small read endpoints that support the sales screens. */
export function salesRouter({ db }: AppDeps) {
  // Mounted at the API root, so auth is per route: a router-wide guard would also answer 401
  // for every unknown path instead of the typed 404.
  const router = Router();

  router.get(
    '/pipelines/default',
    requireAuth,
    wrap(async (req, res) => {
      if (!canAny(req.auth!.user.role, ['deals.read.all', 'deals.read.own'])) throw forbidden();
      const pipeline = await getDefaultPipeline(db, req.auth!.user.agencyId);
      res.json({ data: toPipelineSummary(pipeline), meta: { requestId: req.requestId } });
    }),
  );

  router.get(
    '/follow-ups',
    requireAuth,
    wrap(async (req, res) => {
      const data = await getFollowUps(db, req.auth!.user, req.auth!.agency.timezone);
      res.json({ data, meta: { requestId: req.requestId } });
    }),
  );

  // Owner picker for reassignment: only people who could reassign need the list.
  router.get(
    '/sales/assignable-owners',
    requireAuth,
    requirePermission('sales.reassign'),
    wrap(async (req, res) => {
      const data = await listAssignableUsers(db, req.auth!.user.agencyId);
      res.json({ data, meta: { requestId: req.requestId } });
    }),
  );

  return router;
}
