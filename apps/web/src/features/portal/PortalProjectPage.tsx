import { Link, useParams } from 'react-router';
import { ArrowLeft, PackageCheck, SearchX } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { MilestoneStatusBadge, ProjectStateBadge } from '../../components/projects/project-ui';
import { OverdueBadge, PortalDeliverableBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { usePortalProject } from './api';
import { PortalChangesCard } from './PortalChanges';

/** One shared project: status, milestones and the published deliverables (FR-X03). */
export function PortalProjectPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalProject(id);
  const error = query.error instanceof ApiError ? query.error : null;
  const back = (
    <Link
      to="/portal/projects"
      className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> Your projects
    </Link>
  );
  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-lg" />
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
          description="It does not exist or it is not shared with you."
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
  return (
    <>
      {back}
      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            {p.title}
          </h1>
          <ProjectStateBadge state={p.state} />
        </div>
        <p className="mt-1 text-sm text-muted">
          By {p.agencyName}
          {p.startOn ? ` · started ${formatDay(p.startOn, timeZone)}` : ''}
          {p.dueOn ? ` · due ${formatDay(p.dueOn, timeZone)}` : ''}
        </p>
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="For your review">
          {p.deliverables.length === 0 ? (
            <EmptyState
              icon={<PackageCheck aria-hidden className="size-5" />}
              title="Nothing to review yet"
              description="When the team publishes work for you, it appears here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {p.deliverables.map((d) => (
                <li
                  key={d.id}
                  className="relative flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/portal/deliverables/${d.id}`}
                      className="block break-words text-sm font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                    >
                      {d.title}
                    </Link>
                    <p className="text-xs text-muted">
                      Version {d.versionNo}
                      {d.reviewDueOn
                        ? ` · please review by ${formatDay(d.reviewDueOn, timeZone)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.overdue ? <OverdueBadge /> : null}
                    <PortalDeliverableBadge state={d.state} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Milestones (${p.milestones.done}/${p.milestones.total} done)`}>
          {p.milestoneList.length === 0 ? (
            <p className="text-sm text-muted">No milestones yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {p.milestoneList.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <span className="min-w-0">
                    <span className="block break-words text-sm text-text">{m.title}</span>
                    <span className="text-xs text-muted">
                      {m.dueOn ? `Target ${formatDay(m.dueOn, timeZone)}` : 'No date'}
                    </span>
                  </span>
                  <MilestoneStatusBadge status={m.status} />
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="min-w-0 lg:col-span-2">
          <PortalChangesCard projectId={p.id} />
        </div>
      </div>
    </>
  );
}
