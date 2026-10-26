import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccess,
  ClientDecisionInput,
  DeliverableDecisionInput,
  PortalDeliverableDetail,
  PortalProjectDetail,
  PortalProjectSummary,
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

// Projects shared with this client (M7)

export function usePortalProjects() {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'projects'],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalProjectSummary[]>>('/api/v1/portal/projects', { signal }),
  });
}

export function usePortalProject(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'project', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalProjectDetail>>(
        `/api/v1/portal/projects/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
}

export function usePortalDeliverable(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'deliverable', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalDeliverableDetail>>(
        `/api/v1/portal/deliverables/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
}

export function useDeliverableDecision(id: string) {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (input: DeliverableDecisionInput) =>
      api.post<ApiSuccess<PortalDeliverableDetail>>(
        `/api/v1/portal/deliverables/${encodeURIComponent(id)}/decision`,
        input,
      ),
    // A 409 (newer version, already decided) means our copy is out of date: reload either way.
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
