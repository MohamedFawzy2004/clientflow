import { type Request, type Response, Router } from 'express';
import type { AppDeps } from '../../app.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { createDownloadLink, deleteFile, listFiles, serveDownload, uploadFile } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/**
 * Reads and drops what is left of a refused upload, so the client receives the error instead of
 * a reset connection. Past `cap` bytes it stops and the connection is closed after the answer.
 */
function discardBody(req: Request, res: Response, cap: number): Promise<void> {
  if (req.complete || req.readableEnded || req.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    let seen = 0;
    const finish = () => {
      req.off('data', onData);
      resolve();
    };
    const onData = (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > cap) {
        res.setHeader('Connection', 'close');
        req.pause();
        finish();
      }
    };
    req.on('data', onData);
    req.once('end', finish);
    req.once('error', finish);
    req.once('close', finish);
    req.resume();
  });
}

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
    wrap(async (req, res) => {
      try {
        ok(req, res, await uploadFile(deps, req.auth!.user, p(req, 'id'), req), 201);
      } catch (err) {
        await discardBody(req, res, 2 * (deps.config.files?.maxBytes ?? 0));
        throw err;
      }
    }),
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
