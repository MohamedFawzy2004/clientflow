import { type Request, type Response, Router } from 'express';
import {
  taskCreateSchema,
  taskDependencySchema,
  taskListQuerySchema,
  taskStatusSchema,
  taskUpdateSchema,
  timeEntryCreateSchema,
  timeEntryUpdateSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  addDependency,
  changeTaskStatus,
  createTask,
  deleteTimeEntry,
  getProjectTime,
  getTask,
  listTasks,
  listTaskTime,
  logTime,
  removeDependency,
  updateTask,
  updateTimeEntry,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/projects/:id/tasks`, `/tasks/...`, `/time-entries/...`. */
export function tasksRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const work = requirePermission('delivery.work');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);
  const tz = (req: Request) => req.auth!.agency.timezone;

  router.get(
    '/projects/:id/tasks',
    work,
    wrap(async (req, res) => {
      const query = parseOrThrow(taskListQuerySchema, req.query);
      ok(req, res, await listTasks(db, req.auth!.user, p(req, 'id'), query, tz(req)));
    }),
  );

  router.post(
    '/projects/:id/tasks',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(taskCreateSchema, req.body);
      ok(
        req,
        res,
        await createTask(db, req.auth!.user, p(req, 'id'), input, req.requestId, tz(req)),
        201,
      );
    }),
  );

  router.get(
    '/projects/:id/time',
    work,
    wrap(async (req, res) => ok(req, res, await getProjectTime(db, req.auth!.user, p(req, 'id')))),
  );

  router.get(
    '/tasks/:taskId',
    work,
    wrap(async (req, res) =>
      ok(req, res, await getTask(db, req.auth!.user, p(req, 'taskId'), tz(req))),
    ),
  );

  router.patch(
    '/tasks/:taskId',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(taskUpdateSchema, req.body);
      ok(req, res, await updateTask(db, req.auth!.user, p(req, 'taskId'), input, tz(req)));
    }),
  );

  router.post(
    '/tasks/:taskId/status',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(taskStatusSchema, req.body);
      ok(
        req,
        res,
        await changeTaskStatus(
          db,
          req.auth!.user,
          p(req, 'taskId'),
          input.version,
          input.status,
          req.requestId,
          tz(req),
        ),
      );
    }),
  );

  router.post(
    '/tasks/:taskId/dependencies',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(taskDependencySchema, req.body);
      ok(
        req,
        res,
        await addDependency(db, req.auth!.user, p(req, 'taskId'), input.dependsOnId, tz(req)),
      );
    }),
  );

  router.post(
    '/tasks/:taskId/dependencies/:dependsOnId/remove',
    work,
    wrap(async (req, res) =>
      ok(
        req,
        res,
        await removeDependency(
          db,
          req.auth!.user,
          p(req, 'taskId'),
          p(req, 'dependsOnId'),
          tz(req),
        ),
      ),
    ),
  );

  router.get(
    '/tasks/:taskId/time',
    work,
    wrap(async (req, res) =>
      ok(req, res, await listTaskTime(db, req.auth!.user, p(req, 'taskId'))),
    ),
  );

  router.post(
    '/tasks/:taskId/time',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(timeEntryCreateSchema, req.body);
      ok(
        req,
        res,
        await logTime(db, req.auth!.user, p(req, 'taskId'), input, req.requestId, tz(req)),
        201,
      );
    }),
  );

  router.patch(
    '/time-entries/:entryId',
    work,
    wrap(async (req, res) => {
      const input = parseOrThrow(timeEntryUpdateSchema, req.body);
      ok(req, res, await updateTimeEntry(db, req.auth!.user, p(req, 'entryId'), input, tz(req)));
    }),
  );

  router.post(
    '/time-entries/:entryId/delete',
    work,
    wrap(async (req, res) =>
      ok(req, res, await deleteTimeEntry(db, req.auth!.user, p(req, 'entryId'), req.requestId)),
    ),
  );

  return router;
}
