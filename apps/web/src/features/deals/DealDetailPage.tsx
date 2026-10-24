import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ChevronRight, SearchX, ShieldAlert } from 'lucide-react';
import { can, type DealDetail } from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import {
  DealStatusBadge,
  Money,
  ReasonDialog,
  ReassignDialog,
  Timeline,
} from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { NextAction } from '../leads/LeadsListPage';
import { useAssignableOwners, useDeal, useDealAction, usePipeline } from './api';
import { DealFormDialog } from './DealFormDialog';

type Dialog = 'edit' | 'lost' | 'won' | 'reopen' | 'reassign' | null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-text">{children}</dd>
    </div>
  );
}

function errorMessage(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this deal. The page is refreshed: check it and try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function DealActions({ deal, onOpen }: { deal: DealDetail; onOpen: (d: Dialog) => void }) {
  const { data: user } = useSession();
  const pipeline = usePipeline();
  const action = useDealAction(deal.id);
  if (!user) return null;
  const manager = can(user.role, 'sales.reassign');
  const canOverride = can(user.role, 'deals.override_won');

  if (deal.status !== 'OPEN') {
    return (
      <div className="flex flex-col gap-3">
        <Banner
          tone={deal.status === 'WON' ? 'success' : 'info'}
          title={deal.status === 'WON' ? 'This deal is won' : 'This deal is lost'}
        >
          {deal.status === 'WON'
            ? deal.wonOverrideReason
              ? `Confirmed by ${deal.closedBy?.name ?? 'a manager'} without a proposal: ${deal.wonOverrideReason}`
              : `Closed by ${deal.closedBy?.name ?? 'someone'}.`
            : `Reason: ${deal.lostReason ?? 'not recorded'}`}
        </Banner>
        {can(user.role, 'deals.reopen') ? (
          <div>
            <Button variant="secondary" onClick={() => onOpen('reopen')}>
              Reopen deal
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">
            Closed deals are read-only. A sales manager can reopen it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="deal-stage" className="text-[13px] font-medium text-text">
          Stage
        </label>
        <Select
          id="deal-stage"
          className="mt-1.5"
          value={deal.stage.id}
          disabled={action.isPending || !pipeline.data}
          onChange={(e) => {
            const stageId = e.target.value;
            const name = pipeline.data?.data.stages.find((s) => s.id === stageId)?.name;
            action.mutate(
              { kind: 'move', stageId, version: deal.version },
              {
                onSuccess: () => toast.success(`Moved to ${name ?? 'stage'}`),
                onError: (err) => toast.error(errorMessage(err)),
              },
            );
          }}
        >
          {(pipeline.data?.data.stages ?? [deal.stage]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => onOpen('edit')}>
          Edit
        </Button>
        {manager ? (
          <Button variant="secondary" onClick={() => onOpen('reassign')}>
            Reassign
          </Button>
        ) : null}
        <Button
          onClick={() => onOpen('won')}
          disabled={!canOverride}
          title={
            canOverride ? undefined : 'A sales manager confirms wins until proposals are available.'
          }
        >
          Mark won
        </Button>
        <Button variant="secondary" className="text-danger" onClick={() => onOpen('lost')}>
          Mark lost
        </Button>
      </div>
      {!canOverride ? (
        <p className="text-xs leading-[18px] text-muted">
          Winning a deal needs an accepted proposal (coming soon) or a sales manager’s confirmation.
        </p>
      ) : null}
    </div>
  );
}

export function DealDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useDeal(id);
  const action = useDealAction(id);
  const owners = useAssignableOwners();
  const [open, setOpen] = useState<Dialog>(null);
  const error = query.error instanceof ApiError ? query.error : null;

  const back = (
    <Link
      to="/app/deals"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back to deals
    </Link>
  );

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }
  if (error?.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Deal not found"
          description="This deal does not exist or is not assigned to you."
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
          title="Deals are not part of your role"
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

  const deal = query.data.data;
  const run = (a: Parameters<typeof action.mutate>[0], success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setOpen(null);
      },
    });
  const dialogError = action.error ? errorMessage(action.error) : null;
  const closeDialog = (o: boolean) => {
    if (!o) {
      setOpen(null);
      action.reset();
    }
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link to="/app/deals" className="hover:text-text">
              Deals
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate text-text">
            {deal.title}
          </li>
        </ol>
      </nav>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            {deal.title}
          </h1>
          <DealStatusBadge status={deal.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          <Link
            to={`/app/leads/${deal.contact.id}`}
            className="font-medium text-primary-strong hover:underline"
          >
            {deal.contact.fullName}
          </Link>
          {deal.contact.companyName ? ` · ${deal.contact.companyName}` : ''} · Owned by{' '}
          {deal.owner.name}
        </p>
        <p className="mt-3 text-[28px] font-semibold leading-9 tracking-[-0.01em] text-text">
          <Money minor={deal.amountMinor} currency={deal.currency} />
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <section
            aria-label="Actions"
            className="rounded-lg border border-border bg-surface p-4 shadow-card md:p-5"
          >
            <DealActions deal={deal} onOpen={setOpen} />
          </section>
          <section
            aria-label="Details"
            className="rounded-lg border border-border bg-surface shadow-card"
          >
            <h2 className="border-b border-border px-4 py-3.5 text-[15px] font-semibold text-text md:px-5">
              Details
            </h2>
            <dl className="divide-y divide-border px-4 md:px-5">
              <Row label="Stage">{deal.stage.name}</Row>
              <Row label="Next step">
                {deal.nextStep ?? <span className="text-muted">None</span>}
              </Row>
              <Row label="Due">
                {deal.nextStepAt ? (
                  <NextAction iso={deal.nextStepAt} timeZone={timeZone} />
                ) : (
                  <span className="text-muted">Not set</span>
                )}
              </Row>
              <Row label="Expected close">
                {deal.expectedCloseOn ? (
                  formatDate(`${deal.expectedCloseOn}T12:00:00Z`, timeZone)
                ) : (
                  <span className="text-muted">Not set</span>
                )}
              </Row>
              <Row label="Created">
                <span className="tabular">{formatDateTime(deal.createdAt, timeZone)}</span>
              </Row>
            </dl>
          </section>
        </div>
        <section
          aria-label="History"
          className="rounded-lg border border-border bg-surface shadow-card"
        >
          <h2 className="border-b border-border px-4 py-3.5 text-[15px] font-semibold text-text md:px-5">
            History
          </h2>
          <div className="px-4 md:px-5">
            <Timeline entries={deal.activities} timeZone={timeZone} />
          </div>
        </section>
      </div>

      {open === 'edit' ? (
        <DealFormDialog open onOpenChange={(o) => !o && setOpen(null)} deal={deal} />
      ) : null}
      <ReasonDialog
        open={open === 'lost'}
        onOpenChange={closeDialog}
        title="Mark deal as lost?"
        description="The reason helps the team learn why deals are lost."
        label="Why was it lost?"
        hint="e.g. Chose a cheaper vendor, no budget this year"
        confirmLabel="Mark lost"
        pendingLabel="Saving…"
        tone="danger"
        pending={action.isPending}
        error={open === 'lost' ? dialogError : null}
        onConfirm={(reason) =>
          run(
            { kind: 'close', body: { outcome: 'LOST', version: deal.version, reason } },
            'Deal marked lost',
          )
        }
      />
      <ReasonDialog
        open={open === 'won'}
        onOpenChange={closeDialog}
        title="Confirm this win without a proposal?"
        description="Normally a deal is won when the client accepts a proposal. Record why you are confirming it directly."
        label="Why is it won?"
        hint="e.g. Signed purchase order received by email on 24 Oct"
        confirmLabel="Mark won"
        pendingLabel="Saving…"
        pending={action.isPending}
        error={open === 'won' ? dialogError : null}
        onConfirm={(reason) =>
          run(
            {
              kind: 'close',
              body: { outcome: 'WON', version: deal.version, overrideReason: reason },
            },
            'Deal won',
          )
        }
      />
      <ReasonDialog
        open={open === 'reopen'}
        onOpenChange={closeDialog}
        title="Reopen this deal?"
        label="Why reopen it?"
        confirmLabel="Reopen"
        pendingLabel="Reopening…"
        pending={action.isPending}
        error={open === 'reopen' ? dialogError : null}
        onConfirm={(reason) =>
          run({ kind: 'reopen', version: deal.version, reason }, 'Deal reopened')
        }
      />
      {open === 'reassign' ? (
        <ReassignDialog
          open
          onOpenChange={closeDialog}
          what="deal"
          currentOwnerId={deal.owner.id}
          owners={owners.data?.data ?? [deal.owner]}
          pending={action.isPending}
          error={dialogError}
          onConfirm={(ownerId) =>
            run({ kind: 'reassign', ownerId, version: deal.version }, 'Deal reassigned')
          }
        />
      ) : null}
    </>
  );
}
