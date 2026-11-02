import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FolderKanban, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  CURRENCIES,
  PROJECT_STATES,
  PROJECT_STATE_LABELS,
  projectCreateSchema,
  type ProjectCreateInput,
  type ProjectState,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { Money } from '../../components/sales/sales-ui';
import { ProjectStateBadge } from '../../components/projects/project-ui';
import { useSession } from '../auth/session';
import {
  useCreateProject,
  useDeliveryStaff,
  useHandoffQueue,
  useProjectPermissions,
  useProjects,
} from './api';
import { ConvertDealDialog } from './ConvertDealDialog';

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { data: user } = useSession();
  const navigate = useNavigate();
  const staff = useDeliveryStaff();
  const create = useCreateProject();
  const form = useForm<ProjectCreateInput>({
    resolver: zodResolver(projectCreateSchema),
    defaultValues: {
      title: '',
      managerId: user?.role === 'PM' ? user.id : '',
      currency: (user?.agency.defaultCurrency ?? 'EGP') as ProjectCreateInput['currency'],
      budget: '',
    },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { errors } = form.formState;
  // The select can only show the default once its option exists, so re-apply it after loading.
  const loaded = staff.data !== undefined;
  useEffect(() => {
    if (loaded && user?.role === 'PM' && !form.getValues('managerId')) {
      form.setValue('managerId', user.id);
    } else if (loaded) {
      form.setValue('managerId', form.getValues('managerId'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const onSubmit = form.handleSubmit((v) =>
    create.mutate(
      {
        title: v.title,
        managerId: v.managerId,
        currency: v.currency,
        ...(v.budget ? { budget: v.budget } : {}),
        ...(v.startOn ? { startOn: v.startOn } : {}),
        ...(v.dueOn ? { dueOn: v.dueOn } : {}),
      },
      {
        onSuccess: (res) => {
          toast.success('Project created');
          onClose();
          navigate(`/app/projects/${res.data.id}`);
        },
      },
    ),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title="New project"
      description="For work without a won deal, such as internal or retainer projects. Projects from deals are created with “Convert to project”."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-project-form"
            loading={create.isPending}
            loadingLabel="Creating…"
          >
            Create project
          </Button>
        </>
      }
    >
      {create.error instanceof ApiError && create.error.code !== 'VALIDATION_FAILED' ? (
        <Banner tone="danger" title="Not created" className="mb-5">
          {create.error.message}
        </Banner>
      ) : null}
      <form
        id="new-project-form"
        onSubmit={onSubmit}
        noValidate
        className="grid gap-5 sm:grid-cols-2"
      >
        <Field
          label="Project name"
          required
          error={errors.title?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} maxLength={200} data-autofocus {...form.register('title')} />}
        </Field>
        <Field
          label="Project manager"
          required
          error={errors.managerId?.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Select {...p} {...form.register('managerId')}>
              <option value="">Choose a manager…</option>
              {(staff.data?.data ?? [])
                .filter((u) => u.role !== 'MEMBER')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Budget (excl. tax)" error={errors.budget?.message}>
          {(p) => <Input {...p} inputMode="decimal" {...form.register('budget')} />}
        </Field>
        <Field label="Currency" required error={errors.currency?.message}>
          {(p) => (
            <Select {...p} {...form.register('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Start" error={errors.startOn?.message}>
          {(p) => (
            <Input
              {...p}
              type="date"
              {...form.register('startOn', { setValueAs: (v) => v || undefined })}
            />
          )}
        </Field>
        <Field label="Due" error={errors.dueOn?.message}>
          {(p) => (
            <Input
              {...p}
              type="date"
              {...form.register('dueOn', { setValueAs: (v) => v || undefined })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function HandoffQueue() {
  const queue = useHandoffQueue();
  const [converting, setConverting] = useState<{ id: string; title: string } | null>(null);
  const items = queue.data?.data ?? [];
  if (queue.isPending || items.length === 0) return null;
  return (
    <section
      aria-label="Waiting for handoff"
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold text-text">
        Won deals waiting for handoff ({items.length})
      </h2>
      <ul className="divide-y divide-border">
        {items.map((c) => (
          <li
            key={c.dealId}
            className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{c.title}</p>
              <p className="truncate text-xs text-muted">
                {c.contact} · {c.proposal.reference} v{c.proposal.versionNo} accepted · sold by{' '}
                {c.owner}
              </p>
            </div>
            <Money minor={c.amountMinor} currency={c.currency} className="text-sm" />
            <Button size="sm" onClick={() => setConverting({ id: c.dealId, title: c.title })}>
              Convert<span className="sr-only"> {c.title}</span> to project
            </Button>
          </li>
        ))}
      </ul>
      {converting ? (
        <ConvertDealDialog
          dealId={converting.id}
          dealTitle={converting.title}
          onClose={() => setConverting(null)}
        />
      ) : null}
    </section>
  );
}

function isState(v: string | null): v is ProjectState {
  return v !== null && (PROJECT_STATES as readonly string[]).includes(v);
}

export function ProjectsListPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const perms = useProjectPermissions();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = isState(raw) ? raw : undefined;
  const query = useProjects(state);
  const [creating, setCreating] = useState(false);
  const error = query.error instanceof ApiError ? query.error : null;

  let body;
  if (!perms.read || error?.status === 403) {
    body = (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Projects are not part of your role"
      />
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (query.isPending) {
    body = (
      <div aria-busy className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  } else if (query.data.data.length === 0) {
    body = (
      <EmptyState
        icon={<FolderKanban aria-hidden className="size-5" />}
        title={state ? 'No projects in this state' : 'No projects yet'}
        description={
          perms.create
            ? 'Convert a won deal above, or create a project without a deal.'
            : 'Projects you manage, join or sold appear here.'
        }
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((p) => (
          <li key={p.id} className="relative px-4 py-3.5 hover:bg-surface-alt/50 md:px-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/app/projects/${p.id}`}
                  className="block truncate font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  {p.title}
                </Link>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {p.client ?? 'Internal'} · managed by {p.manager.name} · {p.milestones.done}/
                  {p.milestones.total} milestones done
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <ProjectStateBadge state={p.state} />
                {p.dueOn ? (
                  <span className="text-[13px] text-muted">
                    Due {formatDate(`${p.dueOn}T12:00:00Z`, timeZone)}
                  </span>
                ) : null}
                <Money
                  minor={p.budgetMinor}
                  currency={p.currency}
                  className="text-sm font-medium"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Projects
          </h1>
          <p className="mt-1 text-sm text-muted">Delivery work handed off from won deals.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label htmlFor="project-state" className="text-[13px] font-medium text-text">
              State
            </label>
            <Select
              id="project-state"
              className="mt-1.5"
              value={state ?? ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('state', e.target.value);
                else next.delete('state');
                setParams(next, { replace: true });
              }}
            >
              <option value="">Open (not archived)</option>
              {PROJECT_STATES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {perms.create ? (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New project
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        {perms.create ? <HandoffQueue /> : null}
        <section
          aria-label="Projects list"
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          {body}
        </section>
      </div>
      {creating ? <NewProjectDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
