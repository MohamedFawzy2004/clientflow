import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityCreateInput,
  ApiSuccess,
  ContactCreateInput,
  ContactCreateMeta,
  ContactDetail,
  ContactLifecycle,
  ContactSource,
  ContactSummary,
  ContactUpdateInput,
  ContactWithDeals,
  FollowUpFilter,
  PageMeta,
  TimelineEntry,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';
import { useInvalidateSales } from '../deals/api';

export interface LeadListParams {
  page: number;
  limit: number;
  q?: string;
  lifecycle?: ContactLifecycle;
  source?: ContactSource;
  ownerId?: string;
  followUp?: FollowUpFilter;
  archived?: boolean;
}

/** Query keys include the user id, so one user's cache is never shown to another (spec §11.4). */
function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

export function useLeads(params: LeadListParams) {
  const userKey = useUserKey();
  return useQuery({
    queryKey: [...userKey, 'contacts', params],
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
      });
      for (const k of ['q', 'lifecycle', 'source', 'ownerId', 'followUp'] as const) {
        if (params[k]) search.set(k, params[k]!);
      }
      if (params.archived) search.set('archived', 'true');
      return api.get<ApiSuccess<ContactSummary[], PageMeta>>(`/api/v1/contacts?${search}`, {
        signal,
      });
    },
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string) {
  const userKey = useUserKey();
  return useQuery({
    queryKey: [...userKey, 'contact', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ContactWithDeals>>(`/api/v1/contacts/${encodeURIComponent(id)}`, {
        signal,
      }),
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const userKey = useUserKey();
  return useMutation({
    mutationFn: (input: ContactCreateInput) =>
      api.post<ApiSuccess<ContactDetail, ContactCreateMeta>>('/api/v1/contacts', input),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [...userKey, 'contacts'] });
      qc.invalidateQueries({ queryKey: [...userKey, 'follow-ups'] });
      qc.setQueryData([...userKey, 'contact', res.data.id], undefined);
    },
  });
}

export type LeadAction =
  | { kind: 'update'; body: ContactUpdateInput }
  | { kind: 'convert' | 'archive' | 'restore'; version: number }
  | { kind: 'reassign'; ownerId: string; version: number }
  | { kind: 'activity'; body: ActivityCreateInput };

export function useLeadAction(id: string) {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (action: LeadAction) => {
      const base = `/api/v1/contacts/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'update':
          return api.patch<ApiSuccess<ContactWithDeals | TimelineEntry>>(base, action.body);
        case 'reassign':
          return api.post<ApiSuccess<ContactWithDeals | TimelineEntry>>(`${base}/reassign`, {
            ownerId: action.ownerId,
            version: action.version,
          });
        case 'activity':
          return api.post<ApiSuccess<ContactWithDeals | TimelineEntry>>(
            `${base}/activities`,
            action.body,
          );
        default:
          return api.post<ApiSuccess<ContactWithDeals | TimelineEntry>>(`${base}/${action.kind}`, {
            version: action.version,
          });
      }
    },
    // A 409 means our copy is stale: refresh on failure too.
    onSettled: invalidate,
  });
}
