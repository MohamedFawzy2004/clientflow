import express, { type Request, type Response, Router } from 'express';
import {
  idempotencyKeySchema,
  importCommitSchema,
  importPreviewSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { validationFailed } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import { commitImport, listImports, previewImport, undoImport } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** The CSV travels as JSON text: up to 1 MB of CSV, plus escaping. */
export const IMPORT_BODY_LIMIT = '2mb';

/** Mounted at the API root. The app's 32 KB JSON parser skips /imports (see app.ts). */
export function importsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  // The permission check runs before the large body is read, so only importers can send one.
  const allowed = requirePermission('imports.run');
  const body = express.json({ limit: IMPORT_BODY_LIMIT, strict: true });
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };

  router.get(
    '/imports',
    allowed,
    wrap(async (req, res) => ok(req, res, await listImports(db, req.auth!.user))),
  );

  router.post(
    '/imports/preview',
    allowed,
    body,
    wrap(async (req, res) => {
      const input = parseOrThrow(importPreviewSchema, req.body);
      ok(req, res, await previewImport(db, req.auth!.user, input));
    }),
  );

  router.post(
    '/imports',
    allowed,
    body,
    wrap(async (req, res) => {
      const key = idempotencyKeySchema.safeParse(req.get('idempotency-key'));
      if (!key.success) {
        throw validationFailed({
          'Idempotency-Key': [
            'Send an Idempotency-Key header with a UUID, so a retry cannot import twice.',
          ],
        });
      }
      const input = parseOrThrow(importCommitSchema, req.body);
      const result = await commitImport(db, req.auth!.user, input, key.data, req.requestId);
      ok(req, res, result, result.replayed ? 200 : 201);
    }),
  );

  router.post(
    '/imports/:id/undo',
    allowed,
    wrap(async (req, res) =>
      ok(req, res, await undoImport(db, req.auth!.user, String(req.params.id), req.requestId)),
    ),
  );

  return router;
}
