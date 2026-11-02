import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccess,
  ChangeCreateInput,
  ChangeDecisionInput,
  ChangeDetail,
  ChangeDraftInput,
  ChangeSummary,
  CommentEntityType,
  CommentRevisionView,
  CommentView,
  PortalChangeDetail,
  PortalChangeSummary,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

const enc = encodeURIComponent;

function useUserKey() {
  const { data } = useSession();
  return ['u', data?.id ?? 'anon'] as const;
}

// ---------------------------------------------------------------------------
// Staff: change requests
// ---------------------------------------------------------------------------

export function useChanges(projectId: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'changes', projectId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<{ changes: ChangeSummary[]; access: { create: boolean } }>>(
        `/api/v1/projects/${enc(projectId)}/changes`,
        { signal },
      ),
  });
}

export function useChange(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'change', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ChangeDetail>>(`/api/v1/changes/${enc(id)}`, { signal }),
  });
}

export type ChangeAction =
  | { kind: 'create'; projectId: string; body: ChangeCreateInput }
  | { kind: 'draft'; id: string; body: ChangeDraftInput }
  | { kind: 'submit' | 'send'; id: string; version: number }
  | {
      kind: 'review';
      id: string;
      version: number;
      decision: 'APPROVE' | 'RETURN';
      comment?: string;
    }
  | { kind: 'withdraw'; id: string; version: number; reason: string };

/** Every change action can move the budget, tasks and history: refresh the project data too. */
export function useChangeAction() {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (a: ChangeAction) => {
      switch (a.kind) {
        case 'create':
          return api.post<ApiSuccess<ChangeDetail>>(
            `/api/v1/projects/${enc(a.projectId)}/changes`,
            a.body,
          );
        case 'draft':
          return api.put<ApiSuccess<ChangeDetail>>(`/api/v1/changes/${enc(a.id)}/draft`, a.body);
        case 'submit':
        case 'send':
          return api.post<ApiSuccess<ChangeDetail>>(`/api/v1/changes/${enc(a.id)}/${a.kind}`, {
            version: a.version,
          });
        case 'review':
          return api.post<ApiSuccess<ChangeDetail>>(`/api/v1/changes/${enc(a.id)}/review`, {
            version: a.version,
            decision: a.decision,
            ...(a.comment ? { comment: a.comment } : {}),
          });
        case 'withdraw':
          return api.post<ApiSuccess<ChangeDetail>>(`/api/v1/changes/${enc(a.id)}/withdraw`, {
            version: a.version,
            reason: a.reason,
          });
      }
    },
    onSettled: () =>
      Promise.all(
        ['changes', 'change', 'project', 'tasks'].map((k) =>
          qc.invalidateQueries({ queryKey: [...key, k] }),
        ),
      ),
  });
}

// ---------------------------------------------------------------------------
// Portal: change requests
// ---------------------------------------------------------------------------

export function usePortalChanges(projectId: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'portal', 'changes', projectId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalChangeSummary[]>>(
        `/api/v1/portal/projects/${enc(projectId)}/changes`,
        { signal },
      ),
  });
}

export function usePortalChange(id: string) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'portal', 'change', id],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<PortalChangeDetail>>(`/api/v1/portal/changes/${enc(id)}`, { signal }),
  });
}

export function useRequestChange(projectId: string) {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (body: ChangeCreateInput) =>
      api.post<ApiSuccess<PortalChangeDetail>>(
        `/api/v1/portal/projects/${enc(projectId)}/changes`,
        body,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: [...key, 'portal'] }),
  });
}

export function useChangeDecision(id: string) {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (input: ChangeDecisionInput) =>
      api.post<ApiSuccess<PortalChangeDetail>>(`/api/v1/portal/changes/${enc(id)}/decision`, input),
    // A 409 (updated meanwhile, already decided) means our copy is out of date: reload either way.
    onSettled: () => qc.invalidateQueries({ queryKey: [...key, 'portal'] }),
  });
}

// ---------------------------------------------------------------------------
// Comments: one thread per deliverable or change, for staff (project path) and portal
// ---------------------------------------------------------------------------

export interface ThreadRef {
  entityType: CommentEntityType;
  entityId: string;
  /** Set for staff (the project the item belongs to); omitted in the portal. */
  projectId?: string;
}

function base(t: ThreadRef) {
  return t.projectId ? `/api/v1/projects/${enc(t.projectId)}/comments` : '/api/v1/portal/comments';
}
function one(t: ThreadRef, id: string) {
  return t.projectId ? `/api/v1/comments/${enc(id)}` : `/api/v1/portal/comments/${enc(id)}`;
}

export function useComments(t: ThreadRef) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'comments', t.entityType, t.entityId],
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<CommentView[]>>(
        `${base(t)}?entityType=${t.entityType}&entityId=${enc(t.entityId)}`,
        { signal },
      ),
  });
}

export function useCommentHistory(t: ThreadRef, id: string | null) {
  const key = useUserKey();
  return useQuery({
    queryKey: [...key, 'comment-history', id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<CommentRevisionView[]>>(`${one(t, id!)}/history`, { signal }),
  });
}

export type CommentAction =
  | { kind: 'add'; body: string }
  | { kind: 'edit'; id: string; version: number; body: string }
  | { kind: 'delete'; id: string; version: number };

export function useCommentAction(t: ThreadRef) {
  const qc = useQueryClient();
  const key = useUserKey();
  return useMutation({
    mutationFn: (a: CommentAction) => {
      switch (a.kind) {
        case 'add':
          return api.post<ApiSuccess<CommentView>>(base(t), {
            entityType: t.entityType,
            entityId: t.entityId,
            body: a.body,
          });
        case 'edit':
          return api.patch<ApiSuccess<CommentView>>(one(t, a.id), {
            version: a.version,
            body: a.body,
          });
        case 'delete':
          return api.post<ApiSuccess<CommentView>>(`${one(t, a.id)}/delete`, {
            version: a.version,
          });
      }
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [...key, 'comments', t.entityType, t.entityId] }),
        qc.invalidateQueries({ queryKey: [...key, 'comment-history'] }),
      ]),
  });
}
