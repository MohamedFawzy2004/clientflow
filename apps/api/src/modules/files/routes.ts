import { type Request, type Response, Router } from 'express';
import type { AppDeps } from '../../app.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { createDownloadLink, deleteFile, listFiles, serveDownload, uploadFile } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/projects/:id/files`, `/files/...`. */
export function filesRouter(deps: AppDeps) {
  const router = Router();
  const work = requirePermission('delivery.work');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.get(
    '/projects/:id/files',
    work,
    wrap(async (req, res) => ok(req, res, await listFiles(deps, req.auth!.user, p(req, 'id')))),
  );

  router.post(
    '/projects/:id/files',
    work,
    wrap(async (req, res) =>
      ok(req, res, await uploadFile(deps, req.auth!.user, p(req, 'id'), req), 201),
    ),
  );

  router.post(
    '/files/:fileId/download-url',
    work,
    wrap(async (req, res) =>
      ok(req, res, await createDownloadLink(deps, req.auth!.user, p(req, 'fileId'), req.requestId)),
    ),
  );

  router.post(
    '/files/:fileId/delete',
    work,
    wrap(async (req, res) =>
      ok(req, res, await deleteFile(deps, req.auth!.user, p(req, 'fileId'), req.requestId)),
    ),
  );

  // Staff and clients: the link decides which file, the session decides who; both are checked.
  router.get(
    '/files/download/:token',
    requireAuth,
    wrap((req, res) => serveDownload(deps, req.auth!.user, p(req, 'token'), req, res)),
  );

  return router;
}
