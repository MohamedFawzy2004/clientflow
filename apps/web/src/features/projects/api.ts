import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  canAny,
  type ApiSuccess,
  type ConvertDealInput,
  type ConvertResult,
  type DeliveryDashboard,
  type HandoffCandidate,
  type MilestoneStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectState,
  type ProjectSummary,
  type ProjectUpdateInput,
  type Role,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

/** UI hints only: the API applies the same rules plus project membership on every request. */
export function useProjectPermissions() {
  const { data } = useSession();
  const r = data?.role;
  return {
    read: r
      ? canAny(r, ['projects.read.all', 'projects.read.member', 'projects.read.linked'])
      : false,
    create: r ? can(r, 'projects.create') : false,
    delivery: r ? can(r, 'dashboard.delivery') : false,
  };
}

function useInvalidate() {
  const qc = useQueryClient();
  const key = useUserKey();
  return () =>
    Promise.all(
      ['projects', 'project', 'handoff', 'delivery', 'deal', 'deals', 'board', 'shares'].map((k) =>
        qc.invalidateQueries({ queryKey: [...key, k] }),
      ),
    );
}

export function useProjects(state?: ProjectState) {
  const key = useUserKey();
  const { read } = useProjectPermissions();
  return useQuery({
    queryKey: [...key, 'projects', state ?? 'open'],
    enabled: read,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProjectSummary[]>>(`/api/v1/projects${state ? `?state=${state}` : ''}`, {
        signal,
      }),
  });
}

export function useProject(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'project', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProjectDetail>>(`/api/v1/projects/${encodeURIComponent(id)}`, { signal }),
  });
}

export function useHandoffQueue() {
  const key = useUserKey();
  const { create } = useProjectPermissions();
  return useQuery({
    queryKey: [...key, 'handoff'],
    enabled: create,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<HandoffCandidate[]>>('/api/v1/projects/handoff-queue', { signal }),
  });
}

export function useDeliveryStaff(enabled = true) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'delivery-staff'],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<Array<{ id: string; name: string; role: Role }>>>(
        '/api/v1/projects/staff',
        {
          signal,
        },
      ),
  });
}

export function useClientOrgOptions(enabled: boolean) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'client-org-options'],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<Array<{ id: string; name: string }>>>('/api/v1/projects/client-orgs', {
        signal,
      }),
  });
}

export function useDeliveryDashboard() {
  const key = useUserKey();
  const { delivery } = useProjectPermissions();
  return useQuery({
    queryKey: [...key, 'delivery'],
    enabled: delivery,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<DeliveryDashboard>>('/api/v1/dashboard/delivery', { signal }),
  });
}

/**
 * Converts a deal with an Idempotency-Key chosen once per attempt (spec §11.6). The caller keeps
 * the key while the dialog is open, so retrying after a network error reuses it and cannot create
 * a second project.
 */
export function useConvertDeal(dealId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ input, key }: { input: ConvertDealInput; key: string }) =>
      api.post<ApiSuccess<ConvertResult>>(
        `/api/v1/deals/${encodeURIComponent(dealId)}/convert-to-project`,
        input,
        { headers: { 'Idempotency-Key': key } },
      ),
    onSettled: invalidate,
  });
}

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ProjectCreateInput) =>
      api.post<ApiSuccess<ProjectDetail>>('/api/v1/projects', input),
    onSuccess: invalidate,
  });
}

export type ProjectAction =
  | { kind: 'update'; body: ProjectUpdateInput }
  | { kind: 'state'; version: number; state: ProjectState }
  | { kind: 'add-member'; userId: string }
  | { kind: 'remove-member'; userId: string }
  | { kind: 'add-milestone'; title: string; dueOn?: string }
  | {
      kind: 'update-milestone';
      milestoneId: string;
      body: { version: number; title?: string; dueOn?: string | null; status?: MilestoneStatus };
    }
  | { kind: 'move-milestone'; milestoneId: string; direction: 'up' | 'down' }
  | { kind: 'checklist'; itemId: string; done: boolean };

export function useProjectAction(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (a: ProjectAction) => {
      const base = `/api/v1/projects/${encodeURIComponent(id)}`;
      switch (a.kind) {
        case 'update':
          return api.patch<ApiSuccess<ProjectDetail>>(base, a.body);
        case 'state':
          return api.post<ApiSuccess<ProjectDetail>>(`${base}/state`, {
            version: a.version,
            state: a.state,
          });
        case 'add-member':
          return api.post<ApiSuccess<ProjectDetail>>(`${base}/members`, { userId: a.userId });
        case 'remove-member':
          return api.post<ApiSuccess<ProjectDetail>>(
            `${base}/members/${encodeURIComponent(a.userId)}/remove`,
          );
        case 'add-milestone':
          return api.post<ApiSuccess<ProjectDetail>>(`${base}/milestones`, {
            title: a.title,
            ...(a.dueOn ? { dueOn: a.dueOn } : {}),
          });
        case 'update-milestone':
          return api.patch<ApiSuccess<ProjectDetail>>(
            `${base}/milestones/${encodeURIComponent(a.milestoneId)}`,
            a.body,
          );
        case 'move-milestone':
          return api.post<ApiSuccess<ProjectDetail>>(
            `${base}/milestones/${encodeURIComponent(a.milestoneId)}/move`,
            { direction: a.direction },
          );
        case 'checklist':
          return api.post<ApiSuccess<ProjectDetail>>(
            `${base}/checklist/${encodeURIComponent(a.itemId)}`,
            {
              done: a.done,
            },
          );
      }
    },
    onSettled: invalidate,
  });
}
