import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  canAny,
  type ApiSuccess,
  type AssignableUser,
  type DealBoard,
  type DealCloseInput,
  type DealCreateInput,
  type DealDetail,
  type DealStatus,
  type DealSummary,
  type DealUpdateInput,
  type FollowUpQueue,
  type PageMeta,
  type PipelineSummary,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

export function useCanSeeDeals() {
  const { data } = useSession();
  return data ? canAny(data.role, ['deals.read.all', 'deals.read.own']) : false;
}

export function useCanManageSales() {
  const { data } = useSession();
  return data ? can(data.role, 'sales.reassign') : false;
}

/** After any deal or contact change, every sales view may be stale: refresh them together. */
export function useInvalidateSales() {
  const qc = useQueryClient();
  const key = useUserKey();
  return () =>
    Promise.all(
      ['deals', 'deal', 'board', 'follow-ups', 'contacts', 'contact'].map((k) =>
        qc.invalidateQueries({ queryKey: [...key, k] }),
      ),
    );
}

export function usePipeline() {
  const key = useUserKey();
  const enabled = useCanSeeDeals();
  return useQuery({
    queryKey: [...key, 'pipeline'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PipelineSummary>>('/api/v1/pipelines/default', { signal }),
  });
}

export function useBoard() {
  const key = useUserKey();
  const enabled = useCanSeeDeals();
  return useQuery({
    queryKey: [...key, 'board'],
    enabled,
    queryFn: ({ signal }) => api.get<ApiSuccess<DealBoard>>('/api/v1/deals/board', { signal }),
  });
}

export interface DealListParams {
  page: number;
  limit: number;
  q?: string;
  status?: DealStatus;
  stageId?: string;
  ownerId?: string;
}

export function useDeals(params: DealListParams) {
  const key = useUserKey();
  const enabled = useCanSeeDeals();
  return useQuery({
    queryKey: [...key, 'deals', params],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
      });
      for (const k of ['q', 'status', 'stageId', 'ownerId'] as const) {
        if (params[k]) search.set(k, params[k]!);
      }
      return api.get<ApiSuccess<DealSummary[], PageMeta>>(`/api/v1/deals?${search}`, { signal });
    },
  });
}

export function useDeal(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'deal', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<DealDetail>>(`/api/v1/deals/${encodeURIComponent(id)}`, { signal }),
  });
}

export function useFollowUps() {
  const key = useUserKey();
  const { data } = useSession();
  const enabled = data ? canAny(data.role, ['contacts.read.all', 'contacts.read.own']) : false;
  return useQuery({
    queryKey: [...key, 'follow-ups'],
    enabled,
    queryFn: ({ signal }) => api.get<ApiSuccess<FollowUpQueue>>('/api/v1/follow-ups', { signal }),
  });
}

export function useAssignableOwners() {
  const key = useUserKey();
  const enabled = useCanManageSales();
  return useQuery({
    queryKey: [...key, 'assignable-owners'],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<AssignableUser[]>>('/api/v1/sales/assignable-owners', { signal }),
  });
}

export type DealAction =
  | { kind: 'update'; body: DealUpdateInput }
  | { kind: 'move'; stageId: string; version: number }
  | { kind: 'close'; body: DealCloseInput }
  | { kind: 'reopen'; version: number; reason: string }
  | { kind: 'reassign'; ownerId: string; version: number };

export function useDealAction(id: string) {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (action: DealAction) => {
      const base = `/api/v1/deals/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'update':
          return api.patch<ApiSuccess<DealDetail>>(base, action.body);
        case 'move':
          return api.post<ApiSuccess<DealDetail>>(`${base}/move`, {
            stageId: action.stageId,
            version: action.version,
          });
        case 'close':
          return api.post<ApiSuccess<DealDetail>>(`${base}/close`, action.body);
        case 'reopen':
          return api.post<ApiSuccess<DealDetail>>(`${base}/reopen`, {
            version: action.version,
            reason: action.reason,
          });
        case 'reassign':
          return api.post<ApiSuccess<DealDetail>>(`${base}/reassign`, {
            ownerId: action.ownerId,
            version: action.version,
          });
      }
    },
    // Success and failure both refresh: a 409 means our copy is stale.
    onSettled: invalidate,
  });
}

export function useCreateDeal() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (input: DealCreateInput) =>
      api.post<ApiSuccess<DealDetail>>('/api/v1/deals', input),
    onSuccess: invalidate,
  });
}

/** Board drag and keyboard moves share one mutation that takes the deal id per call. */
export function useMoveDeal() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, stageId, version }: { id: string; stageId: string; version: number }) =>
      api.post<ApiSuccess<DealDetail>>(`/api/v1/deals/${encodeURIComponent(id)}/move`, {
        stageId,
        version,
      }),
    onSettled: invalidate,
  });
}
