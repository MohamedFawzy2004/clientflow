import { Router } from 'express';
import {
  contactCreateSchema,
  contactListQuerySchema,
  type ContactCreateMeta,
  type PageMeta,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { toContactDetail, toContactSummary } from './serializer.js';
import { createContact, getContact, listContacts } from './service.js';

export function contactsRouter({ db }: AppDeps) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const query = parseOrThrow(contactListQuerySchema, req.query);
      const { total, rows } = await listContacts(db, req.auth!.user, query);
      const meta: PageMeta & { requestId: string } = {
        page: query.page,
        limit: query.limit,
        total,
        requestId: req.requestId,
      };
      res.json({ data: rows.map(toContactSummary), meta });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
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
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { contact, activities } = await getContact(db, req.auth!.user, req.params.id);
      res.json({ data: toContactDetail(contact, activities), meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
