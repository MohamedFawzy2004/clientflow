import { Router } from 'express';
import { memberActionSchema, memberUpdateSchema } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  changeRole,
  deactivateMember,
  listMembers,
  reactivateMember,
  revokeMemberSessions,
} from './service.js';

export function teamRouter(deps: AppDeps) {
  const router = Router();

  router.get('/', requirePermission('team.read'), async (req, res, next) => {
    try {
      res.json({
        data: await listMembers(deps, req.auth!.user),
        meta: { requestId: req.requestId },
      });
    } catch (err) {
      next(err);
    }
  });

  // Only `role` and `version` are accepted (strict schema): name, email, agency and active state
  // cannot be mass-assigned through this endpoint (T-ACL-03).
  router.patch('/:id', requirePermission('team.manage'), async (req, res, next) => {
    try {
      const input = parseOrThrow(memberUpdateSchema, req.body);
      const data = await changeRole(
        deps,
        req.auth!.user,
        String(req.params.id),
        input,
        req.requestId,
      );
      res.json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/deactivate', requirePermission('team.manage'), async (req, res, next) => {
    try {
      const { version } = parseOrThrow(memberActionSchema, req.body);
      const data = await deactivateMember(
        deps,
        req.auth!.user,
        String(req.params.id),
        version,
        req.requestId,
      );
      res.json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reactivate', requirePermission('team.manage'), async (req, res, next) => {
    try {
      const { version } = parseOrThrow(memberActionSchema, req.body);
      const data = await reactivateMember(
        deps,
        req.auth!.user,
        String(req.params.id),
        version,
        req.requestId,
      );
      res.json({ data, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/revoke-sessions', requirePermission('team.manage'), async (req, res, next) => {
    try {
      const data = await revokeMemberSessions(
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

  return router;
}
