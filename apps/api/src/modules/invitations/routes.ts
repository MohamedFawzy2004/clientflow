import { type RequestHandler, Router } from 'express';
import {
  invitationAcceptSchema,
  invitationCreateSchema,
  invitationTokenSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireFormCsrf, requirePermission } from '../../middleware/auth.js';
import { cookieSettings } from '../auth/session.js';
import { signIn } from '../auth/sign-in.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
} from './service.js';

export function invitationsRouter(deps: AppDeps, limiters: { tokenPerIp: RequestHandler }) {
  const formCsrf = requireFormCsrf(
    deps.config.csrfSecret,
    cookieSettings(deps.config.isProduction),
  );
  const router = Router();

  // Public (signed-out) endpoints. The token travels in the body, never in the URL.
  router.post('/preview', limiters.tokenPerIp, formCsrf, async (req, res, next) => {
    try {
      const { token } = parseOrThrow(invitationTokenSchema, req.body);
      res.json({ data: await previewInvitation(deps, token), meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/accept', limiters.tokenPerIp, formCsrf, async (req, res, next) => {
    try {
      const input = parseOrThrow(invitationAcceptSchema, req.body);
      const user = await acceptInvitation(deps, input, req.requestId);
      const body = await signIn(deps, req, res, user, 'invitation.accept');
      res.status(201).json({ data: body, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  // Team admin endpoints.
  router.get('/', requirePermission('team.read'), async (req, res, next) => {
    try {
      const data = await listInvitations(deps, req.auth!.user);
      res.json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('team.invite'), async (req, res, next) => {
    try {
      const input = parseOrThrow(invitationCreateSchema, req.body);
      const data = await createInvitation(deps, req.auth!.user, input, req.requestId);
      res.status(201).json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/revoke', requirePermission('team.invite'), async (req, res, next) => {
    try {
      const data = await revokeInvitation(
        deps,
        req.auth!.user,
        String(req.params.id),
        req.requestId,
      );
      res.json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/resend', requirePermission('team.invite'), async (req, res, next) => {
    try {
      const data = await resendInvitation(
        deps,
        req.auth!.user,
        String(req.params.id),
        req.requestId,
      );
      res.status(201).json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
