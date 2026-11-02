import { type Request, type Response, Router } from 'express';
import {
  changeCreateSchema,
  changeDecisionSchema,
  changeVersionActionSchema,
  clientDecisionSchema,
  commentCreateSchema,
  commentThreadQuerySchema,
  commentUpdateSchema,
  deliverableDecisionSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  decideOnProposal,
  getPortalPdf,
  getPortalProposal,
  listPortalProposals,
} from './service.js';
import { sendPdf } from '../proposals/routes.js';
import { createDownloadLink } from '../files/service.js';
import {
  createPortalChange,
  decideOnChange,
  getPortalChange,
  listPortalChanges,
} from '../changes/service.js';
import {
  portalAddComment,
  portalCommentHistory,
  portalDeleteComment,
  portalListComments,
  portalUpdateComment,
} from '../comments/service.js';
import {
  decideOnDeliverable,
  getPortalDeliverable,
  getPortalProject,
  listPortalProjects,
} from './projects.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Client portal API. Only CLIENT sessions pass, and every query is pinned to their organization. */
export function portalRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  router.use(requirePermission('portal.access'));
  const ok = (req: Request, res: Response, data: unknown) => {
    res.json({ data, meta: { requestId: req.requestId } });
  };

  router.get(
    '/proposals',
    wrap(async (req, res) => ok(req, res, await listPortalProposals(db, req.auth!.user))),
  );

  router.get(
    '/proposals/:id',
    wrap(async (req, res) =>
      ok(req, res, await getPortalProposal(db, req.auth!.user, String(req.params.id))),
    ),
  );

  router.get(
    '/proposals/:id/pdf',
    wrap(async (req, res) =>
      sendPdf(res, await getPortalPdf(db, req.auth!.user, String(req.params.id))),
    ),
  );

  router.post(
    '/proposals/:id/decision',
    wrap(async (req, res) => {
      const input = parseOrThrow(clientDecisionSchema, req.body);
      ok(
        req,
        res,
        await decideOnProposal(deps, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  // Projects shared with this client (M7).
  router.get(
    '/projects',
    wrap(async (req, res) => ok(req, res, await listPortalProjects(db, req.auth!.user))),
  );

  router.get(
    '/projects/:id',
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await getPortalProject(db, req.auth!.user, String(req.params.id), req.requestId),
      ),
    ),
  );

  router.get(
    '/deliverables/:id',
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await getPortalDeliverable(db, req.auth!.user, String(req.params.id), req.requestId),
      ),
    ),
  );

  router.post(
    '/deliverables/:id/decision',
    wrap(async (req, res) => {
      const input = parseOrThrow(deliverableDecisionSchema, req.body);
      ok(
        req,
        res,
        await decideOnDeliverable(
          deps,
          req.auth!.user,
          String(req.params.id),
          input,
          req.requestId,
        ),
      );
    }),
  );

  router.post(
    '/files/:fileId/download-url',
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await createDownloadLink(deps, req.auth!.user, String(req.params.fileId), req.requestId),
      ),
    ),
  );

  // Change requests on shared projects (M8).
  router.get(
    '/projects/:id/changes',
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await listPortalChanges(db, req.auth!.user, String(req.params.id), req.requestId),
      ),
    ),
  );

  router.post(
    '/projects/:id/changes',
    wrap(async (req, res) => {
      const input = parseOrThrow(changeCreateSchema, req.body);
      res.status(201);
      ok(
        req,
        res,
        await createPortalChange(deps, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  router.get(
    '/changes/:id',
    wrap(async (req, res) =>
      ok(req, res, await getPortalChange(db, req.auth!.user, String(req.params.id), req.requestId)),
    ),
  );

  router.post(
    '/changes/:id/decision',
    wrap(async (req, res) => {
      const input = parseOrThrow(changeDecisionSchema, req.body);
      ok(
        req,
        res,
        await decideOnChange(deps, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  // Comments on deliverables and changes the client can see (M8, FR-X08).
  router.get(
    '/comments',
    wrap(async (req, res) => {
      const q = parseOrThrow(commentThreadQuerySchema, req.query);
      ok(req, res, await portalListComments(db, req.auth!.user, q, req.requestId));
    }),
  );

  router.post(
    '/comments',
    wrap(async (req, res) => {
      const input = parseOrThrow(commentCreateSchema, req.body);
      res.status(201);
      ok(req, res, await portalAddComment(deps, req.auth!.user, input, req.requestId));
    }),
  );

  router.patch(
    '/comments/:id',
    wrap(async (req, res) => {
      const input = parseOrThrow(commentUpdateSchema, req.body);
      ok(
        req,
        res,
        await portalUpdateComment(db, req.auth!.user, String(req.params.id), input, req.requestId),
      );
    }),
  );

  router.post(
    '/comments/:id/delete',
    wrap(async (req, res) => {
      const { version } = parseOrThrow(changeVersionActionSchema, req.body);
      ok(
        req,
        res,
        await portalDeleteComment(
          db,
          req.auth!.user,
          String(req.params.id),
          version,
          req.requestId,
        ),
      );
    }),
  );

  router.get(
    '/comments/:id/history',
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await portalCommentHistory(db, req.auth!.user, String(req.params.id), req.requestId),
      ),
    ),
  );

  return router;
}
