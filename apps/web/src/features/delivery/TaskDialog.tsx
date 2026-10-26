import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  formatMinutes,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type ProjectDetail,
  type TaskDetail,
  type TaskPriority,
} from '@clientflow/contracts';
import { formatDay, todayIn } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import {
  OverdueBadge,
  PriorityBadge,
  TaskStatusBadge,
} from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useTask, useTaskAction, useTasks } from './api';
import { deliveryMessage } from './TaskBoardPage';

type Person = { id: string; name: string };

/** "1.5" hours → 90 minutes. Empty → null. Returns undefined when it is not a number. */
function hoursToMinutes(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t.replace(',', '.')) * 60);
}

/** New task, or edit of an existing one (project manager, Owner or Admin). */
export function TaskFormDialog({
  project,
  assignees,
  task,
  onClose,
}: {
  project: ProjectDetail;
  assignees: Person[];
  task?: TaskDetail;
  onClose: () => void;
}) {
  const action = useTaskAction();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? '');
  const [milestoneId, setMilestoneId] = useState(task?.milestone?.id ?? '');
  const [dueOn, setDueOn] = useState(task?.dueOn ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [estimate, setEstimate] = useState(
    task?.estimateMinutes ? String(task.estimateMinutes / 60) : '',
  );
  const [touched, setTouched] = useState(false);
  const estimateMinutes = hoursToMinutes(estimate);
  const titleError = touched && !title.trim() ? 'Give the task a name.' : undefined;
  const estimateError = estimateMinutes === undefined ? 'Use hours, e.g. 4 or 1.5.' : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || estimateMinutes === undefined) return;
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      assigneeId: assigneeId || null,
      milestoneId: milestoneId || null,
      dueOn: dueOn || null,
      priority,
      estimateMinutes,
    };
    action.mutate(
      task
        ? { kind: 'update', taskId: task.id, body: { version: task.version, ...fields } }
        : { kind: 'create', projectId: project.id, body: fields },
      {
        onSuccess: () => {
          toast.success(task ? 'Task updated' : 'Task added');
          onClose();
        },
      },
    );
  };
  const fieldErrors = action.error ? deliveryMessage(action.error) : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title={task ? 'Edit task' : 'New task'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={action.isPending} loadingLabel="Saving…">
            {task ? 'Save' : 'Add task'}
          </Button>
        </>
      }
    >
      {fieldErrors ? (
        <Banner tone="danger" title="Not saved" className="mb-5">
          {fieldErrors}
        </Banner>
      ) : null}
      <form id="task-form" onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Task" required error={titleError} className="sm:col-span-2">
          {(fp) => (
            <Input
              {...fp}
              data-autofocus
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Assignee">
          {(fp) => (
            <Select {...fp} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Milestone">
          {(fp) => (
            <Select {...fp} value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
              <option value="">None</option>
              {project.milestoneList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due">
          {(fp) => (
            <Input {...fp} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          )}
        </Field>
        <Field label="Priority" required>
          {(fp) => (
            <Select
              {...fp}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Estimate (hours)" error={estimateError} hint="For example 4 or 1.5.">
          {(fp) => (
            <Input
              {...fp}
              inputMode="decimal"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Details"
          className="sm:col-span-2"
          hint="Internal: never shown to the client."
        >
          {(fp) => (
            <Textarea
              {...fp}
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function LogTime({ task }: { task: TaskDetail }) {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const action = useTaskAction();
  const [workedOn, setWorkedOn] = useState(todayIn(timeZone));
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState('');
  const total = Number(hours || 0) * 60 + Number(mins || 0);
  const valid = Number.isInteger(total) && total >= 1 && total <= 1440;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    action.mutate(
      {
        kind: 'log',
        taskId: task.id,
        body: { workedOn, minutes: total, billable, note: note.trim() || null },
      },
      {
        onSuccess: () => {
          setHours('');
          setMins('');
          setNote('');
          toast.success(`Logged ${formatMinutes(total)}`);
        },
        onError: (err) => toast.error(deliveryMessage(err)),
      },
    );
  };
  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-4 grid gap-3 rounded-md border border-border p-3 sm:grid-cols-4"
    >
      <p className="text-[13px] font-semibold text-text sm:col-span-4">Log your time</p>
      <div className="sm:col-span-2">
        <label htmlFor="log-date" className="text-[13px] font-medium text-text">
          Date
        </label>
        <Input
          id="log-date"
          type="date"
          className="mt-1.5"
          max={todayIn(timeZone)}
          value={workedOn}
          onChange={(e) => setWorkedOn(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="log-hours" className="text-[13px] font-medium text-text">
          Hours
        </label>
        <Input
          id="log-hours"
          className="mt-1.5"
          inputMode="numeric"
          value={hours}
          onChange={(e) => setHours(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
      </div>
      <div>
        <label htmlFor="log-mins" className="text-[13px] font-medium text-text">
          Minutes
        </label>
        <Input
          id="log-mins"
          className="mt-1.5"
          inputMode="numeric"
          value={mins}
          onChange={(e) => setMins(e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
      </div>
      <div className="sm:col-span-4">
        <label htmlFor="log-note" className="text-[13px] font-medium text-text">
          Internal note <span className="font-normal text-muted">(optional)</span>
        </label>
        <Input
          id="log-note"
          className="mt-1.5"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={billable}
          onChange={(e) => setBillable(e.target.checked)}
        />
        Billable
      </label>
      <div className="sm:col-span-2 sm:text-right">
        <Button
          type="submit"
          variant="secondary"
          disabled={!valid}
          loading={action.isPending}
          loadingLabel="Logging…"
        >
          Log time
        </Button>
      </div>
    </form>
  );
}

/** Task details: status, fields, dependencies and time. */
export function TaskDialog({
  taskId,
  project,
  assignees,
  onClose,
}: {
  taskId: string;
  project: ProjectDetail;
  assignees: Person[];
  onClose: () => void;
}) {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useTask(taskId);
  const action = useTaskAction();
  const [editing, setEditing] = useState(false);
  const [dep, setDep] = useState('');
  const t = query.data?.data;
  const others = useOtherTasks(project.id, t);

  if (editing && t) {
    return (
      <TaskFormDialog
        project={project}
        assignees={assignees}
        task={t}
        onClose={() => setEditing(false)}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t?.title ?? 'Task'}
      className="sm:w-[min(680px,calc(100vw-32px))]"
      footer={
        <>
          {t?.access.edit ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit task
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {query.isPending ? (
        <Skeleton className="h-48" />
      ) : query.isError || !t ? (
        <ErrorState
          message={deliveryMessage(query.error)}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.overdue ? <OverdueBadge /> : null}
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Assignee</dt>
              <dd className="text-text">{t.assignee?.name ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Milestone</dt>
              <dd className="text-text">{t.milestone?.title ?? 'None'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Due</dt>
              <dd className="text-text">{t.dueOn ? formatDay(t.dueOn, timeZone) : 'No date'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Time</dt>
              <dd className="text-text">
                {formatMinutes(t.loggedMinutes)} logged
                {t.estimateMinutes ? ` of ${formatMinutes(t.estimateMinutes)} estimated` : ''}
              </dd>
            </div>
          </dl>
          {t.description ? (
            <p className="whitespace-pre-line break-words text-sm leading-6 text-text">
              {t.description}
            </p>
          ) : null}

          <section aria-labelledby="deps-title">
            <h3 id="deps-title" className="text-[13px] font-semibold text-text">
              Waits for
            </h3>
            {t.blockedBy.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Nothing. It can be done at any time.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {t.blockedBy.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-text">{b.title}</span>
                      <TaskStatusBadge status={b.status} />
                    </span>
                    {t.access.edit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate(
                            { kind: 'undepend', taskId: t.id, dependsOnId: b.id },
                            { onError: (err) => toast.error(deliveryMessage(err)) },
                          )
                        }
                      >
                        Remove<span className="sr-only"> dependency on {b.title}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {t.access.edit && others.length > 0 ? (
              <div className="mt-3 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="add-dep" className="text-[13px] font-medium text-text">
                    Add a task it waits for
                  </label>
                  <Select
                    id="add-dep"
                    className="mt-1.5"
                    value={dep}
                    onChange={(e) => setDep(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant="secondary"
                  disabled={!dep || action.isPending}
                  onClick={() =>
                    action.mutate(
                      { kind: 'depend', taskId: t.id, dependsOnId: dep },
                      {
                        onSuccess: () => setDep(''),
                        onError: (err) => toast.error(deliveryMessage(err)),
                      },
                    )
                  }
                >
                  Add
                </Button>
              </div>
            ) : null}
            {t.blocking.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                Other tasks waiting for this one: {t.blocking.map((b) => b.title).join(', ')}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="time-title">
            <h3 id="time-title" className="text-[13px] font-semibold text-text">
              {project.access.manage ? 'Time logged' : 'Your time on this task'}
            </h3>
            {t.timeEntries.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No time logged yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-border">
                {t.timeEntries.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="text-text">
                        {formatMinutes(e.minutes)} · {formatDay(e.workedOn, timeZone)}
                        {e.billable ? '' : ' · not billable'}
                      </span>
                      <span className="block text-xs text-muted">
                        {e.user.name}
                        {e.note ? ` · ${e.note}` : ''}
                      </span>
                    </span>
                    {e.mine && t.access.logTime ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate(
                            { kind: 'delete-entry', entryId: e.id },
                            {
                              onSuccess: () => toast.success('Time entry deleted'),
                              onError: (err) => toast.error(deliveryMessage(err)),
                            },
                          )
                        }
                      >
                        Delete<span className="sr-only"> entry of {formatMinutes(e.minutes)}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {t.access.logTime ? <LogTime task={t} /> : null}
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** Tasks of the same project this task could wait for (the API refuses loops). */
function useOtherTasks(projectId: string, t: TaskDetail | undefined) {
  const board = useTasks(projectId, false);
  if (!t?.access.edit) return [];
  const linked = new Set([t.id, ...t.blockedBy.map((b) => b.id)]);
  return (board.data?.data.tasks ?? []).filter((x) => !linked.has(x.id) && x.status !== 'CANCELED');
}
