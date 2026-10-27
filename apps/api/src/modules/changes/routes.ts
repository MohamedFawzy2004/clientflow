import { type Request, type Response, Router } from 'express';
import {
  changeCreateSchema,
  changeDraftSchema,
  changeReviewSchema,
  changeVersionActionSchema,
  changeWithdrawSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  createChange,
  getChange,
  listChanges,
  reviewChange,
  saveDraft,
  sendChange,
  submitChange,
  withdrawChange,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/projects/:id/changes`, `/changes/...`. */
export function changesRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  // Anyone who reads the project reads its changes (sales: read linked).
  const read = requirePermission(
    'projects.read.all',
    'projects.read.member',
    'projects.read.linked',
  );
  const manage = requirePermission('projects.manage');
  const approve = requirePermission('changes.approve');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.get(
    '/projects/:id/changes',
    read,
    wrap(async (req, res) => ok(req, res, await listChanges(db, req.auth!.user, p(req, 'id')))),
  );

  router.post(
    '/projects/:id/changes',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(changeCreateSchema, req.body);
      ok(req, res, await createChange(db, req.auth!.user, p(req, 'id'), input, req.requestId), 201);
    }),
  );

  router.get(
    '/changes/:changeId',
    read,
    wrap(async (req, res) => ok(req, res, await getChange(db, req.auth!.user, p(req, 'changeId')))),
  );

  router.put(
    '/changes/:changeId/draft',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(changeDraftSchema, req.body);
      ok(req, res, await saveDraft(db, req.auth!.user, p(req, 'changeId'), input));
    }),
  );

  router.post(
    '/changes/:changeId/submit',
    manage,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(changeVersionActionSchema, req.body);
      ok(
        req,
        res,
        await submitChange(db, req.auth!.user, p(req, 'changeId'), version, req.requestId),
      );
    }),
  );

  router.post(
    '/changes/:changeId/review',
    approve,
    wrap(async (req, res) => {
      const input = parseOrThrow(changeReviewSchema, req.body);
      ok(
        req,
        res,
        await reviewChange(db, req.auth!.user, p(req, 'changeId'), input, req.requestId),
      );
    }),
  );

  router.post(
    '/changes/:changeId/send',
    manage,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(changeVersionActionSchema, req.body);
      ok(
        req,
        res,
        await sendChange(deps, req.auth!.user, p(req, 'changeId'), version, req.requestId),
      );
    }),
  );

  router.post(
    '/changes/:changeId/withdraw',
    manage,
    wrap(async (req, res) => {
      const { version, reason } = parseOrThrow(changeWithdrawSchema, req.body);
      ok(
        req,
        res,
        await withdrawChange(
          db,
          req.auth!.user,
          p(req, 'changeId'),
          version,
          reason,
          req.requestId,
        ),
      );
    }),
  );

  return router;
}
