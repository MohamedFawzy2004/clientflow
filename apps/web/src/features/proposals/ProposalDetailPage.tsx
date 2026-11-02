import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ChevronRight, Printer, SearchX, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  OPERATIONAL_APPROVAL_NOTICE,
  type ProposalDetail,
  type ProposalReviewEntry,
  type ProposalVersionView,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Money, ReasonDialog } from '../../components/sales/sales-ui';
import {
  Card,
  ProposalDocument,
  ProposalStatusBadge,
} from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useProposal, useProposalAction, useProposalPermissions, useProposalVersion } from './api';
import { ProposalEditor } from './ProposalEditor';

const DECISION_LABEL: Record<ProposalReviewEntry['decision'], string> = {
  SUBMITTED: 'Submitted for review',
  APPROVED: 'Approved for sending',
  CHANGES_REQUESTED: 'Changes requested',
  SENT: 'Sent to the client portal',
  ACCEPTED: 'Accepted by the client',
  REJECTED: 'Declined by the client',
};

function errorMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this proposal. The page is refreshed: check it and try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function ReviewHistory({
  reviews,
  timeZone,
}: {
  reviews: ProposalReviewEntry[];
  timeZone: string;
}) {
  if (reviews.length === 0) return <p className="text-sm text-muted">No reviews yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {reviews.map((r) => (
        <li key={r.id} className="text-sm">
          <p className="text-text">
            <span className="font-medium">{DECISION_LABEL[r.decision]}</span> by {r.actor.name}
            {r.kind === 'CLIENT' ? ' (client)' : ''}
          </p>
          <p className="tabular text-xs text-muted">{formatDateTime(r.occurredAt, timeZone)}</p>
          {r.comment ? (
            <p className="mt-1 whitespace-pre-line rounded-md bg-surface-alt px-3 py-2 text-[13px] text-text">
              {r.comment}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type Pending = 'submit' | 'approve' | 'changes' | 'send' | 'revise' | null;

function Workflow({ proposal, shown }: { proposal: ProposalDetail; shown: ProposalVersionView }) {
  const perms = useProposalPermissions();
  const action = useProposalAction(proposal.id);
  const [open, setOpen] = useState<Pending>(null);
  const isCurrent = shown.id === proposal.current.id;
  const status = shown.displayStatus;
  const run = (a: Parameters<typeof action.mutate>[0], success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setOpen(null);
      },
    });
  const dialogError = action.error ? errorMessage(action.error) : null;
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      action.reset();
    }
  };
  const hasOpenVersion = proposal.versions.some((v) =>
    ['DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL'].includes(v.status),
  );
  const canRevise =
    perms.write &&
    proposal.deal.status === 'OPEN' &&
    proposal.status !== 'ACCEPTED' &&
    !hasOpenVersion;
  const portal = proposal.clientOrg;

  let body: React.ReactNode = null;
  if (!isCurrent) {
    body = <p className="text-sm text-muted">This is an earlier version. It cannot change.</p>;
  } else if (status === 'DRAFT') {
    body = (
      <>
        <p className="text-sm text-muted">
          Save the draft, then submit it. A sales manager approves it before the client can see it.
        </p>
        {perms.write ? (
          <Button onClick={() => setOpen('submit')} disabled={shown.items.length === 0}>
            Submit for review
          </Button>
        ) : null}
        {shown.items.length === 0 ? (
          <p className="text-xs text-muted">Add and save at least one line first.</p>
        ) : null}
      </>
    );
  } else if (status === 'IN_REVIEW') {
    body = perms.approve ? (
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setOpen('approve')}>Approve</Button>
        <Button variant="secondary" onClick={() => setOpen('changes')}>
          Request changes
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted">
        Waiting for an owner, admin or sales manager to review it.
      </p>
    );
  } else if (status === 'APPROVED_INTERNAL') {
    body = (
      <>
        {portal && portal.activePortalUsers > 0 ? (
          <p className="text-sm text-muted">
            Ready to send to {portal.activePortalUsers} portal{' '}
            {portal.activePortalUsers === 1 ? 'user' : 'users'} at {portal.name}. They get an email
            with a sign-in link, not the proposal itself.
          </p>
        ) : (
          <Banner tone="warning" title="Client portal not set up">
            Invite someone at the client to the portal from{' '}
            <Link className="font-medium underline" to={`/app/leads/${proposal.contact.id}`}>
              {proposal.contact.fullName}’s page
            </Link>{' '}
            before sending.
          </Banner>
        )}
        {perms.write ? (
          <Button
            onClick={() => setOpen('send')}
            disabled={!portal || portal.activePortalUsers === 0}
          >
            Send to client
          </Button>
        ) : null}
      </>
    );
  } else if (status === 'ACCEPTED') {
    body = (
      <Banner tone="success" title="Accepted by the client">
        The deal is won. This version is the agreed scope. {OPERATIONAL_APPROVAL_NOTICE}
      </Banner>
    );
  } else {
    const messages: Partial<Record<typeof status, string>> = {
      SENT: 'Waiting for the client to respond in the portal.',
      EXPIRED: 'This version expired before the client decided. Send a new version.',
      CHANGES_REQUESTED: 'The client asked for changes. Start a new version.',
      REJECTED: 'The client declined this version.',
      SUPERSEDED: 'A newer version replaced this one.',
    };
    body = <p className="text-sm text-muted">{messages[status]}</p>;
  }

  return (
    <Card title="Workflow" className="print:hidden">
      <div className="flex flex-col gap-3">
        {body}
        {isCurrent &&
        canRevise &&
        !['DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL'].includes(shown.status) ? (
          <Button variant="secondary" onClick={() => setOpen('revise')}>
            Create version {proposal.currentVersionNo + 1}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={open === 'submit'}
        onOpenChange={close}
        title="Submit for review?"
        description="The content is locked while it is reviewed. If changes are requested, it becomes editable again."
        confirmLabel="Submit"
        pendingLabel="Submitting…"
        tone="primary"
        pending={action.isPending}
        error={open === 'submit' ? dialogError : null}
        onConfirm={() => run({ kind: 'submit', version: shown.version }, 'Submitted for review')}
      />
      <ConfirmDialog
        open={open === 'approve'}
        onOpenChange={close}
        title="Approve this version?"
        description="It can then be sent to the client. Its content cannot change any more."
        confirmLabel="Approve"
        pendingLabel="Approving…"
        tone="primary"
        pending={action.isPending}
        error={open === 'approve' ? dialogError : null}
        onConfirm={() =>
          run({ kind: 'review', body: { version: shown.version, decision: 'APPROVE' } }, 'Approved')
        }
      />
      <ReasonDialog
        open={open === 'changes'}
        onOpenChange={close}
        title="Request changes?"
        description="The draft goes back to its author with your comment."
        label="What needs to change?"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        pending={action.isPending}
        error={open === 'changes' ? dialogError : null}
        onConfirm={(comment) =>
          run(
            {
              kind: 'review',
              body: { version: shown.version, decision: 'REQUEST_CHANGES', comment },
            },
            'Sent back for changes',
          )
        }
      />
      <ConfirmDialog
        open={open === 'send'}
        onOpenChange={close}
        title="Send to the client?"
        description={`Portal users at ${portal?.name ?? 'the client'} can review and accept this version. Any earlier sent version can no longer be accepted.`}
        confirmLabel="Send"
        pendingLabel="Sending…"
        tone="primary"
        pending={action.isPending}
        error={open === 'send' ? dialogError : null}
        onConfirm={() => run({ kind: 'send', version: shown.version }, 'Sent to the client portal')}
      />
      <ConfirmDialog
        open={open === 'revise'}
        onOpenChange={close}
        title={`Create version ${proposal.currentVersionNo + 1}?`}
        description="It starts as a copy of the latest version. Earlier versions stay exactly as they were."
        confirmLabel="Create version"
        pendingLabel="Creating…"
        tone="primary"
        pending={action.isPending}
        error={open === 'revise' ? dialogError : null}
        onConfirm={() => run({ kind: 'revise', version: proposal.version }, 'New version started')}
      />
    </Card>
  );
}

export function ProposalDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const perms = useProposalPermissions();
  const query = useProposal(id);
  const [picked, setPicked] = useState<number | null>(null);
  const other = useProposalVersion(id, picked);
  const error = query.error instanceof ApiError ? query.error : null;

  const back = (
    <Link
      to="/app/proposals"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back to proposals
    </Link>
  );

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-72" />
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
          description="This proposal does not exist or belongs to a deal you cannot see."
        />
      </>
    );
  }
  if (error?.status === 403) {
    return (
      <>
        {back}
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="Proposals are not part of your role"
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

  const proposal = query.data.data;
  const viewingOther = picked !== null && picked !== proposal.current.versionNo;
  const shown: ProposalVersionView | undefined = viewingOther ? other.data?.data : proposal.current;
  const editable = !viewingOther && proposal.current.status === 'DRAFT' && perms.write;
  const accepted = shown?.reviews.find((r) => r.kind === 'CLIENT' && r.decision === 'ACCEPTED');

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted print:hidden">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link to="/app/proposals" className="hover:text-text">
              Proposals
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="tabular min-w-0 truncate text-text">
            {proposal.reference}
          </li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-col gap-3 print:hidden md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
              {proposal.title}
            </h1>
            <ProposalStatusBadge status={proposal.displayStatus} />
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular">{proposal.reference}</span> · Deal{' '}
            <Link
              to={`/app/deals/${proposal.deal.id}`}
              className="font-medium text-primary-strong hover:underline"
            >
              {proposal.deal.title}
            </Link>{' '}
            · {proposal.contact.fullName}
            {proposal.contact.companyName ? ` (${proposal.contact.companyName})` : ''}
          </p>
          <p className="mt-2 text-[22px] font-semibold text-text">
            <Money minor={proposal.totalMinor} currency={proposal.currency} />
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="version-picker" className="text-[13px] font-medium text-text">
              Version
            </label>
            <Select
              id="version-picker"
              className="mt-1.5 w-auto min-w-[200px]"
              value={String(picked ?? proposal.current.versionNo)}
              onChange={(e) => setPicked(Number(e.target.value))}
            >
              {proposal.versions.map((v) => (
                <option key={v.id} value={v.versionNo}>
                  Version {v.versionNo} · {v.displayStatus.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" onClick={() => window.print()} disabled={!shown || editable}>
            <Printer aria-hidden className="size-4" /> Print
          </Button>
        </div>
      </header>

      {!shown ? (
        <Skeleton className="mt-6 h-96 rounded-lg" />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] print:mt-0 print:block">
          <div className="flex min-w-0 flex-col gap-6">
            {editable ? (
              <ProposalEditor key={proposal.current.id} proposal={proposal} />
            ) : (
              <>
                <Card className="print:border-0 print:shadow-none">
                  <ProposalDocument
                    content={shown}
                    reference={proposal.reference}
                    timeZone={timeZone}
                    header={
                      <>
                        <p className="text-sm text-muted">
                          For {proposal.contact.fullName}
                          {proposal.contact.companyName
                            ? `, ${proposal.contact.companyName}`
                            : ''}{' '}
                          · From {user?.agency.name}
                        </p>
                        {accepted ? (
                          <p className="mt-2 text-sm font-medium text-success">
                            Accepted by {accepted.actor.name} on{' '}
                            {formatDateTime(accepted.occurredAt, timeZone)} (operational approval,
                            not an e-signature)
                          </p>
                        ) : null}
                      </>
                    }
                  />
                </Card>
                {shown.internalNotes ? (
                  <Card title="Internal notes" className="print:hidden">
                    <p className="whitespace-pre-line text-sm text-text">{shown.internalNotes}</p>
                  </Card>
                ) : null}
              </>
            )}
          </div>
          <div className="flex flex-col gap-6 print:hidden">
            <Workflow proposal={proposal} shown={shown} />
            <Card title="Review history">
              <ReviewHistory reviews={shown.reviews} timeZone={timeZone} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
