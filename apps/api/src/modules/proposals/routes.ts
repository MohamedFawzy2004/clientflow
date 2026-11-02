import { type Request, type Response, Router } from 'express';
import {
  internalReviewSchema,
  proposalCreateSchema,
  proposalDraftUpdateSchema,
  proposalListQuerySchema,
  proposalVersionActionSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { notFound } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  createProposal,
  getProposal,
  getProposalVersion,
  getVersionPdf,
  listProposals,
  reviewVersion,
  reviseProposal,
  sendVersion,
  submitForReview,
  updateDraft,
} from './service.js';

/** PDF download: attachment, never cached (the API sets no-store on every response). */
export function sendPdf(res: Response, file: { body: Buffer; filename: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.body);
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

export function proposalsRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const read = requirePermission('proposals.read.all', 'proposals.read.own');
  const write = requirePermission('proposals.write');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const id = (req: Request) => String(req.params.id);

  router.get(
    '/',
    read,
    wrap(async (req, res) => {
      const query = parseOrThrow(proposalListQuerySchema, req.query);
      ok(req, res, await listProposals(db, req.auth!.user, query));
    }),
  );

  router.post(
    '/',
    write,
    wrap(async (req, res) => {
      const input = parseOrThrow(proposalCreateSchema, req.body);
      ok(req, res, await createProposal(deps, req.auth!.user, input, req.requestId), 201);
    }),
  );

  router.get(
    '/:id',
    read,
    wrap(async (req, res) => ok(req, res, await getProposal(db, req.auth!.user, id(req)))),
  );

  router.get(
    '/:id/versions/:no',
    read,
    wrap(async (req, res) => {
      const no = Number(req.params.no);
      if (!Number.isSafeInteger(no) || no < 1 || no > 10_000) throw notFound();
      ok(req, res, await getProposalVersion(db, req.auth!.user, id(req), no));
    }),
  );

  router.get(
    '/:id/versions/:no/pdf',
    read,
    wrap(async (req, res) => {
      const no = Number(req.params.no);
      if (!Number.isSafeInteger(no) || no < 1 || no > 10_000) throw notFound();
      sendPdf(res, await getVersionPdf(db, req.auth!.user, id(req), no));
    }),
  );

  router.put(
    '/:id/draft',
    write,
    wrap(async (req, res) => {
      const input = parseOrThrow(proposalDraftUpdateSchema, req.body);
      ok(req, res, await updateDraft(deps, req.auth!.user, id(req), input, req.requestId));
    }),
  );

  router.post(
    '/:id/submit',
    write,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(proposalVersionActionSchema, req.body);
      ok(req, res, await submitForReview(deps, req.auth!.user, id(req), version, req.requestId));
    }),
  );

  router.post(
    '/:id/review',
    requirePermission('proposals.approve'),
    wrap(async (req, res) => {
      const input = parseOrThrow(internalReviewSchema, req.body);
      ok(req, res, await reviewVersion(deps, req.auth!.user, id(req), input, req.requestId));
    }),
  );

  router.post(
    '/:id/send',
    write,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(proposalVersionActionSchema, req.body);
      ok(req, res, await sendVersion(deps, req.auth!.user, id(req), version, req.requestId));
    }),
  );

  router.post(
    '/:id/revise',
    write,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(proposalVersionActionSchema, req.body);
      ok(req, res, await reviseProposal(deps, req.auth!.user, id(req), version, req.requestId));
    }),
  );

  return router;
}
