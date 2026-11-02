import { type Request, type Response, Router } from 'express';
import { clientDecisionSchema, deliverableDecisionSchema } from '@clientflow/contracts';
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

  return router;
}
