import { type Request, type Response, Router } from 'express';
import {
  notificationListQuerySchema,
  notificationPreferencesSchema,
  notificationReadAllSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  getJobSummary,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  retryJob,
  savePreferences,
  unreadCount,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/notifications…`, `/notification-preferences`, `/jobs…`. */
export function notificationsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const own = requirePermission('notifications.read');
  const jobs = requirePermission('jobs.manage');
  const ok = (req: Request, res: Response, data: unknown) => {
    res.json({ data, meta: { requestId: req.requestId } });
  };

  router.get(
    '/notifications',
    own,
    wrap(async (req, res) => {
      const q = parseOrThrow(notificationListQuerySchema, req.query);
      ok(req, res, await listNotifications(db, req.auth!.user, q));
    }),
  );

  router.get(
    '/notifications/unread-count',
    own,
    wrap(async (req, res) => ok(req, res, { count: await unreadCount(db, req.auth!.user) })),
  );

  router.post(
    '/notifications/read-all',
    own,
    wrap(async (req, res) => {
      const { upTo } = parseOrThrow(notificationReadAllSchema, req.body);
      ok(req, res, await markAllRead(db, req.auth!.user, upTo));
    }),
  );

  router.patch(
    '/notifications/:id/read',
    own,
    wrap(async (req, res) =>
      ok(req, res, await markRead(db, req.auth!.user, String(req.params.id))),
    ),
  );

  router.get(
    '/notification-preferences',
    own,
    wrap(async (req, res) => ok(req, res, await getPreferences(db, req.auth!.user))),
  );

  router.put(
    '/notification-preferences',
    own,
    wrap(async (req, res) => {
      const input = parseOrThrow(notificationPreferencesSchema, req.body);
      ok(req, res, await savePreferences(db, req.auth!.user, input, req.requestId));
    }),
  );

  router.get(
    '/jobs',
    jobs,
    wrap(async (req, res) => ok(req, res, await getJobSummary(db, req.auth!.user))),
  );

  router.post(
    '/jobs/:id/retry',
    jobs,
    wrap(async (req, res) =>
      ok(req, res, await retryJob(db, req.auth!.user, String(req.params.id), req.requestId)),
    ),
  );

  return router;
}
