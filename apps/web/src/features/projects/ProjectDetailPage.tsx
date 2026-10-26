import { useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { ArrowLeft, ChevronRight, SearchX, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  canAny,
  PROJECT_STATE_LABELS,
  PROJECT_TRANSITIONS,
  type ProjectState,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import { Money } from '../../components/sales/sales-ui';
import { ProjectStateBadge } from '../../components/projects/project-ui';
import { useSession } from '../auth/session';
import { useProject, useProjectAction } from './api';
import { EditProjectDialog, projectMessage as message } from './ProjectOverview';

/** Tabs of a project (spec §6.3). Delivery tabs are for the project team only. */
function ProjectTabs({ id, work }: { id: string; work: boolean }) {
  const tabs = [
    { to: '', label: 'Overview', end: true },
    ...(work
      ? [
          { to: 'board', label: 'Tasks', end: false },
          { to: 'deliverables', label: 'Deliverables', end: false },
          { to: 'files', label: 'Files', end: false },
          { to: 'time', label: 'Time', end: false },
        ]
      : []),
  ];
  if (tabs.length === 1) return null;
  return (
    <nav aria-label="Project sections" className="mt-6 border-b border-border">
      {/* Scrolls on its own at 360px, so the page itself never scrolls sideways. */}
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <li key={t.label} className="shrink-0">
            <NavLink
              to={t.to ? `/app/projects/${id}/${t.to}` : `/app/projects/${id}`}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium',
                  isActive
                    ? 'border-primary text-primary-strong'
                    : 'border-transparent text-muted hover:text-text',
                )
              }
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useProject(id);
  const action = useProjectAction(id);
  const [editing, setEditing] = useState(false);
  const error = query.error instanceof ApiError ? query.error : null;
  const back = (
    <Link
      to="/app/projects"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back to projects
    </Link>
  );
  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }
  if (error?.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Project not found"
          description="It does not exist or you are not on it."
        />
      </>
    );
  }
  if (error?.status === 403) {
    return (
      <>
        {back}
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="Projects are not part of your role"
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {back}
        <ErrorState
          message={query.error.message}
          requestId={error?.requestId}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </>
    );
  }

  const p = query.data.data;
  const manage = p.access.manage;
  const next = PROJECT_TRANSITIONS[p.state];
  const moveTo = (state: ProjectState) =>
    action.mutate(
      { kind: 'state', version: p.version, state },
      {
        onSuccess: () =>
          toast.success(`Project is now ${PROJECT_STATE_LABELS[state].toLowerCase()}`),
        onError: (err) => toast.error(message(err)),
      },
    );

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link to="/app/projects" className="hover:text-text">
              Projects
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate text-text">
            {p.title}
          </li>
        </ol>
      </nav>
      <header className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
              {p.title}
            </h1>
            <ProjectStateBadge state={p.state} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {p.client ?? 'Internal'} · managed by {p.manager.name}
            {p.startOn ? ` · starts ${formatDate(`${p.startOn}T12:00:00Z`, timeZone)}` : ''}
            {p.dueOn ? ` · due ${formatDate(`${p.dueOn}T12:00:00Z`, timeZone)}` : ''}
            {p.fromDeal ? (
              <>
                {' · from deal '}
                {user && canAny(user.role, ['deals.read.all', 'deals.read.own']) ? (
                  <Link
                    to={`/app/deals/${p.fromDeal.id}`}
                    className="font-medium text-primary-strong hover:underline"
                  >
                    {p.fromDeal.title}
                  </Link>
                ) : (
                  p.fromDeal.title
                )}
              </>
            ) : null}
          </p>
          <p className="mt-2 text-sm text-text">
            Budget <Money minor={p.budgetMinor} currency={p.currency} className="font-semibold" />{' '}
            excl. tax
          </p>
        </div>
        {manage ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="project-move" className="text-[13px] font-medium text-text">
                Change state
              </label>
              <Select
                id="project-move"
                className="mt-1.5 w-auto min-w-[180px]"
                value=""
                disabled={action.isPending || next.length === 0}
                onChange={(e) => e.target.value && moveTo(e.target.value as ProjectState)}
              >
                <option value="">Move to…</option>
                {next.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        ) : null}
      </header>
      {p.state === 'ARCHIVED' ? (
        <Banner tone="info" title="Archived" className="mt-4">
          This project is kept for history and can no longer change.
        </Banner>
      ) : !manage && !p.access.work ? (
        <p className="mt-4 text-[13px] text-muted">
          You can view this project. Only its manager or an admin can change it.
        </p>
      ) : null}
      <ProjectTabs id={p.id} work={p.access.work} />
      <div className="mt-6">
        <Outlet context={{ project: p }} />
      </div>
      {editing ? <EditProjectDialog p={p} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
