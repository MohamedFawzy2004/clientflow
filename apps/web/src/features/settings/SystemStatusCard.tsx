import { can } from '@clientflow/contracts';
import { Badge, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useOpsStatus } from '../notifications/api';

function duration(seconds: number) {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

/** Owner/Admin view of the running system (ADR-064): numbers only, refreshed every minute. */
export function SystemStatusCard() {
  const { data: user } = useSession();
  const allowed = user ? can(user.role, 'jobs.manage') : false;
  const status = useOpsStatus(allowed);
  if (!allowed) return null;
  return (
    <Card title="System status" className="mt-6 max-w-3xl">
      {status.isPending ? (
        <Skeleton className="h-16" />
      ) : status.isError ? (
        <ErrorState
          message={status.error.message}
          onRetry={() => status.refetch()}
          retrying={status.isFetching}
        />
      ) : (
        (() => {
          const s = status.data.data;
          const items: Array<[string, string]> = [
            ['Database response', `${s.database.latencyMs} ms`],
            [
              'Oldest waiting job',
              s.jobs.oldestDueSeconds ? duration(s.jobs.oldestDueSeconds) : 'none',
            ],
            ['Server running for', duration(s.uptimeSeconds)],
            ['Server memory', `${s.memoryMb} MB`],
          ];
          return (
            <>
              <div className="flex flex-wrap gap-2">
                {s.jobs.lagging ? (
                  <Badge tone="warning">Background jobs are behind</Badge>
                ) : (
                  <Badge tone="success">Background jobs on time</Badge>
                )}
                <Badge tone={s.rateLimits === 'postgres' ? 'success' : 'warning'}>
                  {s.rateLimits === 'postgres'
                    ? 'Sign-in limits shared by all servers'
                    : 'Sign-in limits counted per server'}
                </Badge>
                {s.release ? <Badge>Release {s.release}</Badge> : null}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {items.map(([label, value]) => (
                  <div key={label} className="rounded-md bg-surface-alt px-3 py-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="tabular text-sm font-semibold text-text">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          );
        })()
      )}
    </Card>
  );
}
