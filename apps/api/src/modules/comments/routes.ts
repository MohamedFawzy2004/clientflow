import { type Request, type Response, Router } from 'express';
import {
  changeVersionActionSchema,
  commentCreateSchema,
  commentThreadQuerySchema,
  commentUpdateSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  staffAddComment,
  staffCommentHistory,
  staffDeleteComment,
  staffListComments,
  staffUpdateComment,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Staff comment routes, mounted at the API root. The portal ones live in the portal router. */
export function commentsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const work = requirePermission('delivery.work');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.get(
    '/projects/:id/comments',
    work,
    wrap(async (req, res) => {
      const q = parseOrThrow(commentThreadQuerySchema, req.query);
      ok(req, res, await staffListComments(db, req.auth!.user, p(req, 'id'), q));
    }),
  );

  router.post(
    '/projects/:id/comments',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(commentCreateSchema, req.body);
      ok(
        req,
        res,
        await staffAddComment(deps, req.auth!.user, p(req, 'id'), input, req.requestId),
        201,
      );
    }),
  );

  router.patch(
    '/comments/:commentId',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(commentUpdateSchema, req.body);
      ok(
        req,
        res,
        await staffUpdateComment(db, req.auth!.user, p(req, 'commentId'), input, req.requestId),
      );
    }),
  );

  router.post(
    '/comments/:commentId/delete',
    work,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(changeVersionActionSchema, req.body);
      ok(
        req,
        res,
        await staffDeleteComment(db, req.auth!.user, p(req, 'commentId'), version, req.requestId),
      );
    }),
  );

  router.get(
    '/comments/:commentId/history',
    work,
    wrap(async (req, res) =>
      ok(req, res, await staffCommentHistory(db, req.auth!.user, p(req, 'commentId'))),
    ),
  );

  return router;
}
