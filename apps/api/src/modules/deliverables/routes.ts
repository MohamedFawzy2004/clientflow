import { type Request, type Response, Router } from 'express';
import {
  deliverableCreateSchema,
  deliverableUpdateSchema,
  deliverableVersionSchema,
  versionOnlySchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  addVersion,
  archiveDeliverable,
  createDeliverable,
  getDeliverable,
  listDeliverables,
  publishDeliverable,
  updateDeliverable,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/projects/:id/deliverables`, `/deliverables/...`. */
export function deliverablesRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const work = requirePermission('delivery.work');
  const manage = requirePermission('projects.manage');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);
  const tz = (req: Request) => req.auth!.agency.timezone;

  router.get(
    '/projects/:id/deliverables',
    work,
    wrap(async (req, res) =>
      ok(req, res, await listDeliverables(db, req.auth!.user, p(req, 'id'), tz(req))),
    ),
  );

  router.post(
    '/projects/:id/deliverables',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(deliverableCreateSchema, req.body);
      ok(
        req,
        res,
        await createDeliverable(db, req.auth!.user, p(req, 'id'), input, req.requestId, tz(req)),
        201,
      );
    }),
  );

  router.get(
    '/deliverables/:deliverableId',
    work,
    wrap(async (req, res) =>
      ok(req, res, await getDeliverable(db, req.auth!.user, p(req, 'deliverableId'), tz(req))),
    ),
  );

  router.patch(
    '/deliverables/:deliverableId',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(deliverableUpdateSchema, req.body);
      ok(
        req,
        res,
        await updateDeliverable(db, req.auth!.user, p(req, 'deliverableId'), input, tz(req)),
      );
    }),
  );

  router.post(
    '/deliverables/:deliverableId/versions',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(deliverableVersionSchema, req.body);
      ok(
        req,
        res,
        await addVersion(
          db,
          req.auth!.user,
          p(req, 'deliverableId'),
          input,
          req.requestId,
          tz(req),
        ),
        201,
      );
    }),
  );

  router.post(
    '/deliverables/:deliverableId/publish',
    manage,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(versionOnlySchema, req.body);
      ok(
        req,
        res,
        await publishDeliverable(
          db,
          req.auth!.user,
          p(req, 'deliverableId'),
          version,
          req.requestId,
          tz(req),
        ),
      );
    }),
  );

  router.post(
    '/deliverables/:deliverableId/archive',
    manage,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(versionOnlySchema, req.body);
      ok(
        req,
        res,
        await archiveDeliverable(
          db,
          req.auth!.user,
          p(req, 'deliverableId'),
          version,
          req.requestId,
          tz(req),
        ),
      );
    }),
  );

  return router;
}
