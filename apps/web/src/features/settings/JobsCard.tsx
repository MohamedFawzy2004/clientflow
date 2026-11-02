import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { can } from '@clientflow/contracts';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Badge, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useJobs, useRetryJob } from '../notifications/api';

const KIND_LABELS: Record<string, string> = {
  'email.notification': 'Notification email',
  'email.portal': 'Client portal email',
  'reminders.scan': 'Reminder check',
};

/**
 * Background work (FR-A02): emails and reminder checks. Shows what failed for good so an owner
 * can fix the cause (usually email settings) and retry. Jobs hold IDs only, nothing personal.
 */
export function JobsCard() {
  const { data: user } = useSession();
  const allowed = user ? can(user.role, 'jobs.manage') : false;
  const jobs = useJobs(allowed);
  const retry = useRetryJob();
  if (!allowed) return null;
  const tz = user?.agency.timezone;
  return (
    <Card title="Background jobs" className="mt-6 max-w-3xl">
      {jobs.isPending ? (
        <Skeleton className="h-20" />
      ) : jobs.isError ? (
        <ErrorState
          message={jobs.error.message}
          onRetry={() => jobs.refetch()}
          retrying={jobs.isFetching}
        />
      ) : (
        <>
          <p className="text-sm text-muted">
            Emails and reminders run in the background and are retried with growing waits.
            {jobs.data.data.lastReminderScanAt
              ? ` Reminders were last checked ${formatDateTime(jobs.data.data.lastReminderScanAt, tz)}.`
              : ' Reminders have not been checked yet.'}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Waiting', jobs.data.data.counts.pending],
                ['Running', jobs.data.data.counts.running],
                ['Done (30 days)', jobs.data.data.counts.done],
                ['Failed', jobs.data.data.counts.dead],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-md bg-surface-alt px-3 py-2">
                <dt className="text-xs text-muted">{label}</dt>
                <dd
                  className={
                    label === 'Failed' && n > 0
                      ? 'tabular text-lg font-semibold text-danger'
                      : 'tabular text-lg font-semibold text-text'
                  }
                >
                  {n}
                </dd>
              </div>
            ))}
          </dl>
          {jobs.data.data.dead.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {jobs.data.data.dead.map((j) => (
                <li
                  key={j.id}
                  className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                      {KIND_LABELS[j.kind] ?? j.kind}
                      <Badge tone="danger">Failed after {j.attempts} tries</Badge>
                    </span>
                    <span className="block break-words text-[13px] text-muted">
                      {j.lastError ?? 'No error recorded'}
                      {j.finishedAt ? ` · ${formatDateTime(j.finishedAt, tz)}` : ''}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={retry.isPending && retry.variables === j.id}
                    loadingLabel="Retrying…"
                    aria-label={`Retry ${KIND_LABELS[j.kind] ?? j.kind} from ${j.finishedAt ? formatDateTime(j.finishedAt, tz) : 'earlier'}`}
                    onClick={() =>
                      retry
                        .mutateAsync(j.id)
                        .then(() => toast.success('Queued again'))
                        .catch(() => toast.error('Could not retry. Refresh and try again.'))
                    }
                  >
                    <RotateCcw aria-hidden className="size-4" /> Retry
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  );
}
