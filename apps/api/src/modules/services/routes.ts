import { type Request, type Response, Router } from 'express';
import { serviceCreateSchema, serviceUpdateSchema, versionOnlySchema } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { createService, listServices, setServiceArchived, updateService } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

export function servicesRouter({ db }: AppDeps) {
  const router = Router();
  const manage = requirePermission('services.manage');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };

  router.get(
    '/',
    requirePermission('services.read'),
    wrap(async (req, res) => {
      const includeArchived = req.query.archived === 'true';
      ok(req, res, await listServices(db, req.auth!.user, includeArchived));
    }),
  );

  router.post(
    '/',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(serviceCreateSchema, req.body);
      ok(req, res, await createService(db, req.auth!.user, input, req.requestId), 201);
    }),
  );

  router.patch(
    '/:id',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(serviceUpdateSchema, req.body);
      ok(
        req,
        res,
        await updateService(db, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  for (const [action, archived] of [
    ['archive', true],
    ['restore', false],
  ] as const) {
    router.post(
      `/:id/${action}`,
      manage,
      wrap(async (req, res) => {
        const { version } = parseOrThrow(versionOnlySchema, req.body);
        ok(
          req,
          res,
          await setServiceArchived(
            db,
            req.auth!.user,
            String(req.params.id),
            archived,
            version,
            req.requestId,
          ),
        );
      }),
    );
  }

  return router;
}
