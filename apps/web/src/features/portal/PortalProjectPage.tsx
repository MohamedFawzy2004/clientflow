import { Link, useParams } from 'react-router';
import { ArrowLeft, PackageCheck, SearchX } from 'lucide-react';
import { ApiError } from '../../lib/api';
import type { PortalProjectDetail } from '@clientflow/contracts';
import { cn, formatDate, formatDay, todayIn } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { MilestoneStatusBadge, ProjectStateBadge } from '../../components/projects/project-ui';
import { OverdueBadge, PortalDeliverableBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { usePortalProject } from './api';
import { PortalChangesCard } from './PortalChanges';
import { DocumentTitle } from '../../components/ui/page';

const dayNo = (d: string) =>
  Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/**
 * The project's dates on one line: start, each dated milestone, today and the due date. Drawn
 * only from the dates the agency set; a milestone without a date is not placed. The milestone
 * list beside it carries the same facts as text, so the drawing is hidden from screen readers.
 */
export function PortalSchedule({
  project,
  timeZone,
}: {
  project: Pick<PortalProjectDetail, 'startOn' | 'dueOn' | 'milestoneList'>;
  timeZone: string;
}) {
  const { startOn, dueOn } = project;
  if (!startOn || !dueOn) return null;
  const today = todayIn(timeZone);
  const dated = project.milestoneList.filter((m) => m.dueOn);
  const lo = dayNo(startOn);
  const hi = Math.max(dayNo(dueOn), ...dated.map((m) => dayNo(m.dueOn!)));
  const span = Math.max(hi - lo, 1);
  const at = (d: string) => `${Math.min(100, Math.max(0, ((dayNo(d) - lo) / span) * 100))}%`;
  const elapsed = Math.min(100, Math.max(0, ((dayNo(today) - lo) / span) * 100));
  const daysLeft = dayNo(dueOn) - dayNo(today);
  return (
    <section
      aria-label="Schedule"
      className="mt-5 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <p className="text-sm text-text">
        {daysLeft > 0
          ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} to the due date.`
          : daysLeft === 0
            ? 'Due today.'
            : `The due date passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago.`}{' '}
        <span className="text-muted">
          {project.milestoneList.filter((m) => m.status === 'DONE').length} of{' '}
          {project.milestoneList.length} milestones done.
        </span>
      </p>
      <div aria-hidden className="relative mx-2 mt-5 h-8">
        <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-surface-alt" />
        <div
          className="absolute left-0 top-3 h-1.5 rounded-full bg-seq-3"
          style={{ width: `${elapsed}%` }}
        />
        {dayNo(today) >= lo && dayNo(today) <= hi ? (
          <div className="absolute top-0 h-7 w-px bg-ink" style={{ left: `${elapsed}%` }}>
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-ink">
              Today
            </span>
          </div>
        ) : null}
        {dated.map((m) => {
          const late = m.status !== 'DONE' && m.dueOn! < today;
          return (
            <span
              key={`${m.title}-${m.dueOn}`}
              title={`${m.title}, ${formatDay(m.dueOn!, timeZone)}`}
              className={cn(
                'absolute top-1.5 size-4 -translate-x-1/2 rounded-full border-2 border-surface',
                m.status === 'DONE'
                  ? 'bg-primary'
                  : late
                    ? 'bg-danger'
                    : m.status === 'IN_PROGRESS'
                      ? 'bg-violet'
                      : 'bg-control',
              )}
              style={{ left: at(m.dueOn!) }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between gap-3 text-xs text-muted">
        <span>Started {formatDay(startOn, timeZone)}</span>
        <span>Due {formatDay(dueOn, timeZone)}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" /> Done
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-violet" /> In progress
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-control" /> Planned
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-danger" /> Past its date
        </li>
      </ul>
    </section>
  );
}

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
          <DocumentTitle title={p.title} />
          <h1 className="min-w-0 break-words page-title">{p.title}</h1>
          <ProjectStateBadge state={p.state} />
        </div>
        <p className="mt-1 text-sm text-muted">
          By {p.agencyName}
          {p.startOn ? ` · started ${formatDay(p.startOn, timeZone)}` : ''}
          {p.dueOn ? ` · due ${formatDay(p.dueOn, timeZone)}` : ''}
        </p>
      </header>
      <PortalSchedule project={p} timeZone={timeZone} />
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
              {[...p.deliverables]
                .sort(
                  (a, b) =>
                    Number(b.state === 'AWAITING_REVIEW') - Number(a.state === 'AWAITING_REVIEW'),
                )
                .map((d) => (
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
                        {d.state === 'AWAITING_REVIEW' && d.reviewDueOn
                          ? ` · please review by ${formatDay(d.reviewDueOn, timeZone)}`
                          : ` · shared ${formatDate(d.publishedAt, timeZone)}`}
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
