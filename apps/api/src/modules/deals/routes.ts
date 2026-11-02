import { type Request, type Response, Router } from 'express';
import {
  dealCloseSchema,
  dealCreateSchema,
  dealListQuerySchema,
  dealMoveSchema,
  dealReopenSchema,
  dealUpdateSchema,
  reassignSchema,
  type PageMeta,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  closeDeal,
  createDeal,
  getBoard,
  getDeal,
  listDeals,
  moveDeal,
  reassignDeal,
  reopenDeal,
  updateDeal,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

export function dealsRouter({ db }: AppDeps) {
  const router = Router();
  router.use(requireAuth);
  const ok = (req: Request, res: Response, data: unknown, status = 200) =>
    res.status(status).json({ data, meta: { requestId: req.requestId } });

  router.get(
    '/',
    wrap(async (req, res) => {
      const query = parseOrThrow(dealListQuerySchema, req.query);
      const { total, rows } = await listDeals(db, req.auth!.user, query);
      const meta: PageMeta & { requestId: string } = {
        page: query.page,
        limit: query.limit,
        total,
        requestId: req.requestId,
      };
      res.json({ data: rows, meta });
    }),
  );

  router.get(
    '/board',
    wrap(async (req, res) => void ok(req, res, await getBoard(db, req.auth!.user))),
  );

  router.post(
    '/',
    wrap(async (req, res) => {
      const input = parseOrThrow(dealCreateSchema, req.body);
      ok(req, res, await createDeal(db, req.auth!.user, input, req.requestId), 201);
    }),
  );

  router.get(
    '/:id',
    wrap(
      async (req, res) =>
        void ok(req, res, await getDeal(db, req.auth!.user, String(req.params.id))),
    ),
  );

  // Strict schema: owner, stage, status and pipeline cannot be changed through PATCH (T-ACL-03).
  router.patch(
    '/:id',
    wrap(async (req, res) => {
      const input = parseOrThrow(dealUpdateSchema, req.body);
      ok(
        req,
        res,
        await updateDeal(db, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  router.post(
    '/:id/move',
    wrap(async (req, res) => {
      const { stageId, version } = parseOrThrow(dealMoveSchema, req.body);
      ok(
        req,
        res,
        await moveDeal(db, req.auth!.user, String(req.params.id), stageId, version, req.requestId),
      );
    }),
  );

  router.post(
    '/:id/close',
    wrap(async (req, res) => {
      const input = parseOrThrow(dealCloseSchema, req.body);
      ok(
        req,
        res,
        await closeDeal(db, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  router.post(
    '/:id/reopen',
    wrap(async (req, res) => {
      const { version, reason } = parseOrThrow(dealReopenSchema, req.body);
      ok(
        req,
        res,
        await reopenDeal(db, req.auth!.user, String(req.params.id), version, reason, req.requestId),
      );
    }),
  );

  router.post(
    '/:id/reassign',
    wrap(async (req, res) => {
      const { ownerId, version } = parseOrThrow(reassignSchema, req.body);
      ok(
        req,
        res,
        await reassignDeal(
          db,
          req.auth!.user,
          String(req.params.id),
          ownerId,
          version,
          req.requestId,
        ),
      );
    }),
  );

  return router;
}
