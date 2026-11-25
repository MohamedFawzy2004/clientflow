import { useQuery } from '@tanstack/react-query';
import {
  canAny,
  type ApiSuccess,
  type DeliveryIntelligence,
  type FinanceIntelligence,
  type Permission,
  type ProjectPlan,
  type RelationshipGraphData,
  type SalesIntelligence,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

/** Read-only intelligence (ADR-072). The server scopes every figure; these hooks only fetch. */
function useRead<T>(path: string | null, perms: Permission[], key: unknown[]) {
  const { data: user } = useSession();
  return useQuery({
    queryKey: ['u', user?.id ?? 'anon', 'intel', ...key],
    enabled: !!path && !!user && canAny(user.role, perms),
    queryFn: ({ signal }) => api.get<ApiSuccess<T>>(path!, { signal }).then((r) => r.data),
  });
}

export const useContactGraph = (contactId: string | null) =>
  useRead<RelationshipGraphData>(
    contactId ? `/api/v1/contacts/${contactId}/graph` : null,
    ['contacts.read.all', 'contacts.read.own'],
    ['graph', contactId],
  );

export const useSalesIntelligence = (months = 12) =>
  useRead<SalesIntelligence>(
    `/api/v1/insights/sales?months=${months}`,
    ['dashboard.sales'],
    ['sales', months],
  );

export const useFinanceIntelligence = (months = 12) =>
  useRead<FinanceIntelligence>(
    `/api/v1/insights/finance?months=${months}`,
    ['invoices.read.all', 'invoices.read.project'],
    ['finance', months],
  );

export const useDeliveryIntelligence = () =>
  useRead<DeliveryIntelligence>('/api/v1/insights/delivery', ['delivery.work'], ['delivery']);

export const useProjectPlan = (projectId: string) =>
  useRead<ProjectPlan>(
    `/api/v1/projects/${projectId}/plan`,
    ['delivery.work'],
    ['plan', projectId],
  );
