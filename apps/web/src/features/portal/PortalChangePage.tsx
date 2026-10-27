import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, type PortalChangeDetail } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { ReasonDialog } from '../../components/sales/sales-ui';
import { Card } from '../../components/proposals/proposal-ui';
import { ChangeStatusBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useChangeDecision, usePortalChange } from '../changes/api';
import { CommentsThread } from '../changes/CommentsThread';

/** The client's explicit decision on the version they see (FR-S03, FR-S04). */
function Decision({ c }: { c: PortalChangeDetail }) {
  const v = c.open!;
  const decide = useChangeDecision(c.id);
  const [open, setOpen] = useState<'ACCEPT' | 'REJECT' | null>(null);
  const errorText =
    decide.error instanceof ApiError
      ? (Object.values(decide.error.fieldErrors)[0]?.[0] ?? decide.error.message)
      : null;
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      decide.reset();
    }
  };
  const submit = (decision: 'ACCEPT' | 'REJECT', reason?: string) =>
    decide.mutate(
      { decision, contentHash: v.contentHash, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          setOpen(null);
          toast.success(
            decision === 'ACCEPT'
              ? 'Accepted: the team will plan the work'
              : 'Your answer was sent to the team',
          );
        },
      },
    );
  return (
    <Card title={`Your decision on version ${v.versionNo}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Accepting adds {formatMoney(v.totalMinor, v.currency)} including tax to the project
          {v.newDueOn ? ` and moves the delivery date to ${formatDay(v.newDueOn)}` : ''}. Your
          decision is recorded with the date and this exact version.
        </p>
        <Button onClick={() => setOpen('ACCEPT')}>Accept change</Button>
        <Button variant="secondary" className="text-danger" onClick={() => setOpen('REJECT')}>
          Reject
        </Button>
      </div>
      <ConfirmDialog
        open={open === 'ACCEPT'}
        onOpenChange={close}
        title={`Accept ${c.reference} version ${v.versionNo}?`}
        description={`This approves ${formatMoney(v.totalMinor, v.currency)} including tax for the work described.`}
        confirmLabel="Accept"
        pendingLabel="Recording…"
        tone="primary"
        pending={decide.isPending}
        error={open === 'ACCEPT' ? errorText : null}
        onConfirm={() => submit('ACCEPT')}
      />
      <ReasonDialog
        open={open === 'REJECT'}
        onOpenChange={close}
        title="Reject this change?"
        description="The project continues with the scope agreed so far."
        label="Why?"
        confirmLabel="Reject"
        pendingLabel="Sending…"
        tone="danger"
        pending={decide.isPending}
        error={open === 'REJECT' ? errorText : null}
        onConfirm={(reason) => submit('REJECT', reason)}
      />
    </Card>
  );
}

export function PortalChangePage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalChange(id);
  const error = query.error instanceof ApiError ? query.error : null;
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
        <Link
          to="/portal/projects"
          className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
        >
          <ArrowLeft aria-hidden className="size-4" /> Your projects
        </Link>
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Not found"
          description="It does not exist or it is not shared with you."
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const c = query.data.data;
  return (
    <>
      <Link
        to={`/portal/projects/${c.project.id}`}
        className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" /> {c.project.title}
      </Link>
      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            <span className="text-muted">{c.reference}</span> {c.title}
          </h1>
          <ChangeStatusBadge status={c.status} />
        </div>
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-text">
          {c.description}
        </p>
        {c.justification ? <p className="mt-1 text-sm text-muted">Why: {c.justification}</p> : null}
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {c.versions.length === 0 ? (
            <Banner tone="info" title="The team is estimating it">
              You will see the price and timing here, and decide on them.
            </Banner>
          ) : (
            <Card title="Proposed change">
              <ol className="flex flex-col divide-y divide-border">
                {c.versions.map((v) => (
                  <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text">
                        Version {v.versionNo}
                        <span className="font-normal text-muted">
                          {' '}
                          · sent {formatDateTime(v.sentAt, timeZone)}
                        </span>
                      </p>
                      {v.decision ? (
                        <Badge tone={v.decision.decision === 'ACCEPTED' ? 'success' : 'danger'}>
                          {v.decision.decision === 'ACCEPTED' ? 'You accepted' : 'You rejected'}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-line break-words text-sm text-text">{v.scope}</p>
                    {v.workItems.length > 0 ? (
                      <ul className="list-disc pl-5 text-sm text-text">
                        {v.workItems.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted">Price</dt>
                        <dd className="tabular-nums text-text">
                          {formatMoney(v.priceMinor, v.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Tax ({v.taxRateBp / 100}%)</dt>
                        <dd className="tabular-nums text-text">
                          {formatMoney(v.taxMinor, v.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Total</dt>
                        <dd className="font-semibold tabular-nums text-text">
                          {formatMoney(v.totalMinor, v.currency)}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-sm text-muted">
                      {v.newDueOn
                        ? `Delivery moves to ${formatDay(v.newDueOn, timeZone)}${c.project.dueOn ? ` (now ${formatDay(c.project.dueOn, timeZone)})` : ''}.`
                        : 'The delivery date stays the same.'}
                    </p>
                    {v.decision?.reason ? (
                      <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-text">
                        “{v.decision.reason}”
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {c.open ? (
            <Decision c={c} />
          ) : c.status === 'ACCEPTED' ? (
            <Banner tone="success" title="Accepted">
              The team adds this work to the project plan.
            </Banner>
          ) : null}
          <CommentsThread thread={{ entityType: 'change', entityId: c.id }} />
        </div>
      </div>
    </>
  );
}
