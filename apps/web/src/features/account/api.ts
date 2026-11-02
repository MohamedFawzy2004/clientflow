import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MfaRecoveryCodes, MfaSetupStart } from '@clientflow/contracts';
import { api } from '../../lib/api';
import { SESSION_KEY } from '../auth/session';

/** Two-step sign-in for the signed-in person (ADR-069). */
export function useMfaSetup() {
  return useMutation({
    mutationFn: async (password: string) =>
      (await api.post<{ data: MfaSetupStart }>('/api/v1/auth/mfa/setup', { password })).data,
  });
}

export function useMfaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      (await api.post<{ data: MfaRecoveryCodes }>('/api/v1/auth/mfa/enable', { code })).data,
    // The session now reports two-step sign-in as on, which also lifts the setup gate.
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}

export function useMfaRegenerate() {
  return useMutation({
    mutationFn: async (input: { password: string; code: string }) =>
      (await api.post<{ data: MfaRecoveryCodes }>('/api/v1/auth/mfa/recovery-codes', input)).data,
  });
}

export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { password: string; code: string }) =>
      api.post('/api/v1/auth/mfa/disable', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}
