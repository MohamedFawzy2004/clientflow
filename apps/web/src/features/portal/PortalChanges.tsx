import { useState } from 'react';
import { Link } from 'react-router';
import { GitPullRequestArrow, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@clientflow/contracts';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { EmptyState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { ChangeStatusBadge } from '../../components/projects/delivery-ui';
import { useRequestChange, usePortalChanges } from '../changes/api';
import { changeMessage, RequestChangeForm } from '../changes/ChangesPage';

/** Change requests on a shared project, and the client's "Request a change" (spec J4 step 1). */
export function PortalChangesCard({ projectId }: { projectId: string }) {
  const q = usePortalChanges(projectId);
  const request = useRequestChange(projectId);
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Changes"
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden className="size-4" /> Request a change
        </Button>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-12" />
      ) : q.isError ? (
        <p className="text-sm text-danger">{changeMessage(q.error)}</p>
      ) : q.data.data.length === 0 ? (
        <EmptyState
          icon={<GitPullRequestArrow aria-hidden className="size-5" />}
          title="No changes"
          description="Need something new or different? Request a change; the team prices it and you decide."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {q.data.data.map((c) => (
            <li
              key={c.id}
              className="relative flex flex-col gap-1.5 py-3 first:pt-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/portal/changes/${c.id}`}
                  className="block break-words text-sm font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  <span className="tabular text-muted">{c.reference}</span> {c.title}
                </Link>
                <p className="text-xs text-muted">
                  {c.requestedByYou ? 'Requested by you' : 'From the agency'}
                  {c.totalMinor !== null
                    ? ` · ${formatMoney(c.totalMinor, c.currency)} incl. tax`
                    : ''}
                </p>
              </div>
              <ChangeStatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => !o && !request.isPending && setOpen(false)}
          title="Request a change"
          description="The team estimates the price and timing. Nothing changes until you accept."
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={request.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="portal-change"
                loading={request.isPending}
                loadingLabel="Sending…"
              >
                Send request
              </Button>
            </>
          }
        >
          <RequestChangeForm
            id="portal-change"
            error={request.error ? changeMessage(request.error) : null}
            onSubmit={(body) =>
              request.mutate(body, {
                onSuccess: () => {
                  toast.success('Your request was sent to the team');
                  setOpen(false);
                },
              })
            }
          />
        </Dialog>
      ) : null}
    </Card>
  );
}
