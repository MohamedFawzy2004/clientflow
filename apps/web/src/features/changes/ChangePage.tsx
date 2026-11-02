import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, SearchX, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMinutes,
  formatMoney,
  minorToDecimalString,
  type ChangeDetail,
  type ChangeVersionView,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Textarea } from '../../components/ui/form';
import { ReasonDialog } from '../../components/sales/sales-ui';
import { Card } from '../../components/proposals/proposal-ui';
import { ChangeStatusBadge } from '../../components/projects/delivery-ui';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useChange, useChangeAction } from './api';
import { changeMessage } from './ChangesPage';
import { CommentsThread } from './CommentsThread';

/** The project manager's estimate (FR-S02): scope delta, effort, price, date, work items. */
function EstimateForm({ c }: { c: ChangeDetail }) {
  const draft = c.versions[0]?.status === 'DRAFT' ? c.versions[0] : undefined;
  const action = useChangeAction();
  const [scope, setScope] = useState(draft?.scope ?? '');
  const [workItems, setWorkItems] = useState(draft?.workItems.join('\n') ?? '');
  const [hours, setHours] = useState(
    draft?.estimateMinutes ? String(draft.estimateMinutes / 60) : '',
  );
  const [price, setPrice] = useState(
    draft ? minorToDecimalString(draft.priceMinor, c.currency) : '',
  );
  const [newDueOn, setNewDueOn] = useState(draft?.newDueOn ?? '');
  const [touched, setTouched] = useState(false);
  const hoursValue = hours.trim() ? Number(hours.replace(',', '.')) : null;
  const hoursError =
    hoursValue !== null && (!Number.isFinite(hoursValue) || hoursValue < 0)
      ? 'Use hours, e.g. 20 or 7.5.'
      : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (scope.trim().length < 3 || hoursError) return;
    action.mutate(
      {
        kind: 'draft',
        id: c.id,
        body: {
          version: c.version,
          scope: scope.trim(),
          workItems: workItems.trim() || null,
          estimateMinutes: hoursValue === null ? null : Math.round(hoursValue * 60),
          price: price.trim() || '0',
          newDueOn: newDueOn || null,
        },
      },
      { onSuccess: () => toast.success('Estimate saved') },
    );
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
      {action.error ? (
        <Banner tone="danger" title="Not saved" className="sm:col-span-2">
          {changeMessage(action.error)}
        </Banner>
      ) : null}
      <Field
        label="Scope change"
        required
        className="sm:col-span-2"
        hint="What is added, changed or removed. The client sees this."
        error={touched && scope.trim().length < 3 ? 'Say what changes in the scope.' : undefined}
      >
        {(fp) => (
          <Textarea
            {...fp}
            rows={4}
            maxLength={5000}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Work items"
        className="sm:col-span-2"
        hint="One per line. Each becomes a task when the client accepts."
      >
        {(fp) => (
          <Textarea
            {...fp}
            rows={3}
            maxLength={5000}
            value={workItems}
            onChange={(e) => setWorkItems(e.target.value)}
          />
        )}
      </Field>
      <Field label={`Price excl. tax (${c.currency})`} hint="0 for changes that only move dates.">
        {(fp) => (
          <Input
            {...fp}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        )}
      </Field>
      <Field label="Effort (hours)" hint="Internal: never shown to the client." error={hoursError}>
        {(fp) => (
          <Input
            {...fp}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        )}
      </Field>
      <Field label="New project due date" hint="Leave empty if the date stays.">
        {(fp) => (
          <Input
            {...fp}
            type="date"
            value={newDueOn}
            onChange={(e) => setNewDueOn(e.target.value)}
          />
        )}
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" loading={action.isPending} loadingLabel="Saving…">
          Save estimate
        </Button>
      </div>
    </form>
  );
}

const VERSION_LABELS: Record<ChangeVersionView['status'], string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In internal review',
  APPROVED_INTERNAL: 'Approved internally',
  SENT: 'With the client',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
  WITHDRAWN: 'Withdrawn',
};

function Version({ v, timeZone }: { v: ChangeVersionView; timeZone: string }) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">Version {v.versionNo}</p>
        <Badge
          tone={
            v.status === 'ACCEPTED' ? 'success' : v.status === 'REJECTED' ? 'danger' : 'neutral'
          }
        >
          {VERSION_LABELS[v.status]}
        </Badge>
      </div>
      <p className="whitespace-pre-line break-words text-sm text-text">{v.scope}</p>
      {v.workItems.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-text">
          {v.workItems.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-text">
        <span className="font-semibold">{formatMoney(v.priceMinor, v.currency)}</span> excl. tax ·
        tax {formatMoney(v.taxMinor, v.currency)} · total {formatMoney(v.totalMinor, v.currency)}
        {v.newDueOn ? ` · new due date ${formatDay(v.newDueOn, timeZone)}` : ''}
      </p>
      <p className="text-xs text-muted">
        {v.estimateMinutes !== null
          ? `Effort ${formatMinutes(v.estimateMinutes)} (internal) · `
          : ''}
        by {v.createdBy.name}
        {v.approvedAt
          ? ` · approved by ${v.approvedBy} ${formatDateTime(v.approvedAt, timeZone)}`
          : ''}
        {v.sentAt ? ` · sent ${formatDateTime(v.sentAt, timeZone)}` : ''}
      </p>
      {v.decision ? (
        <p className="rounded-md bg-surface-alt px-3 py-2 text-sm text-text">
          {v.decision.by} {v.decision.decision === 'ACCEPTED' ? 'accepted' : 'rejected'} it on{' '}
          {formatDateTime(v.decision.at, timeZone)}
          {v.decision.reason ? `: “${v.decision.reason}”` : '.'}
        </p>
      ) : null}
      {v.effect ? (
        <p className="text-sm text-success">
          Budget {formatMoney(v.effect.budgetBeforeMinor, v.currency)} →{' '}
          {formatMoney(v.effect.budgetAfterMinor, v.currency)}
          {v.newDueOn && v.effect.dueBefore
            ? `; due ${formatDay(v.effect.dueBefore, timeZone)} → ${formatDay(v.newDueOn, timeZone)}`
            : ''}
        </p>
      ) : null}
    </li>
  );
}

/** One change request: estimate, internal approval, sending, the client's decision and its effect. */
export function ChangePage() {
  const p = useProjectContext();
  const { changeId = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useChange(changeId);
  const action = useChangeAction();
  const [confirm, setConfirm] = useState<'submit' | 'send' | 'approve' | null>(null);
  const [reason, setReason] = useState<'return' | 'withdraw' | null>(null);
  const back = (
    <Link
      to={`/app/projects/${p.id}/changes`}
      className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> All change requests
    </Link>
  );
  if (query.isPending) return <Skeleton className="h-72 rounded-lg" />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Change request not found"
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={changeMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const c = query.data.data;
  const latest = c.versions[0];
  const done = (msg: string) => () => {
    toast.success(msg);
    setConfirm(null);
    setReason(null);
  };
  const run = (kind: 'submit' | 'send' | 'approve') =>
    action.mutate(
      kind === 'approve'
        ? { kind: 'review', id: c.id, version: c.version, decision: 'APPROVE' }
        : { kind, id: c.id, version: c.version },
      {
        onSuccess: done(
          kind === 'submit'
            ? 'Submitted for approval'
            : kind === 'send'
              ? 'Sent to the client'
              : 'Approved for the client',
        ),
      },
    );
  const errorText = action.error ? changeMessage(action.error) : null;
  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card title={`${c.reference} · ${c.title}`} action={<ChangeStatusBadge status={c.status} />}>
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-line break-words text-sm leading-6 text-text">
            {c.description}
          </p>
          {c.justification ? (
            <p className="text-sm text-muted">
              <span className="font-medium text-text">Why: </span>
              {c.justification}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Requested by {c.requestedBy.name}
            {c.requestedBy.client ? ' (client)' : ''}
          </p>
          {c.status === 'IN_REVIEW' && latest?.status === 'IN_REVIEW' ? (
            <Banner tone="warning" title="Waiting for internal approval">
              A priced change is checked by an owner or admin before the client sees it.
            </Banner>
          ) : c.status === 'AWAITING_CLIENT' ? (
            <Banner tone="info" title="With the client">
              Nothing in the project changes until the client accepts version {latest?.versionNo}.
            </Banner>
          ) : c.status === 'ACCEPTED' ? (
            <Banner tone="success" title="Accepted: the baseline was updated">
              The budget, due date and tasks below reflect this change.
            </Banner>
          ) : c.status === 'WITHDRAWN' ? (
            <Banner tone="info" title="Withdrawn">
              {c.withdrawnReason}
            </Banner>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {c.access.submit ? (
              <Button onClick={() => setConfirm('submit')}>Submit for approval</Button>
            ) : null}
            {c.access.review ? (
              <>
                <Button onClick={() => setConfirm('approve')}>Approve for the client</Button>
                <Button variant="secondary" onClick={() => setReason('return')}>
                  Send back
                </Button>
              </>
            ) : null}
            {c.access.send ? (
              <Button onClick={() => setConfirm('send')}>
                <Send aria-hidden className="size-4" /> Send to the client
              </Button>
            ) : null}
            {c.access.withdraw ? (
              <Button variant="ghost" className="text-danger" onClick={() => setReason('withdraw')}>
                Withdraw
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {c.access.estimate ? (
        <Card title={latest ? `Estimate (version ${latest.versionNo}, draft)` : 'Estimate'}>
          <EstimateForm c={c} />
        </Card>
      ) : null}

      {c.versions.length > 0 ? (
        <Card title="Versions">
          <ol className="flex flex-col divide-y divide-border">
            {c.versions.map((v) => (
              <Version key={v.id} v={v} timeZone={timeZone} />
            ))}
          </ol>
        </Card>
      ) : null}

      {c.tasks.length > 0 ? (
        <Card title="Tasks from this change">
          <ul className="flex flex-col gap-1 text-sm text-text">
            {c.tasks.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {p.access.work ? (
        <CommentsThread
          thread={{ entityType: 'change', entityId: c.id, projectId: p.id }}
          readOnly={p.state === 'ARCHIVED'}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === 'send'
            ? `Send version ${latest?.versionNo} to the client?`
            : confirm === 'approve'
              ? 'Approve this change for the client?'
              : 'Submit for approval?'
        }
        description={
          confirm === 'send'
            ? 'It is frozen once sent. The client accepts or rejects this exact version; only acceptance changes the budget, dates and tasks.'
            : confirm === 'approve'
              ? 'The project manager can then send it to the client.'
              : 'An owner or admin reviews the price before the client sees it.'
        }
        confirmLabel={confirm === 'send' ? 'Send' : confirm === 'approve' ? 'Approve' : 'Submit'}
        pendingLabel="Working…"
        tone="primary"
        pending={action.isPending}
        error={confirm ? errorText : null}
        onConfirm={() => confirm && run(confirm)}
      />
      <ReasonDialog
        open={reason === 'return'}
        onOpenChange={(o) => !o && setReason(null)}
        title="Send back for changes?"
        label="What needs to change?"
        confirmLabel="Send back"
        pendingLabel="Sending…"
        pending={action.isPending}
        error={reason === 'return' ? errorText : null}
        onConfirm={(comment) =>
          action.mutate(
            { kind: 'review', id: c.id, version: c.version, decision: 'RETURN', comment },
            { onSuccess: done('Sent back to the project manager') },
          )
        }
      />
      <ReasonDialog
        open={reason === 'withdraw'}
        onOpenChange={(o) => !o && setReason(null)}
        title="Withdraw this change?"
        description="It closes for good. The client sees that it was withdrawn."
        label="Why?"
        confirmLabel="Withdraw"
        pendingLabel="Withdrawing…"
        tone="danger"
        pending={action.isPending}
        error={reason === 'withdraw' ? errorText : null}
        onConfirm={(r) =>
          action.mutate(
            { kind: 'withdraw', id: c.id, version: c.version, reason: r },
            { onSuccess: done('Change withdrawn') },
          )
        }
      />
    </div>
  );
}
