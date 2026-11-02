import { Link } from 'react-router';
import { FolderKanban } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { ProjectStateBadge } from '../../components/projects/project-ui';
import { useSession } from '../auth/session';
import { usePortalProjects } from './api';

/** Projects the agency shared with this client user (FR-X01, FR-X03). */
export function PortalProjectsPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalProjects();
  const error = query.error instanceof ApiError ? query.error : null;

  let body;
  if (query.isError) {
    body = (
      <ErrorState
        title="We could not load your projects"
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
        title="No projects shared with you yet"
        description={`When ${user?.agency.name ?? 'the agency'} shares a project with you, its progress and the work to review appear here.`}
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((p) => (
          <li key={p.id} className="relative px-4 py-4 hover:bg-surface-alt/50 md:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/portal/projects/${p.id}`}
                  className="block break-words font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  {p.title}
                </Link>
                <p className="mt-0.5 text-[13px] text-muted">
                  Milestones {p.milestones.done}/{p.milestones.total} done
                  {p.dueOn ? ` · due ${formatDay(p.dueOn, timeZone)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {p.awaitingReview > 0 ? (
                  <Badge tone="primary">{p.awaitingReview} to review</Badge>
                ) : null}
                <ProjectStateBadge state={p.state} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Projects
      </h1>
      <p className="mt-1 text-sm text-muted">
        Work {user?.agency.name} is delivering for {user?.clientOrg?.name ?? 'you'}.
      </p>
      <section
        aria-label="Your projects"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {body}
      </section>
    </>
  );
}
