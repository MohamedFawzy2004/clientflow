import { type Request, type Response, Router } from 'express';
import {
  costRateSchema,
  financeReportQuerySchema,
  idempotencyKeySchema,
  invoiceActionSchema,
  invoiceCreateSchema,
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoiceVoidSchema,
  paymentCreateSchema,
  paymentReverseSchema,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { validationFailed } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  createInvoice,
  deleteDraft,
  exportInvoicesCsv,
  getFinanceReport,
  getInvoice,
  getProjectFinance,
  invoiceOptions,
  issueInvoice,
  listCostRates,
  listInvoices,
  publishInvoice,
  recordPayment,
  reversePayment,
  saveInvoiceDraft,
  setCostRate,
  voidInvoice,
} from './service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: (err?: unknown) => void) =>
  fn(req, res).catch(next);

/** Mounted at the API root: `/invoices/...`, `/projects/:id/finance`, `/reports/finance`, … */
export function invoicesRouter(deps: AppDeps) {
  const { db } = deps;
  const router = Router();
  const read = requirePermission('invoices.read.all', 'invoices.read.project');
  const manage = requirePermission('invoices.manage');
  const pay = requirePermission('payments.record');
  const finance = requirePermission('finance.view');
  const ok = (req: Request, res: Response, data: unknown, status = 200) => {
    res.status(status).json({ data, meta: { requestId: req.requestId } });
  };
  const p = (req: Request, name: string) => String(req.params[name]);

  router.get(
    '/invoices',
    read,
    wrap(async (req, res) => {
      const query = parseOrThrow(invoiceListQuerySchema, req.query);
      ok(req, res, await listInvoices(db, req.auth!.user, query));
    }),
  );

  router.post(
    '/invoices',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(invoiceCreateSchema, req.body);
      ok(req, res, await createInvoice(db, req.auth!.user, input, req.requestId), 201);
    }),
  );

  router.get(
    '/invoices/options',
    manage,
    wrap(async (req, res) => ok(req, res, await invoiceOptions(db, req.auth!.user))),
  );

  router.get(
    '/invoices/:id',
    read,
    wrap(async (req, res) => ok(req, res, await getInvoice(db, req.auth!.user, p(req, 'id')))),
  );

  router.put(
    '/invoices/:id/draft',
    manage,
    wrap(async (req, res) => {
      const input = parseOrThrow(invoiceDraftSchema, req.body);
      ok(req, res, await saveInvoiceDraft(db, req.auth!.user, p(req, 'id'), input));
    }),
  );

  for (const [action, fn] of [
    ['issue', issueInvoice],
    ['publish', publishInvoice],
  ] as const) {
    router.post(
      `/invoices/:id/${action}`,
      manage,
      wrap(async (req, res) => {
        const { version } = parseOrThrow(invoiceActionSchema, req.body);
        ok(req, res, await fn(db, req.auth!.user, p(req, 'id'), version, req.requestId));
      }),
    );
  }

  router.post(
    '/invoices/:id/void',
    manage,
    wrap(async (req, res) => {
      const { version, reason } = parseOrThrow(invoiceVoidSchema, req.body);
      ok(
        req,
        res,
        await voidInvoice(db, req.auth!.user, p(req, 'id'), version, reason, req.requestId),
      );
    }),
  );

  router.post(
    '/invoices/:id/delete',
    manage,
    wrap(async (req, res) => {
      const { version } = parseOrThrow(invoiceActionSchema, req.body);
      ok(req, res, await deleteDraft(db, req.auth!.user, p(req, 'id'), version, req.requestId));
    }),
  );

  router.post(
    '/invoices/:id/payments',
    pay,
    wrap(async (req, res) => {
      const parsedKey = idempotencyKeySchema.safeParse(req.get('idempotency-key'));
      if (!parsedKey.success) {
        throw validationFailed({
          'Idempotency-Key': [
            'Send an Idempotency-Key header with a UUID, so a retry cannot record a payment twice.',
          ],
        });
      }
      const input = parseOrThrow(paymentCreateSchema, req.body);
      const result = await recordPayment(
        deps,
        req.auth!.user,
        p(req, 'id'),
        parsedKey.data,
        input,
        req.requestId,
      );
      ok(req, res, result, result.replayed ? 200 : 201);
    }),
  );

  router.post(
    '/invoices/:id/payments/:paymentId/reverse',
    pay,
    wrap(async (req, res) => {
      const { reason } = parseOrThrow(paymentReverseSchema, req.body);
      ok(
        req,
        res,
        await reversePayment(
          db,
          req.auth!.user,
          p(req, 'id'),
          p(req, 'paymentId'),
          reason,
          req.requestId,
        ),
      );
    }),
  );

  router.get(
    '/projects/:id/finance',
    requirePermission('finance.view', 'projects.manage'),
    wrap(async (req, res) =>
      ok(req, res, await getProjectFinance(db, req.auth!.user, p(req, 'id'))),
    ),
  );

  router.get(
    '/reports/finance',
    finance,
    wrap(async (req, res) => {
      const q = parseOrThrow(financeReportQuerySchema, req.query);
      ok(req, res, await getFinanceReport(db, req.auth!.user, q));
    }),
  );

  router.get(
    '/exports/invoices.csv',
    finance,
    wrap(async (req, res) => {
      const q = parseOrThrow(financeReportQuerySchema, req.query);
      const file = await exportInvoicesCsv(db, req.auth!.user, q, req.requestId);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('X-Export-Rows', String(file.rows));
      res.send(file.body);
    }),
  );

  router.get(
    '/cost-rates',
    finance,
    wrap(async (req, res) => ok(req, res, await listCostRates(db, req.auth!.user))),
  );

  router.post(
    '/users/:id/cost-rates',
    requirePermission('costs.manage'),
    wrap(async (req, res) => {
      const input = parseOrThrow(costRateSchema, req.body);
      ok(req, res, await setCostRate(db, req.auth!.user, p(req, 'id'), input, req.requestId));
    }),
  );

  return router;
}
