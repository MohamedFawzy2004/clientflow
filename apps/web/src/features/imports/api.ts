import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  type ApiSuccess,
  type ImportCommitInput,
  type ImportCommitResult,
  type ImportPreview,
  type ImportPreviewInput,
  type ImportRunView,
  type ImportUndoResult,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

/** UI hint only: the API checks `imports.run` before it even reads the file. */
export function useCanImport() {
  const { data } = useSession();
  return data ? can(data.role, 'imports.run') : false;
}

export function useImportRuns() {
  const key = useUserKey();
  const enabled = useCanImport();
  return useQuery({
    queryKey: [...key, 'imports'],
    enabled,
    queryFn: ({ signal }) => api.get<ApiSuccess<ImportRunView[]>>('/api/v1/imports', { signal }),
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (input: ImportPreviewInput) =>
      api.post<ApiSuccess<ImportPreview>>('/api/v1/imports/preview', input),
  });
}

/** Imports change contacts, deals and their lists: refresh everything the user can see. */
export function useCommitImport() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (a: { key: string; body: ImportCommitInput }) =>
      api.post<ApiSuccess<ImportCommitResult>>('/api/v1/imports', a.body, {
        headers: { 'Idempotency-Key': a.key },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUndoImport() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiSuccess<ImportUndoResult>>(`/api/v1/imports/${encodeURIComponent(id)}/undo`),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
