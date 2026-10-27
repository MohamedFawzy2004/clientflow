import { useState } from 'react';
import { ClipboardList, Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  BOARD_STATUSES,
  formatMinutes,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
  type TaskView,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import { OverdueBadge, PriorityBadge, TaskScopeBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useTaskAction, useTasks } from './api';
import { TaskDialog, TaskFormDialog } from './TaskDialog';

export function deliveryMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this just now. It is refreshed: try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Statuses offered in a card's select: the assignee never gets "Canceled". */
function statusOptions(t: TaskView, manager: boolean): TaskStatus[] {
  if (manager) return [...TASK_STATUSES];
  return t.status === 'CANCELED' ? ['CANCELED'] : [...BOARD_STATUSES];
}

function TaskCard({
  t,
  manager,
  timeZone,
  onOpen,
}: {
  t: TaskView;
  manager: boolean;
  timeZone: string;
  onOpen: () => void;
}) {
  const action = useTaskAction();
  return (
    <li className="rounded-md border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(16,36,60,0.05)]">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full break-words text-left text-sm font-medium text-text hover:text-primary-strong"
      >
        {t.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} />
        <TaskScopeBadge scope={t.scope} reference={t.change?.reference} />
        {t.overdue ? <OverdueBadge /> : null}
        {t.openBlockers.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Link2 aria-hidden className="size-3.5" />
            Waits for {t.openBlockers.length}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        {t.assignee ? t.assignee.name : 'Unassigned'}
        {t.dueOn ? ` · due ${formatDate(`${t.dueOn}T12:00:00Z`, timeZone)}` : ''}
        {t.loggedMinutes > 0 || t.estimateMinutes
          ? ` · ${formatMinutes(t.loggedMinutes)}${t.estimateMinutes ? ` of ${formatMinutes(t.estimateMinutes)}` : ''}`
          : ''}
      </p>
      {t.access.status ? (
        <div className="mt-2">
          <label htmlFor={`status-${t.id}`} className="sr-only">
            Status of {t.title}
          </label>
          <Select
            id={`status-${t.id}`}
            value={t.status}
            disabled={action.isPending}
            onChange={(e) => {
              // Read it now: the select snaps back to the saved status until the server answers.
              const next = e.target.value as TaskStatus;
              action.mutate(
                { kind: 'status', taskId: t.id, version: t.version, status: next },
                {
                  onSuccess: () =>
                    toast.success(`“${t.title}” is now ${TASK_STATUS_LABELS[next].toLowerCase()}`),
                  onError: (err) => toast.error(deliveryMessage(err)),
                },
              );
            }}
          >
            {statusOptions(t, manager).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Task board (FR-P07): one column per status. Moving a task is a status select on its card, so
 * it works with a keyboard and on a phone without drag and drop; the API checks every move.
 */
export function TaskBoardPage() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useTasks(p.id, mine);

  if (query.isPending) return <Skeleton className="h-80 rounded-lg" />;
  if (query.isError) {
    return (
      <ErrorState
        message={deliveryMessage(query.error)}
        requestId={query.error instanceof ApiError ? query.error.requestId : undefined}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const board = query.data.data;
  const manager = p.access.manage;
  const canceled = board.tasks.filter((t) => t.status === 'CANCELED');
  return (
    <section aria-labelledby="tasks-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tasks-title" className="text-lg font-semibold text-text">
          Tasks
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-primary)]"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />
            Only my tasks
          </label>
          {board.access.create ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New task
            </Button>
          ) : null}
        </div>
      </div>
      {board.tasks.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<ClipboardList aria-hidden className="size-5" />}
          title={mine ? 'Nothing assigned to you here' : 'No tasks yet'}
          description={
            board.access.create
              ? 'Break the scope into tasks and assign them to the team.'
              : 'The project manager adds tasks and assigns them.'
          }
        />
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          {BOARD_STATUSES.map((status) => {
            const items = board.tasks.filter((t) => t.status === status);
            return (
              <section
                key={status}
                aria-labelledby={`col-${status}`}
                className={cn(
                  'min-w-0 rounded-lg bg-surface-alt p-3',
                  items.length === 0 && 'pb-2',
                )}
              >
                <h3
                  id={`col-${status}`}
                  className="flex items-center justify-between text-[13px] font-semibold text-text"
                >
                  {TASK_STATUS_LABELS[status]}
                  <span className="text-xs font-medium text-muted">{items.length}</span>
                </h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {items.map((t) => (
                    <TaskCard
                      key={t.id}
                      t={t}
                      manager={manager}
                      timeZone={timeZone}
                      onOpen={() => setOpen(t.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {canceled.length > 0 ? (
        <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text">
            Canceled ({canceled.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {canceled.map((t) => (
              <TaskCard
                key={t.id}
                t={t}
                manager={manager}
                timeZone={timeZone}
                onOpen={() => setOpen(t.id)}
              />
            ))}
          </ul>
        </details>
      ) : null}
      {open ? (
        <TaskDialog
          taskId={open}
          project={p}
          assignees={board.assignees}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {creating ? (
        <TaskFormDialog
          project={p}
          assignees={board.assignees}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}
