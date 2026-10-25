import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccess,
  ClientDecisionInput,
  PortalProposalDetail,
  PortalProposalSummary,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon', 'portal'] as const;
}

export function usePortalProposals() {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'proposals'],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalProposalSummary[]>>('/api/v1/portal/proposals', { signal }),
  });
}

export function usePortalProposal(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'proposal', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalProposalDetail>>(
        `/api/v1/portal/proposals/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
}

export function usePortalDecision(id: string) {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (input: ClientDecisionInput) =>
      api.post<ApiSuccess<PortalProposalDetail>>(
        `/api/v1/portal/proposals/${encodeURIComponent(id)}/decision`,
        input,
      ),
    // A 409 (newer version, expired) means our copy is out of date: reload either way.
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
