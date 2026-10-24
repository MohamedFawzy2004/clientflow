import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  type ApiSuccess,
  type InvitationCreate,
  type InvitationCreated,
  type InvitationSummary,
  type StaffRole,
  type TeamMember,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useTeamKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon', 'team'] as const;
}

/** Roles without team access never request team data (the API would answer 403 anyway). */
function useCanReadTeam() {
  const { data } = useSession();
  return data ? can(data.role, 'team.read') : false;
}

export function useMembers() {
  const key = useTeamKey();
  return useQuery({
    queryKey: [...key, 'members'],
    enabled: useCanReadTeam(),
    queryFn: ({ signal }) => api.get<ApiSuccess<TeamMember[]>>('/api/v1/users', { signal }),
  });
}

export function useInvitations() {
  const key = useTeamKey();
  return useQuery({
    queryKey: [...key, 'invitations'],
    enabled: useCanReadTeam(),
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<InvitationSummary[]>>('/api/v1/invitations', { signal }),
  });
}

function useInvalidateTeam() {
  const qc = useQueryClient();
  const key = useTeamKey();
  return () => qc.invalidateQueries({ queryKey: key });
}

export function useInvite() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (input: InvitationCreate) =>
      api.post<ApiSuccess<InvitationCreated>>('/api/v1/invitations', input),
    onSuccess: invalidate,
  });
}

export function useInvitationAction() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'revoke' | 'resend' }) =>
      api.post<ApiSuccess<InvitationSummary | InvitationCreated>>(
        `/api/v1/invitations/${encodeURIComponent(id)}/${action}`,
      ),
    onSettled: invalidate,
  });
}

export type MemberAction =
  | { kind: 'role'; role: StaffRole }
  | { kind: 'deactivate' }
  | { kind: 'reactivate' }
  | { kind: 'revoke-sessions' };

export function useMemberAction() {
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ member, action }: { member: TeamMember; action: MemberAction }) => {
      const base = `/api/v1/users/${encodeURIComponent(member.id)}`;
      if (action.kind === 'role') {
        return api.patch<ApiSuccess<TeamMember>>(base, {
          role: action.role,
          version: member.version,
        });
      }
      if (action.kind === 'revoke-sessions') {
        return api.post<ApiSuccess<TeamMember>>(`${base}/revoke-sessions`);
      }
      return api.post<ApiSuccess<TeamMember>>(`${base}/${action.kind}`, {
        version: member.version,
      });
    },
    // Refetch after success AND failure: a 409 means our copy is stale.
    onSettled: invalidate,
  });
}
