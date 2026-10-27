import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  canAny,
  type ApiSuccess,
  type CostRateInput,
  type CostRateView,
  type Currency,
  type FinanceReport,
  type FinanceReportQuery,
  type InvoiceCreateInput,
  type InvoiceDetail,
  type InvoiceDraftInput,
  type InvoiceSummary,
  type PaymentCreateInput,
  type PortalInvoiceDetail,
  type PortalInvoiceSummary,
  type ProjectFinance,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

const enc = encodeURIComponent;

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

/** UI hints only: the API checks the same permissions on every request. */
export function useFinancePermissions() {
  const { data } = useSession();
  const r = data?.role;
  return {
    read: r ? canAny(r, ['invoices.read.all', 'invoices.read.project']) : false,
    manage: r ? can(r, 'invoices.manage') : false,
    pay: r ? can(r, 'payments.record') : false,
    view: r ? can(r, 'finance.view') : false,
    rates: r ? can(r, 'costs.manage') : false,
  };
}

function query(params: Record<string, string | undefined>) {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${enc(v!)}`)
    .join('&');
  return q ? `?${q}` : '';
}

export function useInvoices(filter: { status?: string; projectId?: string } = {}) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'invoices', filter],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<{ invoices: InvoiceSummary[]; access: { create: boolean } }>>(
        `/api/v1/invoices${query(filter)}`,
        { signal },
      ),
  });
}

export function useInvoice(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'invoice', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<InvoiceDetail>>(`/api/v1/invoices/${enc(id)}`, { signal }),
  });
}

export function useInvoiceOptions(enabled: boolean) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'invoice-options'],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get<
        ApiSuccess<
          Array<{
            id: string;
            name: string;
            projects: Array<{ id: string; title: string; currency: Currency }>;
          }>
        >
      >('/api/v1/invoices/options', { signal }),
  });
}

export function useProjectFinance(projectId: string | null, enabled = true) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'project-finance', projectId],
    enabled: enabled && projectId !== null,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProjectFinance>>(`/api/v1/projects/${enc(projectId!)}/finance`, {
        signal,
      }),
  });
}

export type InvoiceAction =
  | { kind: 'create'; body: InvoiceCreateInput }
  | { kind: 'draft'; id: string; body: InvoiceDraftInput }
  | { kind: 'issue' | 'publish' | 'delete'; id: string; version: number }
  | { kind: 'void'; id: string; version: number; reason: string }
  | { kind: 'pay'; id: string; key: string; body: PaymentCreateInput }
  | { kind: 'reverse'; id: string; paymentId: string; reason: string };

/** Invoices change totals and project money: refresh both. */
export function useInvoiceAction() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (a: InvoiceAction): Promise<unknown> => {
      const base = (id: string) => `/api/v1/invoices/${enc(id)}`;
      switch (a.kind) {
        case 'create':
          return api.post<ApiSuccess<InvoiceDetail>>('/api/v1/invoices', a.body);
        case 'draft':
          return api.put<ApiSuccess<InvoiceDetail>>(`${base(a.id)}/draft`, a.body);
        case 'issue':
        case 'publish':
        case 'delete':
          return api.post(`${base(a.id)}/${a.kind}`, { version: a.version });
        case 'void':
          return api.post(`${base(a.id)}/void`, { version: a.version, reason: a.reason });
        case 'pay':
          // The key is chosen once per form: a retry after a lost answer cannot pay twice.
          return api.post(`${base(a.id)}/payments`, a.body, {
            headers: { 'Idempotency-Key': a.key },
          });
        case 'reverse':
          return api.post(`${base(a.id)}/payments/${enc(a.paymentId)}/reverse`, {
            reason: a.reason,
          });
      }
    },
    onSettled: () =>
      Promise.all(
        ['invoices', 'invoice', 'project-finance', 'finance-report'].map((k) =>
          qc.invalidateQueries({ queryKey: [...key, k] }),
        ),
      ),
  });
}

export function useFinanceReport(q: FinanceReportQuery) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'finance-report', q],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<FinanceReport>>(
        `/api/v1/reports/finance${query(q as Record<string, string | undefined>)}`,
        { signal },
      ),
  });
}

export function exportUrl(q: FinanceReportQuery) {
  return `/api/v1/exports/invoices.csv${query(q as Record<string, string | undefined>)}`;
}

export function useCostRates() {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'cost-rates'],
    queryFn: ({ signal }) => api.get<ApiSuccess<CostRateView[]>>('/api/v1/cost-rates', { signal }),
  });
}

export function useSetCostRate() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: CostRateInput }) =>
      api.post<ApiSuccess<CostRateView[]>>(`/api/v1/users/${enc(userId)}/cost-rates`, body),
    onSettled: () =>
      Promise.all(
        ['cost-rates', 'project-finance'].map((k) =>
          qc.invalidateQueries({ queryKey: [...key, k] }),
        ),
      ),
  });
}

export function usePortalInvoices() {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'portal', 'invoices'],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalInvoiceSummary[]>>('/api/v1/portal/invoices', { signal }),
  });
}

export function usePortalInvoice(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'portal', 'invoice', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalInvoiceDetail>>(`/api/v1/portal/invoices/${enc(id)}`, { signal }),
  });
}
