import { type Request, type Response, Router } from 'express';
import {
  clientOrgCreateSchema,
  memberActionSchema,
  portalInviteSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  createOrgForContact,
  getClientOrg,
  invitePortalUser,
  revokePortalInvitation,
  setPortalUserActive,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/contacts/:id/client-org` and `/client-orgs/...`. */
export function clientOrgsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const manage = requirePermission('portal.manage');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.post(
    '/contacts/:id/client-org',
    manage,
    wrap(async (req, res) => {
      const { name } = parseOrThrow(clientOrgCreateSchema, req.body);
      const org = await createOrgForContact(db, req.auth!.user, p(req, 'id'), name, req.requestId);
      ok(req, res, org, 201);
    }),
  );

  router.get(
    '/client-orgs/:id',
    manage,
    wrap(async (req, res) => ok(req, res, await getClientOrg(db, req.auth!.user, p(req, 'id')))),
  );

  router.post(
    '/client-orgs/:id/invitations',
    manage,
    wrap(async (req, res) => {
      const { email } = parseOrThrow(portalInviteSchema, req.body);
      const created = await invitePortalUser(
        deps,
        req.auth!.user,
        p(req, 'id'),
        email,
        req.requestId,
      );
      ok(req, res, created, 201);
    }),
  );

  router.post(
    '/client-orgs/:id/invitations/:invitationId/revoke',
    manage,
    wrap(async (req, res) => {
      const org = await revokePortalInvitation(
        db,
        req.auth!.user,
        p(req, 'id'),
        p(req, 'invitationId'),
        req.requestId,
      );
      ok(req, res, org);
    }),
  );

  for (const [action, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    router.post(
      `/client-orgs/:id/users/:userId/${action}`,
      manage,
      wrap(async (req, res) => {
        const { version } = parseOrThrow(memberActionSchema, req.body);
        const org = await setPortalUserActive(
          db,
          req.auth!.user,
          p(req, 'id'),
          p(req, 'userId'),
          active,
          version,
          req.requestId,
        );
        ok(req, res, org);
      }),
    );
  }

  return router;
}
