import { type Request, type Response, Router } from 'express';
import { clientDecisionSchema } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { decideOnProposal, getPortalProposal, listPortalProposals } from './service.js';

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

  return router;
}
