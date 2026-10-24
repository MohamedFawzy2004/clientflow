import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccess,
  ContactCreateInput,
  ContactCreateMeta,
  ContactDetail,
  ContactLifecycle,
  ContactSummary,
  PageMeta,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

export interface LeadListParams {
  page: number;
  limit: number;
  q?: string;
  lifecycle?: ContactLifecycle;
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
      if (params.q) search.set('q', params.q);
      if (params.lifecycle) search.set('lifecycle', params.lifecycle);
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
      api.get<ApiSuccess<ContactDetail>>(`/api/v1/contacts/${encodeURIComponent(id)}`, { signal }),
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
      qc.setQueryData([...userKey, 'contact', res.data.id], undefined);
    },
  });
}
