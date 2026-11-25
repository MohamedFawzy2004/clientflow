import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Flag } from 'lucide-react';
import { PROJECT_STATE_LABELS, TASK_STATUS_LABELS, type TaskStatus } from '@clientflow/contracts';
import { cn, formatDate } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/page';
import { useSession } from '../auth/session';
import { useDeliveryDashboard } from '../projects/api';

/** One ledger cell: a labelled figure with an optional note and link (same grammar as Results). */
function Cell({
  name,
  label,
  value,
  tone = 'ink',
  note,
  link,
}: {
  /** Accessible region name; kept stable for the end-to-end suites. */
  name?: string;
  label: string;
  value: number;
  tone?: 'ink' | 'warning' | 'danger';
  note?: ReactNode;
  link?: { to: string; label: string };
}) {
  return (
    <section aria-label={name ?? label} className="flex min-w-0 flex-col p-5">
      <h3 className="text-[13px] text-muted">{label}</h3>
      <p
        className={cn(
          'figure mt-1 text-[32px] leading-[38px]',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      {link ? (
        <Link
          to={link.to}
          className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-primary-strong hover:underline"
        >
          {link.label} <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

function DueDate({
  dueOn,
  overdue,
  timeZone,
}: {
  dueOn: string;
  overdue: boolean;
  timeZone: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap text-xs tabular',
        overdue ? 'font-medium text-danger' : 'text-muted',
      )}
    >
      {overdue ? 'Overdue, ' : ''}
      {formatDate(`${dueOn}T12:00:00Z`, timeZone)}
    </span>
  );
}

/** Projects and milestones in the viewer's scope (FR-F08 project part, GET /api/v1/dashboard/delivery). */
export function DeliveryDashboardSection() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useDeliveryDashboard();
  if (query.isPending) return <Skeleton className="h-40 rounded-lg" />;
  if (query.isError) {
    return (
      <Panel bodyClassName="p-0" title="Delivery">
        <ErrorState
          className="py-8"
          message={query.error.message}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </Panel>
    );
  }
  const d = query.data.data;
  const open = d.projects.PLANNED + d.projects.ACTIVE + d.projects.ON_HOLD;
  return (
    <section aria-labelledby="delivery-title" className="flex flex-col gap-4">
      <div>
        <h2 id="delivery-title" className="text-xl font-[640] tracking-[-0.02em] text-ink">
          Delivery
        </h2>
        <p className="text-[13px] text-muted">
          Projects, milestones and client reviews you can see.
        </p>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 xl:grid-cols-4 max-sm:[&>section+section]:border-t sm:[&>section:nth-child(n+3)]:border-t sm:[&>section:nth-child(even)]:border-l xl:[&>section+section]:border-l xl:[&>section:nth-child(n+3)]:border-t-0 [&>section]:border-border">
        <Cell
          label="Open projects"
          value={open}
          note={(['PLANNED', 'ACTIVE', 'ON_HOLD'] as const)
            .map((s) => `${d.projects[s]} ${PROJECT_STATE_LABELS[s].toLowerCase()}`)
            .join(', ')}
          link={{ to: '/app/projects', label: 'View projects' }}
        />
        <Cell
          label="Overdue milestones"
          value={d.milestones.overdue}
          tone={d.milestones.overdue > 0 ? 'warning' : 'ink'}
          note={`${d.milestones.dueIn7Days} due in the next 7 days`}
        />
        {d.handoffWaiting !== null ? (
          <Cell
            name="Waiting for handoff"
            label="Won deals waiting for handoff"
            value={d.handoffWaiting}
            link={{ to: '/app/projects', label: 'Start projects' }}
          />
        ) : null}
        <Cell
          name="Waiting for the client"
          label="Deliverables waiting for the client"
          value={d.deliverables.awaitingClient}
          note={
            <>
              <span className={d.deliverables.overdue > 0 ? 'font-medium text-danger' : undefined}>
                {d.deliverables.overdue} past the review date
              </span>
              , {d.projects.COMPLETED} projects completed
            </>
          }
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        {d.myTasks.length > 0 ? (
          <Panel
            bodyClassName="p-0"
            id="my-tasks"
            title="My tasks"
            description="Open tasks assigned to you, soonest first."
          >
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {d.myTasks.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/app/projects/${t.projectId}/board`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{t.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {t.projectTitle}, {TASK_STATUS_LABELS[t.status as TaskStatus]}
                      </span>
                    </span>
                    {t.dueOn ? (
                      <DueDate dueOn={t.dueOn} overdue={t.overdue} timeZone={timeZone} />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
        <Panel
          bodyClassName="p-0"
          id="next-milestones"
          title="Next milestones"
          description="Open milestones by due date."
          className={d.myTasks.length > 0 ? undefined : 'xl:col-span-2'}
        >
          {d.upcoming.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Flag aria-hidden className="size-5" />}
              title="No open milestones"
              description="Milestones appear here once a project plan has due dates."
            />
          ) : (
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {d.upcoming.map((m) => (
                <li key={`${m.projectId}-${m.milestone}-${m.dueOn}`}>
                  <Link
                    to={`/app/projects/${m.projectId}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {m.milestone}
                      </span>
                      <span className="block truncate text-xs text-muted">{m.projectTitle}</span>
                    </span>
                    <DueDate dueOn={m.dueOn} overdue={m.overdue} timeZone={timeZone} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
