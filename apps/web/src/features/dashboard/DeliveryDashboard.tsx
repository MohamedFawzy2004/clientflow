import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { PROJECT_STATE_LABELS } from '@clientflow/contracts';
import { cn, formatDate } from '../../lib/format';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { useDeliveryDashboard } from '../projects/api';

const BIG = 'text-[32px] font-semibold leading-[38px] tracking-[-0.02em] tabular';

/** Projects and milestones in the viewer's scope (FR-F08 project part). */
export function DeliveryDashboardSection() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useDeliveryDashboard();
  if (query.isPending) return <Skeleton className="h-40 rounded-lg" />;
  if (query.isError) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <ErrorState
          message={query.error.message}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    );
  }
  const d = query.data.data;
  const open = d.projects.PLANNED + d.projects.ACTIVE + d.projects.ON_HOLD;
  return (
    <section aria-label="Delivery" className="flex flex-col gap-4">
      <h2 className="text-[17px] font-semibold text-text">Delivery</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section
          aria-label="Open projects"
          className="rounded-lg border border-border bg-surface p-5 shadow-card"
        >
          <p className="text-[13px] font-medium text-muted">Open projects</p>
          <p className={cn('mt-2 text-text', BIG)}>{open}</p>
          <p className="mt-1 text-xs text-muted">
            {(['PLANNED', 'ACTIVE', 'ON_HOLD'] as const)
              .map((s) => `${d.projects[s]} ${PROJECT_STATE_LABELS[s].toLowerCase()}`)
              .join(' · ')}
          </p>
          <Link
            to="/app/projects"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline"
          >
            View projects <ArrowRight aria-hidden className="size-4" />
          </Link>
        </section>
        <section
          aria-label="Overdue milestones"
          className="rounded-lg border border-border bg-surface p-5 shadow-card"
        >
          <p className="text-[13px] font-medium text-muted">Overdue milestones</p>
          <p className={cn('mt-2', BIG, d.milestones.overdue > 0 ? 'text-warning' : 'text-text')}>
            {d.milestones.overdue}
          </p>
          <p className="mt-1 text-xs text-muted">
            {d.milestones.dueIn7Days} due in the next 7 days
          </p>
        </section>
        {d.handoffWaiting !== null ? (
          <section
            aria-label="Waiting for handoff"
            className="rounded-lg border border-border bg-surface p-5 shadow-card"
          >
            <p className="text-[13px] font-medium text-muted">Won deals waiting for handoff</p>
            <p className={cn('mt-2 text-text', BIG)}>{d.handoffWaiting}</p>
            <Link
              to="/app/projects"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline"
            >
              Start projects <ArrowRight aria-hidden className="size-4" />
            </Link>
          </section>
        ) : null}
        <section
          aria-label="Completed projects"
          className="rounded-lg border border-border bg-surface p-5 shadow-card"
        >
          <p className="text-[13px] font-medium text-muted">Completed</p>
          <p className={cn('mt-2 text-text', BIG)}>{d.projects.COMPLETED}</p>
        </section>
      </div>
      {d.upcoming.length > 0 ? (
        <section
          aria-label="Next milestones"
          className="rounded-lg border border-border bg-surface shadow-card"
        >
          <h3 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold text-text">
            Next milestones
          </h3>
          <ul className="divide-y divide-border">
            {d.upcoming.map((m) => (
              <li key={`${m.projectId}-${m.milestone}-${m.dueOn}`}>
                <Link
                  to={`/app/projects/${m.projectId}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {m.milestone}
                    </span>
                    <span className="block truncate text-xs text-muted">{m.projectTitle}</span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-xs',
                      m.overdue ? 'font-medium text-danger' : 'text-muted',
                    )}
                  >
                    {m.overdue ? 'Overdue · ' : ''}
                    {formatDate(`${m.dueOn}T12:00:00Z`, timeZone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
