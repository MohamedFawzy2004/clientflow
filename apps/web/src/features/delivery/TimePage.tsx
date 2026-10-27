import { Clock } from 'lucide-react';
import { formatMinutes } from '@clientflow/contracts';
import { formatDay } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useProjectTime } from './api';
import { deliveryMessage } from './TaskBoardPage';

/** Time on the project (FR-P08): everyone's for the manager, your own for everyone else. */
export function TimePage() {
  const p = useProjectContext();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useProjectTime(p.id);
  if (query.isPending) return <Skeleton className="h-64 rounded-lg" />;
  if (query.isError) {
    return (
      <ErrorState
        message={deliveryMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const t = query.data.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-[13px] text-muted">
            {t.scope === 'all' ? 'Logged on this project' : 'You logged'}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {formatMinutes(t.totals.minutes)}
          </p>
        </Card>
        <Card>
          <p className="text-[13px] text-muted">Billable</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {formatMinutes(t.totals.billableMinutes)}
          </p>
        </Card>
      </div>
      {t.byScope.CHANGE + t.byScope.EXCEPTION > 0 ? (
        <Card title="Original scope and extra work">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {(
              [
                ['BASELINE', 'Original scope'],
                ['CHANGE', 'Accepted changes'],
                ['EXCEPTION', 'Exceptions'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="tabular-nums text-text">{formatMinutes(t.byScope[k])}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
      {t.scope === 'all' && t.byPerson.length > 0 ? (
        <Card title="By person">
          <ul className="flex flex-col divide-y divide-border">
            {t.byPerson.map((r) => (
              <li key={r.user.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-text">{r.user.name}</span>
                <span className="tabular-nums text-muted">
                  {formatMinutes(r.minutes)} · {formatMinutes(r.billableMinutes)} billable
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={t.scope === 'all' ? 'Recent entries' : 'Your recent entries'}>
        {t.entries.length === 0 ? (
          <EmptyState
            icon={<Clock aria-hidden className="size-5" />}
            title="No time logged yet"
            description="Open a task on the Tasks tab to log time on it."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {t.entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block break-words text-text">{e.task.title}</span>
                  <span className="block text-xs text-muted">
                    {e.user.name} · {formatDay(e.workedOn, timeZone)}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                </span>
                <span className="tabular-nums text-muted">
                  {formatMinutes(e.minutes)}
                  {e.billable ? '' : ' · not billable'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[13px] text-muted">
        Time is internal and never shown to the client. Cost rates and margins arrive with finance
        tracking.
      </p>
    </div>
  );
}
