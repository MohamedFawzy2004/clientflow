import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Printer, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import {
  OPERATIONAL_APPROVAL_NOTICE,
  type ClientDecision,
  type PortalProposalDetail,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { ReasonDialog } from '../../components/sales/sales-ui';
import {
  Card,
  ProposalDocument,
  ProposalStatusBadge,
} from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { usePortalDecision, usePortalProposal } from './api';

const DECIDED: Record<'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED', string> = {
  ACCEPTED: 'You accepted this version',
  REJECTED: 'You declined this version',
  CHANGES_REQUESTED: 'You asked for changes',
};

function DecisionPanel({
  proposal,
  timeZone,
}: {
  proposal: PortalProposalDetail;
  timeZone: string;
}) {
  const v = proposal.current;
  const decide = usePortalDecision(proposal.id);
  const [open, setOpen] = useState<ClientDecision | null>(null);
  const [read, setRead] = useState(false);
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
  const submit = (decision: ClientDecision, comment?: string) =>
    decide.mutate(
      { decision, contentHash: v.contentHash, ...(comment ? { comment } : {}) },
      {
        onSuccess: () => {
          setOpen(null);
          toast.success(
            decision === 'ACCEPT'
              ? 'Thank you: your acceptance is recorded'
              : 'Your response was sent to the team',
          );
        },
      },
    );

  if (v.decision) {
    return (
      <Banner
        tone={v.decision.decision === 'ACCEPTED' ? 'success' : 'info'}
        title={DECIDED[v.decision.decision]}
      >
        Recorded for {v.decision.by} on {formatDateTime(v.decision.at, timeZone)}.
        {v.decision.comment ? ` “${v.decision.comment}”` : ''}
        {v.decision.decision === 'ACCEPTED' ? ` ${OPERATIONAL_APPROVAL_NOTICE}` : ''}
      </Banner>
    );
  }
  if (v.displayStatus === 'EXPIRED') {
    return (
      <Banner tone="warning" title="This proposal has expired">
        It can no longer be accepted. Ask {proposal.agencyName} for an updated version.
      </Banner>
    );
  }
  if (v.displayStatus === 'SUPERSEDED') {
    return (
      <Banner tone="info" title="A newer version was sent">
        Reload the page to review the latest version.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{OPERATIONAL_APPROVAL_NOTICE}</p>
      <label className="flex items-start gap-2.5 text-sm text-text">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
          checked={read}
          onChange={(e) => setRead(e.target.checked)}
        />
        I have read version {v.versionNo}, including what is not included and the terms.
      </label>
      <Button onClick={() => setOpen('ACCEPT')} disabled={!read}>
        Accept proposal
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen('REQUEST_CHANGES')}>
          Request changes
        </Button>
        <Button variant="secondary" className="text-danger" onClick={() => setOpen('REJECT')}>
          Decline
        </Button>
      </div>

      <ConfirmDialog
        open={open === 'ACCEPT'}
        onOpenChange={close}
        title={`Accept ${proposal.reference} version ${v.versionNo}?`}
        description={`This records that you accept this exact version on behalf of ${proposal.clientOrgName}. ${OPERATIONAL_APPROVAL_NOTICE}`}
        confirmLabel="Accept"
        pendingLabel="Recording…"
        tone="primary"
        pending={decide.isPending}
        error={open === 'ACCEPT' ? errorText : null}
        onConfirm={() => submit('ACCEPT')}
      />
      <ReasonDialog
        open={open === 'REQUEST_CHANGES'}
        onOpenChange={close}
        title="Request changes?"
        description={`${proposal.agencyName} will prepare a new version.`}
        label="What should change?"
        confirmLabel="Send request"
        pendingLabel="Sending…"
        pending={decide.isPending}
        error={open === 'REQUEST_CHANGES' ? errorText : null}
        onConfirm={(comment) => submit('REQUEST_CHANGES', comment)}
      />
      <ReasonDialog
        open={open === 'REJECT'}
        onOpenChange={close}
        title="Decline this proposal?"
        label="Why are you declining?"
        confirmLabel="Decline"
        pendingLabel="Sending…"
        tone="danger"
        pending={decide.isPending}
        error={open === 'REJECT' ? errorText : null}
        onConfirm={(comment) => submit('REJECT', comment)}
      />
    </div>
  );
}

export function PortalProposalPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalProposal(id);
  const error = query.error instanceof ApiError ? query.error : null;
  const back = (
    <Link
      to="/portal"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text print:hidden"
    >
      <ArrowLeft aria-hidden className="size-4" /> All proposals
    </Link>
  );

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }
  if (error?.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Proposal not found"
          description="It may not have been shared with your organization."
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[28px]">
            Proposal {p.reference}
          </h1>
          <ProposalStatusBadge status={p.current.displayStatus} />
        </div>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" /> Print
        </Button>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] print:mt-0 print:block">
        <Card className="print:border-0 print:shadow-none">
          <ProposalDocument
            content={p.current}
            reference={p.reference}
            timeZone={timeZone}
            header={
              <>
                <p className="text-sm text-muted">
                  From {p.agencyName} for {p.clientOrgName} · Sent{' '}
                  {formatDateTime(p.current.sentAt, timeZone)}
                </p>
                {p.current.decision?.decision === 'ACCEPTED' ? (
                  <p className="mt-2 text-sm font-medium text-success">
                    Accepted by {p.current.decision.by} on{' '}
                    {formatDateTime(p.current.decision.at, timeZone)} (operational approval, not an
                    e-signature)
                  </p>
                ) : null}
              </>
            }
          />
        </Card>
        <div className="flex flex-col gap-6 print:hidden">
          <Card title="Your decision">
            <DecisionPanel proposal={p} timeZone={timeZone} />
          </Card>
          {p.history.length > 1 ? (
            <Card title="Versions">
              <ol className="flex flex-col gap-2 text-sm">
                {p.history.map((h) => (
                  <li key={h.versionNo} className="flex items-center justify-between gap-2">
                    <span>Version {h.versionNo}</span>
                    <ProposalStatusBadge status={h.displayStatus} />
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
