import * as RadixDialog from '@radix-ui/react-dialog';
import { Link } from 'react-router';
import { ArrowUpRight, X } from 'lucide-react';
import type { BoardColumn, DealSummary } from '@clientflow/contracts';
import { cn, formatDate, formatDateTime } from '../../lib/format';
import { dealSignals, daysLabel, signalReason } from '../../lib/deal-signals';
import { Avatar } from '../../components/ui/brand';
import { Badge, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Fact } from '../../components/ui/page';
import { DealStatusBadge, Money } from '../../components/sales/sales-ui';
import { NextAction } from '../leads/LeadsListPage';
import { useDeal } from './api';

const HISTORY_EVENTS = new Set([
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'deal.reopened',
]);

/**
 * Quick view of one deal beside the board: the facts a salesperson needs before a call, the stage
 * history (from `deal.stage_changed` activities), and the stage control. The full record stays on
 * /app/deals/:id; this drawer never edits anything the board cannot.
 */
export function DealDrawer({
  dealId,
  columns,
  timeZone,
  onClose,
  onMove,
  moving,
}: {
  dealId: string | null;
  columns: BoardColumn[];
  timeZone: string;
  onClose: () => void;
  onMove: (deal: DealSummary, stageId: string) => void;
  moving: boolean;
}) {
  return (
    <RadixDialog.Root open={!!dealId} onOpenChange={(o) => (o ? undefined : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40 [animation:cf-fade-in_200ms_var(--ease-out)]" />
        <RadixDialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(440px,100vw)] flex-col bg-surface shadow-pop [animation:cf-slide-in-right_260ms_var(--ease-drawer)] focus:outline-none">
          {dealId ? (
            <DrawerBody
              id={dealId}
              columns={columns}
              timeZone={timeZone}
              onMove={onMove}
              moving={moving}
            />
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DrawerBody({
  id,
  columns,
  timeZone,
  onMove,
  moving,
}: {
  id: string;
  columns: BoardColumn[];
  timeZone: string;
  onMove: (deal: DealSummary, stageId: string) => void;
  moving: boolean;
}) {
  const q = useDeal(id);
  const close = (
    <RadixDialog.Close
      aria-label="Close quick view"
      className="press grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-alt hover:text-ink"
    >
      <X aria-hidden className="size-5" />
    </RadixDialog.Close>
  );
  if (q.isPending) {
    return (
      <>
        <RadixDialog.Title className="sr-only">Loading deal</RadixDialog.Title>
        <RadixDialog.Description className="sr-only">
          Loading the deal summary.
        </RadixDialog.Description>
        <div className="flex justify-end p-3">{close}</div>
        <div className="flex flex-col gap-3 px-6" aria-hidden>
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-4 h-32" />
          <Skeleton className="h-48" />
        </div>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <RadixDialog.Title className="sr-only">Deal not available</RadixDialog.Title>
        <RadixDialog.Description className="sr-only">{q.error.message}</RadixDialog.Description>
        <div className="flex justify-end p-3">{close}</div>
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} retrying={q.isFetching} />
      </>
    );
  }
  const deal = q.data.data;
  const s = dealSignals(deal);
  const reason = signalReason(s);
  const history = deal.activities.filter((a) => HISTORY_EVENTS.has(a.eventType));
  const recent = deal.activities.slice(0, 5);
  return (
    <>
      <header className="flex items-start gap-3 border-b border-border px-6 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <RadixDialog.Title className="break-words text-xl font-[640] leading-7 tracking-[-0.02em] text-ink">
            {deal.title}
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-0.5 text-[13px] text-muted">
            {deal.contact.companyName
              ? `${deal.contact.fullName}, ${deal.contact.companyName}`
              : deal.contact.fullName}
          </RadixDialog.Description>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {deal.status === 'OPEN' ? (
              <Badge tone="primary">{deal.stage.name}</Badge>
            ) : (
              <DealStatusBadge status={deal.status} />
            )}
            {reason ? <Badge tone={s.stalled ? 'danger' : 'warning'}>{reason}</Badge> : null}
          </div>
        </div>
        {close}
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <p className="figure text-[28px] leading-9">
          <Money minor={deal.amountMinor} currency={deal.currency} />
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Owner">
            <span className="flex items-center gap-2">
              <Avatar name={deal.owner.name} size="sm" />
              <span className="truncate">{deal.owner.name}</span>
            </span>
          </Fact>
          {deal.status === 'OPEN' ? (
            <Fact label="Next step">
              <span className="flex flex-col gap-0.5">
                {deal.nextStep ? <span className="text-ink">{deal.nextStep}</span> : null}
                <NextAction iso={deal.nextStepAt} timeZone={timeZone} />
              </span>
            </Fact>
          ) : (
            <Fact label={deal.status === 'WON' ? 'Won on' : 'Lost on'}>
              {deal.closedAt ? formatDate(deal.closedAt, timeZone) : 'Not recorded'}
            </Fact>
          )}
          {deal.expectedCloseOn && deal.status === 'OPEN' ? (
            <Fact label="Expected close">
              {formatDate(`${deal.expectedCloseOn}T12:00:00Z`, timeZone)}
            </Fact>
          ) : null}
          {deal.status === 'OPEN' ? (
            <>
              <Fact label="Open for">
                <span className="tabular">{daysLabel(s.ageDays)}</span>
              </Fact>
              <Fact label="Last change">
                <span className="tabular">
                  {s.idleDays === 0 ? 'Today' : `${daysLabel(s.idleDays)} ago`}
                </span>
              </Fact>
            </>
          ) : null}
        </dl>

        {deal.status === 'OPEN' ? (
          <div className="mt-5">
            <label
              htmlFor={`drawer-move-${deal.id}`}
              className="mb-1.5 block text-[13px] font-medium text-ink"
            >
              Stage
            </label>
            <select
              id={`drawer-move-${deal.id}`}
              value={deal.stage.id}
              disabled={moving}
              onChange={(e) => onMove(deal, e.target.value)}
              className="h-11 w-full rounded-md border border-control bg-surface px-3 text-sm text-ink hover:border-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === deal.stage.id ? `In ${c.name}` : `Move to ${c.name}`}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <section aria-labelledby="drawer-history" className="mt-7">
          <h3 id="drawer-history" className="text-[13px] font-semibold text-ink">
            Stage history
          </h3>
          {history.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">No stage moves recorded yet.</p>
          ) : (
            <ol className="relative mt-3 flex flex-col gap-3 border-l border-border-strong pl-4">
              {history.map((a) => (
                <li key={a.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary"
                  />
                  <p className="text-[13px] text-ink">{a.summary}</p>
                  <p className="text-xs text-muted tabular">
                    {formatDateTime(a.occurredAt, timeZone)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="drawer-recent" className="mt-7">
          <h3 id="drawer-recent" className="text-[13px] font-semibold text-ink">
            Latest activity
          </h3>
          {recent.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">Nothing logged yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {recent.map((a) => (
                <li key={a.id} className="py-2">
                  <p className="text-[13px] text-ink">{a.summary}</p>
                  {a.body ? (
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted">
                      {a.body}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted tabular">
                    {formatDateTime(a.occurredAt, timeZone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
        <Link
          to={`/app/deals/${deal.id}`}
          className="press inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Open deal <ArrowUpRight aria-hidden className="size-4" />
        </Link>
        <Link
          to={`/app/leads/${deal.contact.id}`}
          className={cn(
            'press inline-flex h-10 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-ink hover:border-subtle',
          )}
        >
          Open {deal.contact.fullName}
        </Link>
      </footer>
    </>
  );
}
