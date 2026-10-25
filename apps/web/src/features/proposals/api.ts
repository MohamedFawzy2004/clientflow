import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  canAny,
  type ApiSuccess,
  type ClientOrgDetail,
  type InternalReviewInput,
  type PortalInvitationCreated,
  type ProposalDetail,
  type ProposalDraftUpdateInput,
  type ProposalStatus,
  type ProposalSummary,
  type ProposalVersionView,
  type ServiceCreateInput,
  type ServiceSummary,
  type ServiceUpdateInput,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

/** UI hints only: the API checks the same permissions plus record scope on every request. */
export function useProposalPermissions() {
  const { data } = useSession();
  const role = data?.role;
  return {
    read: role ? canAny(role, ['proposals.read.all', 'proposals.read.own']) : false,
    write: role ? can(role, 'proposals.write') : false,
    approve: role ? can(role, 'proposals.approve') : false,
    manageServices: role ? can(role, 'services.manage') : false,
    readServices: role ? can(role, 'services.read') : false,
    managePortal: role ? can(role, 'portal.manage') : false,
  };
}

export function useInvalidateProposals() {
  const qc = useQueryClient();
  const key = useUserKey();
  return () =>
    Promise.all(
      ['proposals', 'proposal', 'deal', 'deals', 'board', 'contact', 'client-org'].map((k) =>
        qc.invalidateQueries({ queryKey: [...key, k] }),
      ),
    );
}

export function useProposals(params: { status?: ProposalStatus; dealId?: string } = {}) {
  const key = useUserKey();
  const { read } = useProposalPermissions();
  return useQuery({
    queryKey: [...key, 'proposals', params],
    enabled: read,
    queryFn: ({ signal }) => {
      const search = new URLSearchParams();
      if (params.status) search.set('status', params.status);
      if (params.dealId) search.set('dealId', params.dealId);
      const qs = search.toString();
      return api.get<ApiSuccess<ProposalSummary[]>>(`/api/v1/proposals${qs ? `?${qs}` : ''}`, {
        signal,
      });
    },
  });
}

export function useProposal(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'proposal', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProposalDetail>>(`/api/v1/proposals/${encodeURIComponent(id)}`, {
        signal,
      }),
  });
}

export function useProposalVersion(id: string, versionNo: number | null) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'proposal', id, 'v', versionNo],
    enabled: versionNo !== null,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProposalVersionView>>(
        `/api/v1/proposals/${encodeURIComponent(id)}/versions/${versionNo}`,
        { signal },
      ),
  });
}

export function useCreateProposal() {
  const invalidate = useInvalidateProposals();
  return useMutation({
    mutationFn: (input: { dealId: string; title?: string }) =>
      api.post<ApiSuccess<ProposalDetail>>('/api/v1/proposals', input),
    onSuccess: invalidate,
  });
}

export type ProposalAction =
  | { kind: 'draft'; body: ProposalDraftUpdateInput }
  | { kind: 'submit'; version: number }
  | { kind: 'review'; body: InternalReviewInput }
  | { kind: 'send'; version: number }
  | { kind: 'revise'; version: number };

export function useProposalAction(id: string) {
  const invalidate = useInvalidateProposals();
  return useMutation({
    mutationFn: (action: ProposalAction) => {
      const base = `/api/v1/proposals/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'draft':
          return api.put<ApiSuccess<ProposalDetail>>(`${base}/draft`, action.body);
        case 'review':
          return api.post<ApiSuccess<ProposalDetail>>(`${base}/review`, action.body);
        default:
          return api.post<ApiSuccess<ProposalDetail>>(`${base}/${action.kind}`, {
            version: action.version,
          });
      }
    },
    // A 409 means our copy is stale: refresh either way.
    onSettled: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

export function useServices(includeArchived = false) {
  const key = useUserKey();
  const { readServices } = useProposalPermissions();
  return useQuery({
    queryKey: [...key, 'services', includeArchived],
    enabled: readServices,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ServiceSummary[]>>(
        `/api/v1/services${includeArchived ? '?archived=true' : ''}`,
        { signal },
      ),
  });
}

export type ServiceAction =
  | { kind: 'create'; body: ServiceCreateInput }
  | { kind: 'update'; id: string; body: ServiceUpdateInput }
  | { kind: 'archive' | 'restore'; id: string; version: number };

export function useServiceAction() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (action: ServiceAction) => {
      switch (action.kind) {
        case 'create':
          return api.post<ApiSuccess<ServiceSummary>>('/api/v1/services', action.body);
        case 'update':
          return api.patch<ApiSuccess<ServiceSummary>>(
            `/api/v1/services/${encodeURIComponent(action.id)}`,
            action.body,
          );
        default:
          return api.post<ApiSuccess<ServiceSummary>>(
            `/api/v1/services/${encodeURIComponent(action.id)}/${action.kind}`,
            { version: action.version },
          );
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [...key, 'services'] }),
  });
}

// ---------------------------------------------------------------------------
// Client organizations and portal access
// ---------------------------------------------------------------------------

export function useClientOrg(id: string | null) {
  const key = useUserKey();
  const { managePortal } = useProposalPermissions();
  return useQuery({
    queryKey: [...key, 'client-org', id],
    enabled: managePortal && id !== null,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ClientOrgDetail>>(`/api/v1/client-orgs/${encodeURIComponent(id!)}`, {
        signal,
      }),
  });
}

export type PortalAction =
  | { kind: 'create-org'; contactId: string; name: string }
  | { kind: 'invite'; orgId: string; email: string }
  | { kind: 'revoke'; orgId: string; invitationId: string }
  | { kind: 'deactivate' | 'reactivate'; orgId: string; userId: string; version: number };

export function usePortalAction() {
  const invalidate = useInvalidateProposals();
  return useMutation({
    mutationFn: (
      action: PortalAction,
    ): Promise<ApiSuccess<ClientOrgDetail> | ApiSuccess<PortalInvitationCreated>> => {
      const org = (id: string) => `/api/v1/client-orgs/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'create-org':
          return api.post(`/api/v1/contacts/${encodeURIComponent(action.contactId)}/client-org`, {
            name: action.name,
          });
        case 'invite':
          return api.post(`${org(action.orgId)}/invitations`, { email: action.email });
        case 'revoke':
          return api.post(
            `${org(action.orgId)}/invitations/${encodeURIComponent(action.invitationId)}/revoke`,
          );
        default:
          return api.post(
            `${org(action.orgId)}/users/${encodeURIComponent(action.userId)}/${action.kind}`,
            { version: action.version },
          );
      }
    },
    onSettled: invalidate,
  });
}
