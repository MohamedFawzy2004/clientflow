import { useState, type FormEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { CommentView } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Badge, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Textarea } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useCommentAction, useCommentHistory, useComments, type ThreadRef } from './api';

function message(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'This comment changed meanwhile. It is refreshed: try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return 'Something went wrong.';
}

function History({ thread, id, onClose }: { thread: ThreadRef; id: string; onClose: () => void }) {
  const { data: user } = useSession();
  const q = useCommentHistory(thread, id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Earlier versions">
      {q.isPending ? (
        <Skeleton className="h-20" />
      ) : q.isError ? (
        <p className="text-sm text-danger">{message(q.error)}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {q.data.data.map((r, i) => (
            <li key={i} className="rounded-md bg-surface-alt px-3 py-2 text-sm">
              <span className="block text-xs text-muted">
                Replaced {formatDateTime(r.replacedAt, user?.agency.timezone)}
              </span>
              <span className="whitespace-pre-line break-words text-text">{r.body}</span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

function Comment({ c, thread }: { c: CommentView; thread: ThreadRef }) {
  const { data: user } = useSession();
  const action = useCommentAction(thread);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body ?? '');
  const [history, setHistory] = useState(false);
  // Staff see any comment's history; clients see the history of their own comments.
  const canSeeHistory = (c.editedAt || c.deleted) && (thread.projectId || c.mine);
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-text">{c.author.name}</span>
        {c.author.client ? <Badge tone="info">Client</Badge> : null}
        <span>{formatDateTime(c.createdAt, user?.agency.timezone)}</span>
        {c.editedAt && !c.deleted ? <span>· edited</span> : null}
      </p>
      {c.deleted ? (
        <p className="text-sm italic text-muted">Comment deleted.</p>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`edit-${c.id}`} className="sr-only">
            Edit your comment
          </label>
          <Textarea
            id={`edit-${c.id}`}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!text.trim()}
              loading={action.isPending}
              loadingLabel="Saving…"
              onClick={() =>
                action.mutate(
                  { kind: 'edit', id: c.id, version: c.version, body: text.trim() },
                  {
                    onSuccess: () => setEditing(false),
                    onError: (err) => toast.error(message(err)),
                  },
                )
              }
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line break-words text-sm text-text">{c.body}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {c.mine && !c.deleted && !editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit<span className="sr-only"> your comment</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(
                  { kind: 'delete', id: c.id, version: c.version },
                  { onError: (err) => toast.error(message(err)) },
                )
              }
            >
              Delete<span className="sr-only"> your comment</span>
            </Button>
          </>
        ) : null}
        {canSeeHistory ? (
          <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
            Earlier versions
          </Button>
        ) : null}
      </div>
      {history ? <History thread={thread} id={c.id} onClose={() => setHistory(false)} /> : null}
    </li>
  );
}

/**
 * The conversation on a deliverable or change (FR-X08). Staff and the client share one thread;
 * edits keep the earlier text.
 */
export function CommentsThread({
  thread,
  readOnly = false,
}: {
  thread: ThreadRef;
  readOnly?: boolean;
}) {
  const q = useComments(thread);
  const action = useCommentAction(thread);
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    action.mutate(
      { kind: 'add', body: body.trim() },
      { onSuccess: () => setBody(''), onError: (err) => toast.error(message(err)) },
    );
  };
  return (
    <Card title="Comments">
      {thread.projectId ? (
        <p className="mb-3 text-[13px] text-muted">
          The client sees this conversation once the item is shared with them.
        </p>
      ) : null}
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : q.isError ? (
        <ErrorState
          message={message(q.error)}
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
        />
      ) : q.data.data.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <MessageSquare aria-hidden className="size-4" /> No comments yet.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {q.data.data.map((c) => (
            <Comment key={c.id} c={c} thread={thread} />
          ))}
        </ol>
      )}
      {!readOnly ? (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <label
            htmlFor={`new-comment-${thread.entityId}`}
            className="text-[13px] font-medium text-text"
          >
            Add a comment
          </label>
          <Textarea
            id={`new-comment-${thread.entityId}`}
            rows={3}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={!body.trim()}
              loading={action.isPending}
              loadingLabel="Posting…"
            >
              Post comment
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
