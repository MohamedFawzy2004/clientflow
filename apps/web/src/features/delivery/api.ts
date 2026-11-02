import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccess,
  DeliverableCreateInput,
  DeliverableDetail,
  DeliverableSummary,
  DeliverableUpdateInput,
  DownloadLink,
  FileList,
  FileView,
  ProjectShares,
  ProjectTime,
  TaskBoard,
  TaskCreateInput,
  TaskDetail,
  TaskStatus,
  TaskUpdateInput,
  TimeEntryCreateInput,
  TimeEntryUpdateInput,
  TimeEntryView,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

const enc = encodeURIComponent;

/** Delivery data changes the project page, the board, files, time and the dashboard together. */
function useInvalidate() {
  const qc = useQueryClient();
  const key = useUserKey();
  return () =>
    Promise.all(
      [
        'project',
        'tasks',
        'task',
        'time',
        'files',
        'deliverables',
        'deliverable',
        'delivery',
        'shares',
      ].map((k) => qc.invalidateQueries({ queryKey: [...key, k] })),
    );
}

// ---------------------------------------------------------------------------
// Tasks and time
// ---------------------------------------------------------------------------

export function useTasks(projectId: string, mine = false) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'tasks', projectId, mine ? 'mine' : 'all'],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<TaskBoard>>(
        `/api/v1/projects/${enc(projectId)}/tasks${mine ? '?assignee=me' : ''}`,
        { signal },
      ),
  });
}

export function useTask(taskId: string | null) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'task', taskId],
    enabled: taskId !== null,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<TaskDetail>>(`/api/v1/tasks/${enc(taskId!)}`, { signal }),
  });
}

export type TaskAction =
  | { kind: 'create'; projectId: string; body: TaskCreateInput }
  | { kind: 'update'; taskId: string; body: TaskUpdateInput }
  | { kind: 'status'; taskId: string; version: number; status: TaskStatus }
  | { kind: 'depend'; taskId: string; dependsOnId: string }
  | { kind: 'undepend'; taskId: string; dependsOnId: string }
  | { kind: 'log'; taskId: string; body: TimeEntryCreateInput }
  | { kind: 'edit-entry'; entryId: string; body: TimeEntryUpdateInput }
  | { kind: 'delete-entry'; entryId: string };

export function useTaskAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (a: TaskAction): Promise<unknown> => {
      switch (a.kind) {
        case 'create':
          return api.post<ApiSuccess<TaskDetail>>(
            `/api/v1/projects/${enc(a.projectId)}/tasks`,
            a.body,
          );
        case 'update':
          return api.patch<ApiSuccess<TaskDetail>>(`/api/v1/tasks/${enc(a.taskId)}`, a.body);
        case 'status':
          return api.post<ApiSuccess<TaskDetail>>(`/api/v1/tasks/${enc(a.taskId)}/status`, {
            version: a.version,
            status: a.status,
          });
        case 'depend':
          return api.post(`/api/v1/tasks/${enc(a.taskId)}/dependencies`, {
            dependsOnId: a.dependsOnId,
          });
        case 'undepend':
          return api.post(
            `/api/v1/tasks/${enc(a.taskId)}/dependencies/${enc(a.dependsOnId)}/remove`,
          );
        case 'log':
          return api.post<ApiSuccess<TimeEntryView>>(`/api/v1/tasks/${enc(a.taskId)}/time`, a.body);
        case 'edit-entry':
          return api.patch(`/api/v1/time-entries/${enc(a.entryId)}`, a.body);
        case 'delete-entry':
          return api.post(`/api/v1/time-entries/${enc(a.entryId)}/delete`);
      }
    },
    onSettled: invalidate,
  });
}

export function useProjectTime(projectId: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'time', projectId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProjectTime>>(`/api/v1/projects/${enc(projectId)}/time`, { signal }),
  });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function useFiles(projectId: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'files', projectId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<FileList>>(`/api/v1/projects/${enc(projectId)}/files`, { signal }),
  });
}

export function useUpload(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (file: File) =>
      api.upload<ApiSuccess<FileView>>(`/api/v1/projects/${enc(projectId)}/files`, file),
    onSettled: invalidate,
  });
}

export function useDeleteFile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (fileId: string) => api.post(`/api/v1/files/${enc(fileId)}/delete`),
    onSettled: invalidate,
  });
}

/**
 * Asks for a short-lived link and starts the download (SEC-13). The link is bound to this user
 * and expires in minutes, so it is used at once and never stored.
 */
export async function downloadFile(fileId: string, portal = false) {
  const res = await api.post<ApiSuccess<DownloadLink>>(
    `/api/v1/${portal ? 'portal/' : ''}files/${enc(fileId)}/download-url`,
  );
  const a = document.createElement('a');
  a.href = res.data.url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Deliverables and sharing
// ---------------------------------------------------------------------------

export function useDeliverables(projectId: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'deliverables', projectId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<{ deliverables: DeliverableSummary[]; access: { create: boolean } }>>(
        `/api/v1/projects/${enc(projectId)}/deliverables`,
        { signal },
      ),
  });
}

export function useDeliverable(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'deliverable', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<DeliverableDetail>>(`/api/v1/deliverables/${enc(id)}`, { signal }),
  });
}

export type DeliverableAction =
  | { kind: 'create'; projectId: string; body: DeliverableCreateInput }
  | { kind: 'update'; id: string; body: DeliverableUpdateInput }
  | { kind: 'version'; id: string; fileId: string; note?: string }
  | { kind: 'publish'; id: string; version: number }
  | { kind: 'archive'; id: string; version: number };

export function useDeliverableAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (a: DeliverableAction) => {
      switch (a.kind) {
        case 'create':
          return api.post<ApiSuccess<DeliverableDetail>>(
            `/api/v1/projects/${enc(a.projectId)}/deliverables`,
            a.body,
          );
        case 'update':
          return api.patch<ApiSuccess<DeliverableDetail>>(
            `/api/v1/deliverables/${enc(a.id)}`,
            a.body,
          );
        case 'version':
          return api.post<ApiSuccess<DeliverableDetail>>(
            `/api/v1/deliverables/${enc(a.id)}/versions`,
            {
              fileId: a.fileId,
              ...(a.note ? { note: a.note } : {}),
            },
          );
        case 'publish':
          return api.post<ApiSuccess<DeliverableDetail>>(
            `/api/v1/deliverables/${enc(a.id)}/publish`,
            {
              version: a.version,
            },
          );
        case 'archive':
          return api.post<ApiSuccess<DeliverableDetail>>(
            `/api/v1/deliverables/${enc(a.id)}/archive`,
            {
              version: a.version,
            },
          );
      }
    },
    onSettled: invalidate,
  });
}

export function useShares(projectId: string, enabled: boolean) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'shares', projectId],
    enabled,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProjectShares>>(`/api/v1/projects/${enc(projectId)}/shares`, { signal }),
  });
}

export function useShareAction(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ userId, share }: { userId: string; share: boolean }) =>
      share
        ? api.post<ApiSuccess<ProjectShares>>(`/api/v1/projects/${enc(projectId)}/shares`, {
            userId,
          })
        : api.post<ApiSuccess<ProjectShares>>(
            `/api/v1/projects/${enc(projectId)}/shares/${enc(userId)}/revoke`,
          ),
    onSettled: invalidate,
  });
}
