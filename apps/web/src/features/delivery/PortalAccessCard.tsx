import { toast } from 'sonner';
import type { ProjectDetail } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useShareAction, useShares } from './api';

function message(err: unknown) {
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return 'Something went wrong.';
}

/**
 * Who of the client's people may see this project in the portal (FR-X01). Nothing is visible
 * there until a deliverable is published, and a share can be ended at any time.
 */
export function PortalAccessCard({ project }: { project: ProjectDetail }) {
  const shares = useShares(project.id, true);
  const action = useShareAction(project.id);
  const data = shares.data?.data;
  const readOnly = project.state === 'ARCHIVED';
  return (
    <Card title="Client portal access">
      {shares.isPending ? (
        <Skeleton className="h-16" />
      ) : shares.isError ? (
        <p className="text-sm text-danger">{message(shares.error)}</p>
      ) : !data?.clientOrg ? (
        <p className="text-sm text-muted">
          This project is not linked to a client organization, so nobody outside the agency can see
          it. Edit the project to link one.
        </p>
      ) : data.people.length === 0 ? (
        <p className="text-sm text-muted">
          {data.clientOrg.name} has no portal users yet. Invite them from the client contact first.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            People of {data.clientOrg.name} you share the project with see its status, milestones
            and published deliverables. Tasks, time, files and notes stay internal.
          </p>
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {data.people.map((s) => (
              <li key={s.user.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text">
                    {s.user.name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {s.user.email}
                    {s.user.active ? '' : ' · deactivated'}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={s.shared ? 'ghost' : 'secondary'}
                  className={s.shared ? 'text-danger' : undefined}
                  disabled={readOnly || action.isPending || (!s.shared && !s.user.active)}
                  onClick={() =>
                    action.mutate(
                      { userId: s.user.id, share: !s.shared },
                      {
                        onSuccess: () =>
                          toast.success(
                            s.shared
                              ? `${s.user.name} no longer sees this project`
                              : `Shared with ${s.user.name}`,
                          ),
                        onError: (err) => toast.error(message(err)),
                      },
                    )
                  }
                >
                  {s.shared ? 'Remove access' : 'Share'}
                  <span className="sr-only"> for {s.user.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
