import { useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  canAny,
  formatMoney,
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABELS,
  type MilestoneStatus,
  type ProjectDetail,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { Money, Timeline } from '../../components/sales/sales-ui';
import { Card } from '../../components/proposals/proposal-ui';
import { MilestoneStatusBadge } from '../../components/projects/project-ui';
import { useSession } from '../auth/session';
import { PortalAccessCard } from '../delivery/PortalAccessCard';
import { useFinancePermissions } from '../invoices/api';
import { ProjectMoney } from '../invoices/ProjectMoney';
import { useClientOrgOptions, useDeliveryStaff, useProjectAction } from './api';

export function projectMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this project. The page is refreshed: try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}
const message = projectMessage;

/** The project the layout loaded, shared with every tab. */
export function useProjectContext() {
  return useOutletContext<{ project: ProjectDetail }>().project;
}

function Text({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</h3>
      <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-text">{text}</p>
    </div>
  );
}

/** Accepted changes on top of the original scope, with the budget before and now (US-12). */
function ScopeChanges({ p, timeZone }: { p: ProjectDetail; timeZone: string }) {
  const h = p.scopeHistory;
  if (h.changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        Accepted changes
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {h.changes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to={`/app/projects/${p.id}/changes/${c.id}`}
              className="min-w-0 break-words font-medium text-primary-strong hover:underline"
            >
              {c.reference} {c.title}
            </Link>
            <span className="text-muted">
              +<Money minor={c.priceMinor} currency={h.currency} /> · accepted{' '}
              {formatDateTime(c.acceptedAt, timeZone)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-text">
        Budget <Money minor={h.originalBudgetMinor} currency={h.currency} /> originally, now{' '}
        <Money minor={h.currentBudgetMinor} currency={h.currency} className="font-semibold" />{' '}
        excluding tax.
      </p>
    </div>
  );
}

function Baseline({ p, timeZone }: { p: ProjectDetail; timeZone: string }) {
  const { data: user } = useSession();
  const b = p.baseline;
  if (!b) {
    return (
      <Card title="Scope baseline">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Created without a deal, so there is no accepted proposal behind it.
          </p>
          <ScopeChanges p={p} timeZone={timeZone} />
        </div>
      </Card>
    );
  }
  const canOpen = user ? canAny(user.role, ['proposals.read.all', 'proposals.read.own']) : false;
  const ref = `${b.reference} version ${b.versionNo}`;
  return (
    <Card title="Scope baseline">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          The agreed scope is{' '}
          {canOpen ? (
            <Link
              to={`/app/proposals/${b.proposalId}`}
              className="font-medium text-primary-strong hover:underline"
            >
              {ref}
            </Link>
          ) : (
            <span className="font-medium text-text">{ref}</span>
          )}
          {b.acceptedBy && b.acceptedAt
            ? `, accepted by ${b.acceptedBy} on ${formatDateTime(b.acceptedAt, timeZone)}`
            : ''}
          . It never changes: extra scope goes through change requests the client accepts.
        </p>
        <ScopeChanges p={p} timeZone={timeZone} />
        <Text label="Summary" text={b.summary} />
        <div className="grid gap-5 md:grid-cols-2">
          <Text label="Included" text={b.inclusions} />
          <Text label="Not included" text={b.exclusions} />
          <Text label="Assumptions" text={b.assumptions} />
          <Text label="Payment terms" text={b.paymentTerms} />
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {b.items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block break-words font-medium text-text">{i.name}</span>
                <span className="text-xs text-muted">
                  {i.quantity} {i.unit} × {formatMoney(i.unitPriceMinor, b.currency)}
                </span>
              </span>
              <Money minor={i.lineTotalMinor} currency={b.currency} />
            </li>
          ))}
        </ul>
        <p className="text-sm text-text">
          Accepted total{' '}
          <Money minor={b.totalMinor} currency={b.currency} className="font-semibold" /> including
          tax. Budget baseline{' '}
          <Money minor={p.budgetMinor} currency={p.currency} className="font-semibold" /> excluding
          tax.
        </p>
      </div>
    </Card>
  );
}

function Milestones({ p, manage }: { p: ProjectDetail; manage: boolean }) {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const action = useProjectAction(p.id);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    action.mutate(
      { kind: 'add-milestone', title: title.trim(), ...(dueOn ? { dueOn } : {}) },
      {
        onSuccess: () => {
          setTitle('');
          setDueOn('');
          toast.success('Milestone added');
        },
        onError: (err) => toast.error(message(err)),
      },
    );
  };
  const move = (milestoneId: string, direction: 'up' | 'down') =>
    action.mutate(
      { kind: 'move-milestone', milestoneId, direction },
      { onError: (err) => toast.error(message(err)) },
    );
  return (
    <Card title={`Milestones (${p.milestones.done}/${p.milestones.total} done)`}>
      {p.milestoneList.length === 0 ? (
        <p className="text-sm text-muted">No milestones yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {p.milestoneList.map((m, i) => (
            <li
              key={m.id}
              className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-text">{m.title}</p>
                <p className="text-xs text-muted">
                  {m.dueOn ? `Due ${formatDate(`${m.dueOn}T12:00:00Z`, timeZone)}` : 'No date'}
                </p>
              </div>
              {manage ? (
                <div className="flex items-center gap-2">
                  <div className="w-full sm:w-40">
                    <label htmlFor={`ms-${m.id}`} className="sr-only">
                      Status of {m.title}
                    </label>
                    <Select
                      id={`ms-${m.id}`}
                      value={m.status}
                      disabled={action.isPending}
                      onChange={(e) =>
                        action.mutate(
                          {
                            kind: 'update-milestone',
                            milestoneId: m.id,
                            body: { version: m.version, status: e.target.value as MilestoneStatus },
                          },
                          { onError: (err) => toast.error(message(err)) },
                        )
                      }
                    >
                      {MILESTONE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {MILESTONE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-10 px-0"
                    aria-label={`Move ${m.title} up`}
                    disabled={i === 0 || action.isPending}
                    onClick={() => move(m.id, 'up')}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-10 px-0"
                    aria-label={`Move ${m.title} down`}
                    disabled={i === p.milestoneList.length - 1 || action.isPending}
                    onClick={() => move(m.id, 'down')}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                </div>
              ) : (
                <MilestoneStatusBadge status={m.status} />
              )}
            </li>
          ))}
        </ol>
      )}
      {manage ? (
        <form
          onSubmit={add}
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="new-ms" className="text-[13px] font-medium text-text">
              New milestone
            </label>
            <Input
              id="new-ms"
              className="mt-1.5"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="sm:w-44">
            <label htmlFor="new-ms-due" className="text-[13px] font-medium text-text">
              Target date
            </label>
            <Input
              id="new-ms-due"
              type="date"
              className="mt-1.5"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!title.trim()}
            loading={action.isPending}
            loadingLabel="Adding…"
          >
            Add
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function Checklist({ p, manage }: { p: ProjectDetail; manage: boolean }) {
  const { data: user } = useSession();
  const action = useProjectAction(p.id);
  return (
    <Card title="Handoff checklist">
      <ul className="flex flex-col gap-3">
        {p.checklist.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2.5 text-sm text-text">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
                checked={c.done}
                disabled={!manage || action.isPending}
                onChange={(e) =>
                  action.mutate(
                    { kind: 'checklist', itemId: c.id, done: e.target.checked },
                    { onError: (err) => toast.error(message(err)) },
                  )
                }
              />
              <span>
                <span className={c.done ? 'text-muted line-through' : ''}>{c.label}</span>
                {c.done && c.doneBy && c.doneAt ? (
                  <span className="block text-xs text-muted">
                    {c.doneBy.name}, {formatDateTime(c.doneAt, user?.agency.timezone)}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Team({ p, manage }: { p: ProjectDetail; manage: boolean }) {
  const staff = useDeliveryStaff(manage);
  const action = useProjectAction(p.id);
  const [pick, setPick] = useState('');
  const choices = (staff.data?.data ?? []).filter(
    (u) => u.id !== p.manager.id && !p.members.some((m) => m.id === u.id),
  );
  return (
    <Card title="Team">
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-center justify-between gap-2">
          <span className="font-medium text-text">{p.manager.name}</span>
          <span className="text-xs text-muted">Project manager</span>
        </li>
        {p.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span className="text-text">{m.name}</span>
            {manage ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() =>
                  action.mutate(
                    { kind: 'remove-member', userId: m.id },
                    { onError: (err) => toast.error(message(err)) },
                  )
                }
              >
                Remove<span className="sr-only"> {m.name}</span>
              </Button>
            ) : (
              <span className="text-xs text-muted">Member</span>
            )}
          </li>
        ))}
      </ul>
      {manage && choices.length > 0 ? (
        <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="add-member" className="text-[13px] font-medium text-text">
              Add someone
            </label>
            <Select
              id="add-member"
              className="mt-1.5"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Choose…</option>
              {choices.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            disabled={!pick}
            onClick={() =>
              action.mutate(
                { kind: 'add-member', userId: pick },
                { onSuccess: () => setPick(''), onError: (err) => toast.error(message(err)) },
              )
            }
          >
            Add
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function EditProjectDialog({ p, onClose }: { p: ProjectDetail; onClose: () => void }) {
  const action = useProjectAction(p.id);
  // A handed-off project keeps the proposal's client; manual projects can be linked to one.
  const orgs = useClientOrgOptions(!p.fromDeal);
  const [title, setTitle] = useState(p.title);
  const [startOn, setStartOn] = useState(p.startOn ?? '');
  const [dueOn, setDueOn] = useState(p.dueOn ?? '');
  const [clientOrgId, setClientOrgId] = useState(p.clientOrg?.id ?? '');
  const orgChanged = clientOrgId !== (p.clientOrg?.id ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(
      {
        kind: 'update',
        body: {
          version: p.version,
          title: title.trim(),
          startOn: startOn || null,
          dueOn: dueOn || null,
          ...(orgChanged ? { clientOrgId: clientOrgId || null } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Project updated');
          onClose();
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !action.isPending && onClose()}
      title="Edit project"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-project"
            loading={action.isPending}
            loadingLabel="Saving…"
          >
            Save
          </Button>
        </>
      }
    >
      {action.error ? (
        <Banner tone="danger" title="Not saved" className="mb-5">
          {message(action.error)}
        </Banner>
      ) : null}
      <form id="edit-project" onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Project name" required className="sm:col-span-2">
          {(fp) => (
            <Input
              {...fp}
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Start">
          {(fp) => (
            <Input
              {...fp}
              type="date"
              value={startOn}
              onChange={(e) => setStartOn(e.target.value)}
            />
          )}
        </Field>
        <Field label="Due">
          {(fp) => (
            <Input {...fp} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          )}
        </Field>
        {!p.fromDeal ? (
          <Field
            label="Client organization"
            className="sm:col-span-2"
            hint={
              orgChanged && p.clientOrg
                ? 'Changing it ends portal access for the people of the current organization.'
                : 'Its portal users can be given access to this project.'
            }
          >
            {(fp) => (
              <Select {...fp} value={clientOrgId} onChange={(e) => setClientOrgId(e.target.value)}>
                <option value="">None (internal project)</option>
                {(orgs.data?.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Overview tab: milestones, scope, money, checklist, team, portal access and history. */
export function ProjectOverview() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const manage = p.access.manage;
  const finance = useFinancePermissions();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Milestones p={p} manage={manage} />
        <Baseline p={p} timeZone={timeZone} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        {finance.view || manage ? <ProjectMoney projectId={p.id} /> : null}
        <Checklist p={p} manage={manage} />
        <Team p={p} manage={manage} />
        {manage ? <PortalAccessCard project={p} /> : null}
        <Card title="History">
          <Timeline entries={p.activities} timeZone={timeZone} />
        </Card>
      </div>
    </div>
  );
}
