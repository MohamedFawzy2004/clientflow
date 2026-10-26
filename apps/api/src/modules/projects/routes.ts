import { type Request, type Response, Router } from 'express';
import {
  checklistToggleSchema,
  convertDealSchema,
  idempotencyKeySchema,
  milestoneCreateSchema,
  milestoneMoveSchema,
  milestoneUpdateSchema,
  projectCreateSchema,
  projectListQuerySchema,
  projectMemberSchema,
  projectShareSchema,
  projectStateSchema,
  projectUpdateSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { validationFailed } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  addMember,
  addMilestone,
  changeProjectState,
  convertDealToProject,
  createProject,
  getDeliveryDashboard,
  getHandoffQueue,
  getProject,
  listDeliveryStaff,
  listProjects,
  listShares,
  moveMilestone,
  removeMember,
  revokeShare,
  shareProject,
  toggleChecklist,
  updateMilestone,
  updateProject,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/projects/...`, `/deals/:id/convert-to-project`, `/dashboard/delivery`. */
export function projectsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const read = requirePermission(
    'projects.read.all',
    'projects.read.member',
    'projects.read.linked',
  );
  const manage = requirePermission('projects.manage');
  const create = requirePermission('projects.create');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.post(
    '/deals/:id/convert-to-project',
    create,
    wrap(async (req, res) => {
      const parsedKey = idempotencyKeySchema.safeParse(req.get('idempotency-key'));
      if (!parsedKey.success) {
        throw validationFailed({ 'Idempotency-Key': [parsedKey.error.issues[0]!.message] });
      }
      const input = parseOrThrow(convertDealSchema, req.body);
      const result = await convertDealToProject(
        deps,
        req.auth!.user,
        p(req, 'id'),
        parsedKey.data,
        input,
        req.requestId,
      );
      const project = await getProject(db, req.auth!.user, result.projectId);
      ok(req, res, { project, replayed: result.replayed }, result.replayed ? 200 : 201);
    }),
  );

  router.get(
    '/projects/staff',
    requirePermission('projects.create', 'projects.manage'),
    wrap(async (req, res) => ok(req, res, await listDeliveryStaff(db, req.auth!.user))),
  );

  router.get(
    '/projects/handoff-queue',
    create,
    wrap(async (req, res) => ok(req, res, await getHandoffQueue(db, req.auth!.user))),
  );

  router.get(
    '/dashboard/delivery',
    requirePermission('dashboard.delivery'),
    wrap(async (req, res) =>
      ok(req, res, await getDeliveryDashboard(db, req.auth!.user, req.auth!.agency.timezone)),
    ),
  );

  router.get(
    '/projects',
    read,
    wrap(async (req, res) => {
      const { state } = parseOrThrow(projectListQuerySchema, req.query);
      ok(req, res, await listProjects(db, req.auth!.user, state));
    }),
  );

  router.post(
    '/projects',
    create,
    wrap(async (req, res) => {
      const input = parseOrThrow(projectCreateSchema, req.body);
      ok(req, res, await createProject(db, req.auth!.user, input, req.requestId), 201);
    }),
  );

  router.get(
    '/projects/:id',
    read,
    wrap(async (req, res) => ok(req, res, await getProject(db, req.auth!.user, p(req, 'id')))),
  );

  router.patch(
    '/projects/:id',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(projectUpdateSchema, req.body);
      ok(req, res, await updateProject(db, req.auth!.user, p(req, 'id'), input, req.requestId));
    }),
  );

  router.post(
    '/projects/:id/state',
    manage,
    wrap(async (req, res) => {
      const { version, state } = parseOrThrow(projectStateSchema, req.body);
      ok(
        req,
        res,
        await changeProjectState(db, req.auth!.user, p(req, 'id'), version, state, req.requestId),
      );
    }),
  );

  router.post(
    '/projects/:id/members',
    manage,
    wrap(async (req, res) => {
      const { userId } = parseOrThrow(projectMemberSchema, req.body);
      ok(req, res, await addMember(db, req.auth!.user, p(req, 'id'), userId, req.requestId));
    }),
  );

  router.post(
    '/projects/:id/members/:userId/remove',
    manage,
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await removeMember(db, req.auth!.user, p(req, 'id'), p(req, 'userId'), req.requestId),
      ),
    ),
  );

  router.post(
    '/projects/:id/milestones',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(milestoneCreateSchema, req.body);
      ok(req, res, await addMilestone(db, req.auth!.user, p(req, 'id'), input), 201);
    }),
  );

  router.patch(
    '/projects/:id/milestones/:milestoneId',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(milestoneUpdateSchema, req.body);
      ok(
        req,
        res,
        await updateMilestone(db, req.auth!.user, p(req, 'id'), p(req, 'milestoneId'), input),
      );
    }),
  );

  router.post(
    '/projects/:id/milestones/:milestoneId/move',
    manage,
    wrap(async (req, res) => {
      const { direction } = parseOrThrow(milestoneMoveSchema, req.body);
      ok(
        req,
        res,
        await moveMilestone(db, req.auth!.user, p(req, 'id'), p(req, 'milestoneId'), direction),
      );
    }),
  );

  router.get(
    '/projects/:id/shares',
    manage,
    wrap(async (req, res) => ok(req, res, await listShares(db, req.auth!.user, p(req, 'id')))),
  );

  router.post(
    '/projects/:id/shares',
    manage,
    wrap(async (req, res) => {
      const { userId } = parseOrThrow(projectShareSchema, req.body);
      ok(req, res, await shareProject(db, req.auth!.user, p(req, 'id'), userId, req.requestId));
    }),
  );

  router.post(
    '/projects/:id/shares/:userId/revoke',
    manage,
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await revokeShare(db, req.auth!.user, p(req, 'id'), p(req, 'userId'), req.requestId),
      ),
    ),
  );

  router.post(
    '/projects/:id/checklist/:itemId',
    manage,
    wrap(async (req, res) => {
      const { done } = parseOrThrow(checklistToggleSchema, req.body);
      ok(req, res, await toggleChecklist(db, req.auth!.user, p(req, 'id'), p(req, 'itemId'), done));
    }),
  );

  return router;
}
