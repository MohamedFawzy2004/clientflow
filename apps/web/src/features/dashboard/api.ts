import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  type AgencySettings,
  type AgencySettingsInput,
  type ApiSuccess,
  type DashboardQuery,
  type ReminderList,
  type SalesDashboard,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { SESSION_KEY, useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

export function toSearch(q: DashboardQuery) {
  const s = new URLSearchParams();
  if (q.from) s.set('from', q.from);
  if (q.to) s.set('to', q.to);
  if (q.ownerId) s.set('ownerId', q.ownerId);
  return s.toString();
}

export function useSalesDashboard(q: DashboardQuery) {
  const key = useUserKey();
  const { data } = useSession();
  return useQuery({
    queryKey: [...key, 'dashboard', q],
    enabled: data ? can(data.role, 'dashboard.sales') : false,
    queryFn: ({ signal }) => {
      const qs = toSearch(q);
      return api.get<ApiSuccess<SalesDashboard>>(`/api/v1/dashboard/sales${qs ? `?${qs}` : ''}`, {
        signal,
      });
    },
  });
}

export function useReminders() {
  const key = useUserKey();
  const { data } = useSession();
  return useQuery({
    queryKey: [...key, 'reminders'],
    enabled: data ? can(data.role, 'dashboard.sales') : false,
    // Reminders change as time passes, not only when records change.
    refetchInterval: 5 * 60_000,
    queryFn: ({ signal }) => api.get<ApiSuccess<ReminderList>>('/api/v1/reminders', { signal }),
  });
}

export function useAgencySettings() {
  const key = useUserKey();
  const { data } = useSession();
  return useQuery({
    queryKey: [...key, 'agency'],
    enabled: data ? can(data.role, 'agency.manage') : false,
    queryFn: ({ signal }) => api.get<ApiSuccess<AgencySettings>>('/api/v1/agency', { signal }),
  });
}

export function useUpdateAgency() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (input: AgencySettingsInput) =>
      api.patch<ApiSuccess<AgencySettings>>('/api/v1/agency', input),
    onSettled: async () => {
      // Name, currency and timezone also live in the session shown everywhere.
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      await qc.invalidateQueries({ queryKey: key });
    },
  });
}
