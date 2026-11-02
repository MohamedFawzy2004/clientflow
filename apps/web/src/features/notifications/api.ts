import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  type ApiSuccess,
  type JobSummary,
  type NotificationPage,
  type NotificationPreferencesInput,
  type NotificationPreferenceView,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

/** UI hint only: the API checks `notifications.read` on every request. */
export function useCanNotify() {
  const { data } = useSession();
  return data ? can(data.role, 'notifications.read') : false;
}

/** The bell's count. Polled, and refreshed when the window regains focus. */
export function useUnreadCount() {
  const key = useUserKey();
  const enabled = useCanNotify();
  return useQuery({
    queryKey: [...key, 'notifications', 'count'],
    enabled,
    refetchInterval: 60_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<{ count: number }>>('/api/v1/notifications/unread-count', { signal }),
  });
}

export function useNotifications(unread: boolean) {
  const key = useUserKey();
  const enabled = useCanNotify();
  return useInfiniteQuery({
    queryKey: [...key, 'notifications', 'list', unread],
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (last: ApiSuccess<NotificationPage>) => last.data.nextCursor,
    queryFn: ({ signal, pageParam }) => {
      const qs = new URLSearchParams({ limit: '20' });
      if (unread) qs.set('unread', 'true');
      if (pageParam) qs.set('before', pageParam);
      return api.get<ApiSuccess<NotificationPage>>(`/api/v1/notifications?${qs}`, { signal });
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (a: { id: string } | { all: true; upTo: string }) =>
      'id' in a
        ? api.patch(`/api/v1/notifications/${encodeURIComponent(a.id)}/read`)
        : api.post('/api/v1/notifications/read-all', { upTo: a.upTo }),
    onSettled: () => qc.invalidateQueries({ queryKey: [...key, 'notifications'] }),
  });
}

export function usePreferences() {
  const key = useUserKey();
  const enabled = useCanNotify();
  return useQuery({
    queryKey: [...key, 'notification-preferences'],
    enabled,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<NotificationPreferenceView[]>>('/api/v1/notification-preferences', {
        signal,
      }),
  });
}

export function useSavePreferences() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (input: NotificationPreferencesInput) =>
      api.put<ApiSuccess<NotificationPreferenceView[]>>('/api/v1/notification-preferences', input),
    onSuccess: (res) => qc.setQueryData([...key, 'notification-preferences'], res),
  });
}

export function useJobs(enabled: boolean) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'jobs'],
    enabled,
    queryFn: ({ signal }) => api.get<ApiSuccess<JobSummary>>('/api/v1/jobs', { signal }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiSuccess<JobSummary>>(`/api/v1/jobs/${encodeURIComponent(id)}/retry`),
    onSuccess: (res) => qc.setQueryData([...key, 'jobs'], res),
  });
}
