import { type Request, type Response, Router } from 'express';
import {
  activityCreateSchema,
  contactCreateSchema,
  contactListFiltersSchema,
  contactUpdateSchema,
  reassignSchema,
  versionOnlySchema,
  type ContactCreateMeta,
  type PageMeta,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { toTimelineEntry } from '../../lib/timeline.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  addTimelineEntry,
  convertContact,
  reassignContact,
  setArchived,
  updateContact,
} from './mutations.js';
import { toContactDetail, toContactSummary, toContactWithDeals } from './serializer.js';
import { createContact, getContact, listContacts } from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

export function contactsRouter({ db }: AppDeps) {
  const router = Router();
  router.use(requireAuth);

  /** Responds with the fresh detail view after any write, so the client gets the new version. */
  const respondWithDetail = async (req: Request, res: Response, id: string, status = 200) => {
    const { contact, activities, deals } = await getContact(db, req.auth!.user, id);
    res.status(status).json({
      data: toContactWithDeals(contact, activities, deals),
      meta: { requestId: req.requestId },
    });
  };

  router.get(
    '/',
    wrap(async (req, res) => {
      const query = parseOrThrow(contactListFiltersSchema, req.query);
      const { total, rows } = await listContacts(
        db,
        req.auth!.user,
        query,
        req.auth!.agency.timezone,
      );
      const meta: PageMeta & { requestId: string } = {
        page: query.page,
        limit: query.limit,
        total,
        requestId: req.requestId,
      };
      res.json({ data: rows.map(toContactSummary), meta });
    }),
  );

  router.post(
    '/',
    wrap(async (req, res) => {
      const input = parseOrThrow(contactCreateSchema, req.body);
      const { contact, possibleDuplicates } = await createContact(
        db,
        req.auth!.user,
        input,
        req.requestId,
      );
      const meta: ContactCreateMeta & { requestId: string } = {
        possibleDuplicates,
        requestId: req.requestId,
      };
      res.status(201).json({ data: toContactDetail(contact, []), meta });
    }),
  );

  router.get(
    '/:id',
    wrap(async (req, res) => respondWithDetail(req, res, String(req.params.id))),
  );

  // Only the listed fields are accepted (strict schema): owner, agency, lifecycle and archive
  // state have their own endpoints with their own rules (T-ACL-03).
  router.patch(
    '/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const input = parseOrThrow(contactUpdateSchema, req.body);
      await updateContact(db, req.auth!.user, id, input, req.requestId);
      await respondWithDetail(req, res, id);
    }),
  );

  router.post(
    '/:id/convert',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const { version } = parseOrThrow(versionOnlySchema, req.body);
      await convertContact(db, req.auth!.user, id, version, req.requestId);
      await respondWithDetail(req, res, id);
    }),
  );

  router.post(
    '/:id/archive',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const { version } = parseOrThrow(versionOnlySchema, req.body);
      await setArchived(db, req.auth!.user, id, true, version, req.requestId);
      await respondWithDetail(req, res, id);
    }),
  );

  router.post(
    '/:id/restore',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const { version } = parseOrThrow(versionOnlySchema, req.body);
      await setArchived(db, req.auth!.user, id, false, version, req.requestId);
      await respondWithDetail(req, res, id);
    }),
  );

  router.post(
    '/:id/reassign',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      const { ownerId, version } = parseOrThrow(reassignSchema, req.body);
      await reassignContact(db, req.auth!.user, id, ownerId, version, req.requestId);
      await respondWithDetail(req, res, id);
    }),
  );

  router.post(
    '/:id/activities',
    wrap(async (req, res) => {
      const input = parseOrThrow(activityCreateSchema, req.body);
      const entry = await addTimelineEntry(db, req.auth!.user, String(req.params.id), input);
      const withActor = { ...entry, actor: { id: req.auth!.user.id, name: req.auth!.user.name } };
      res
        .status(201)
        .json({ data: toTimelineEntry(withActor), meta: { requestId: req.requestId } });
    }),
  );

  return router;
}
