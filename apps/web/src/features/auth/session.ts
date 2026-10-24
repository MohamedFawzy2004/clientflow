import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, LoginResponse, SessionUser } from '@clientflow/contracts';
import { api, ApiError, setCsrfToken } from '../../lib/api';

export const SESSION_KEY = ['session'] as const;

/** Current user, or null when signed out. The cookie is HttpOnly, so the API is asked. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const res = await api.get<{ data: SessionUser }>('/api/v1/auth/me', {
          skipAuthRedirect: true,
        });
        return res.data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      // Signed out: the CSRF endpoint issues a pre-session token bound to a cookie.
      setCsrfToken(null);
      const res = await api.post<{ data: LoginResponse }>('/api/v1/auth/login', input, {
        skipAuthRedirect: true,
      });
      return res.data;
    },
    onSuccess: (data) => {
      // Previous user's cached data must never be shown to the next user (spec §11.4).
      qc.clear();
      setCsrfToken(data.csrfToken);
      qc.setQueryData(SESSION_KEY, data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/auth/logout', undefined, { skipAuthRedirect: true }),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(SESSION_KEY, null);
    },
  });
}
