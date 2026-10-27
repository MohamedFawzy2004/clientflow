import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Download, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import {
  DELIVERABLE_DECISION_LABELS,
  formatBytes,
  type DeliverableDecisionInput,
  type PortalDeliverableDetail,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Banner, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { ReasonDialog } from '../../components/sales/sales-ui';
import { Card } from '../../components/proposals/proposal-ui';
import { OverdueBadge, PortalDeliverableBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { startDownload } from '../delivery/FilesPage';
import { CommentsThread } from '../changes/CommentsThread';
import { useDeliverableDecision, usePortalDeliverable } from './api';

type Decision = DeliverableDecisionInput['decision'];

/** The client's explicit decision on the open version (FR-S07, US-13). One per version. */
function DecisionPanel({ d }: { d: PortalDeliverableDetail }) {
  const decide = useDeliverableDecision(d.id);
  const [open, setOpen] = useState<Decision | null>(null);
  const v = d.versions.find((x) => x.id === d.openVersionId);
  if (!v) return null;
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
  const submit = (decision: Decision, reason?: string) =>
    decide.mutate(
      { versionId: v.id, decision, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          setOpen(null);
          toast.success(
            decision === 'APPROVE'
              ? 'Thank you: your approval is recorded'
              : 'Your feedback was sent to the team',
          );
        },
      },
    );
  return (
    <Card title={`Your decision on version ${v.versionNo}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Download and check the file first. Your decision is recorded with the date and this exact
          version, and cannot be changed afterwards.
        </p>
        <Button onClick={() => setOpen('APPROVE')}>Approve version {v.versionNo}</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setOpen('REQUEST_REVISION')}>
            Request a revision
          </Button>
          <Button variant="secondary" className="text-danger" onClick={() => setOpen('REJECT')}>
            Reject
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open === 'APPROVE'}
        onOpenChange={close}
        title={`Approve “${d.title}” version ${v.versionNo}?`}
        description="This records your approval of this exact version for the team."
        confirmLabel="Approve"
        pendingLabel="Recording…"
        tone="primary"
        pending={decide.isPending}
        error={open === 'APPROVE' ? errorText : null}
        onConfirm={() => submit('APPROVE')}
      />
      <ReasonDialog
        open={open === 'REQUEST_REVISION'}
        onOpenChange={close}
        title="Request a revision?"
        description="The team will prepare a new version."
        label="What should change?"
        confirmLabel="Send request"
        pendingLabel="Sending…"
        pending={decide.isPending}
        error={open === 'REQUEST_REVISION' ? errorText : null}
        onConfirm={(reason) => submit('REQUEST_REVISION', reason)}
      />
      <ReasonDialog
        open={open === 'REJECT'}
        onOpenChange={close}
        title="Reject this version?"
        description="Tell the team why, so they know what to do next."
        label="Why are you rejecting it?"
        confirmLabel="Reject"
        pendingLabel="Sending…"
        pending={decide.isPending}
        error={open === 'REJECT' ? errorText : null}
        onConfirm={(reason) => submit('REJECT', reason)}
      />
    </Card>
  );
}

export function PortalDeliverablePage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalDeliverable(id);
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
  const d = query.data.data;
  return (
    <>
      <Link
        to={`/portal/projects/${d.project.id}`}
        className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" /> {d.project.title}
      </Link>
      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            {d.title}
          </h1>
          <PortalDeliverableBadge state={d.state} />
          {d.overdue ? <OverdueBadge /> : null}
        </div>
        {d.reviewDueOn ? (
          <p className="mt-1 text-sm text-muted">
            Please review by {formatDay(d.reviewDueOn, timeZone)}.
          </p>
        ) : null}
        {d.description ? (
          <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-text">
            {d.description}
          </p>
        ) : null}
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Versions">
          <ol className="flex flex-col divide-y divide-border">
            {d.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">
                    Version {v.versionNo}
                    <span className="font-normal text-muted">
                      {' '}
                      · shared {formatDateTime(v.publishedAt, timeZone)}
                    </span>
                  </p>
                  {v.review ? (
                    <Badge tone={v.review.decision === 'APPROVED' ? 'success' : 'warning'}>
                      {DELIVERABLE_DECISION_LABELS[v.review.decision]}
                    </Badge>
                  ) : null}
                </div>
                {v.note ? <p className="break-words text-sm text-text">{v.note}</p> : null}
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => startDownload(v.file.id, true)}
                  >
                    <Download aria-hidden className="size-3.5" /> Download {v.file.name}
                    <span className="text-muted">({formatBytes(v.file.sizeBytes)})</span>
                  </Button>
                </div>
                {v.review ? (
                  <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-text">
                    Your decision on {formatDateTime(v.review.at, timeZone)}
                    {v.review.reason ? (
                      <span className="mt-1 block whitespace-pre-line break-words">
                        “{v.review.reason}”
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          {d.openVersionId ? (
            <DecisionPanel d={d} />
          ) : (
            <Banner
              tone={d.state === 'APPROVED' ? 'success' : 'info'}
              title={d.state === 'APPROVED' ? 'You approved this' : 'The team is working on it'}
            >
              {d.state === 'APPROVED'
                ? 'Thank you. Nothing else is needed from you here.'
                : 'You will see the next version here when it is ready.'}
            </Banner>
          )}
          <CommentsThread thread={{ entityType: 'deliverable', entityId: d.id }} />
        </div>
      </div>
    </>
  );
}
