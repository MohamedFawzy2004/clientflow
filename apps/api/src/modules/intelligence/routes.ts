import { type Request, type Response, Router } from 'express';
import { trendQuerySchema } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  getDeliveryIntelligence,
  getFinanceIntelligence,
  getProjectPlan,
  getRelationshipGraph,
  getSalesIntelligence,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/**
 * Read-only intelligence (ADR-072). Each route has a capability gate here, and each service
 * starts from the existing record scope, so the numbers match what the viewer can open.
 */
export function intelligenceRouter({ db }: AppDeps) {
  const router = Router();
  const ok = (req: Request, res: Response, data: unknown) => {
    res.json({ data, meta: { requestId: req.requestId } });
  };
  const tz = (req: Request) => req.auth!.agency.timezone;

  router.get(
    '/contacts/:id/graph',
    requirePermission('contacts.read.all', 'contacts.read.own'),
    wrap(async (req, res) =>
      ok(req, res, await getRelationshipGraph(db, req.auth!.user, String(req.params.id))),
    ),
  );

  router.get(
    '/insights/sales',
    requirePermission('dashboard.sales'),
    wrap(async (req, res) => {
      const query = parseOrThrow(trendQuerySchema, req.query);
      ok(req, res, await getSalesIntelligence(db, req.auth!.user, tz(req), query));
    }),
  );

  router.get(
    '/insights/finance',
    requirePermission('invoices.read.all', 'invoices.read.project'),
    wrap(async (req, res) => {
      const query = parseOrThrow(trendQuerySchema, req.query);
      ok(req, res, await getFinanceIntelligence(db, req.auth!.user, tz(req), query));
    }),
  );

  router.get(
    '/insights/delivery',
    requirePermission('delivery.work'),
    wrap(async (req, res) =>
      ok(req, res, await getDeliveryIntelligence(db, req.auth!.user, tz(req))),
    ),
  );

  router.get(
    '/projects/:id/plan',
    requirePermission('delivery.work'),
    wrap(async (req, res) =>
      ok(req, res, await getProjectPlan(db, req.auth!.user, String(req.params.id))),
    ),
  );

  return router;
}
