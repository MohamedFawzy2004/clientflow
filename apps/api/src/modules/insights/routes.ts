import { type Request, type Response, Router } from 'express';
import { agencySettingsSchema, dashboardQuerySchema } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { getAgencySettings, updateAgencySettings } from '../agency/service.js';
import { exportDealsCsv, getReminders, getSalesDashboard } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: dashboard, reminders, exports and agency settings (M5). */
export function insightsRouter({ db }: AppDeps) {
  const router = Router();
  const ok = (req: Request, res: Response, data: unknown) => {
    res.json({ data, meta: { requestId: req.requestId } });
  };
  const tz = (req: Request) => req.auth!.agency.timezone;

  router.get(
    '/dashboard/sales',
    requirePermission('dashboard.sales'),
    wrap(async (req, res) => {
      const query = parseOrThrow(dashboardQuerySchema, req.query);
      ok(req, res, await getSalesDashboard(db, req.auth!.user, tz(req), query));
    }),
  );

  router.get(
    '/reminders',
    requirePermission('dashboard.sales'),
    wrap(async (req, res) => ok(req, res, await getReminders(db, req.auth!.user, tz(req)))),
  );

  router.get(
    '/exports/deals.csv',
    requirePermission('reports.export'),
    wrap(async (req, res) => {
      const query = parseOrThrow(dashboardQuerySchema, req.query);
      const file = await exportDealsCsv(db, req.auth!.user, tz(req), query, req.requestId);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('X-Export-Rows', String(file.rows));
      res.send(file.body);
    }),
  );

  router.get(
    '/agency',
    requirePermission('agency.manage'),
    wrap(async (req, res) => ok(req, res, await getAgencySettings(db, req.auth!.user))),
  );

  router.patch(
    '/agency',
    requirePermission('agency.manage'),
    wrap(async (req, res) => {
      const input = parseOrThrow(agencySettingsSchema, req.body);
      ok(req, res, await updateAgencySettings(db, req.auth!.user, input, req.requestId));
    }),
  );

  return router;
}
