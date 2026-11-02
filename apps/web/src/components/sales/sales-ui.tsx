import { useState, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  formatMoney,
  type Currency,
  type DealStatus,
  type TimelineEntry,
} from '@clientflow/contracts';
import { cn, formatDateTime } from '../../lib/format';
import { Badge } from '../ui/feedback';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Banner } from '../ui/feedback';
import { Field, Select, Textarea } from '../ui/form';

/** Exact money from minor units (decimal string), with tabular digits. */
export function Money({
  minor,
  currency,
  className,
}: {
  minor: string;
  currency: Currency;
  className?: string;
}) {
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      {formatMoney(minor, currency)}
    </span>
  );
}

/** Per-currency totals: currencies are listed side by side, never added together. */
export function Totals({
  totals,
  className,
}: {
  totals: Partial<Record<Currency, string>>;
  className?: string;
}) {
  const entries = Object.entries(totals) as Array<[Currency, string]>;
  if (entries.length === 0)
    return <span className={cn('text-muted', className)}>No value yet</span>;
  return (
    <span className={cn('flex flex-wrap gap-x-2 gap-y-0.5', className)}>
      {entries.map(([c, v]) => (
        <Money key={c} minor={v} currency={c} />
      ))}
    </span>
  );
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  if (status === 'WON')
    return (
      <Badge tone="success" icon={<CircleCheck aria-hidden className="size-3.5" />}>
        Won
      </Badge>
    );
  if (status === 'LOST')
    return (
      <Badge tone="neutral" icon={<CircleX aria-hidden className="size-3.5" />}>
        Lost
      </Badge>
    );
  return <Badge tone="info">Open</Badge>;
}

const ICONS: Array<[RegExp, typeof Clock]> = [
  [/^activity\.call/, Phone],
  [/^activity\.email/, Mail],
  [/^activity\.meeting/, Users],
  [/^activity\.note/, MessageSquare],
  [/stage_changed|reassigned/, ArrowRightLeft],
  [/won|converted/, CircleCheck],
  [/lost/, CircleX],
  [/reopened|restored/, RotateCcw],
  [/^deal\./, FileText],
];

function iconFor(eventType: string) {
  return ICONS.find(([re]) => re.test(eventType))?.[1] ?? Clock;
}

/** Timeline entries. Bodies are rendered as text, never HTML (T-SEC-03). */
export function Timeline({
  entries,
  timeZone,
  empty,
}: {
  entries: TimelineEntry[];
  timeZone: string;
  empty?: ReactNode;
}) {
  if (entries.length === 0)
    return <p className="py-4 text-sm text-muted">{empty ?? 'No activity recorded yet.'}</p>;
  return (
    <ol className="relative py-3">
      {entries.map((a, i) => {
        const Icon = iconFor(a.eventType);
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-1">
            {i < entries.length - 1 ? (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-border"
              />
            ) : null}
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong ring-4 ring-surface"
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm text-text">{a.summary}</p>
              {a.body ? (
                <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-alt px-3 py-2 text-[13px] leading-5 text-text">
                  {a.body}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted tabular">
                {formatDateTime(a.occurredAt, timeZone)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Asks for a written reason (lost, won override, reopen). Stays open with the error on failure. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  hint,
  confirmLabel,
  pendingLabel,
  tone = 'primary',
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label: string;
  hint?: string;
  confirmLabel: string;
  pendingLabel: string;
  tone?: 'primary' | 'danger';
  pending: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < 3;
  const close = (o: boolean) => {
    if (pending) return;
    if (!o) {
      setReason('');
      setTouched(false);
    }
    onOpenChange(o);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={pending}
            loadingLabel={pendingLabel}
            onClick={() => {
              setTouched(true);
              if (!tooShort) onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" title="Not saved" className="mb-4">
          {error}
        </Banner>
      ) : null}
      <Field
        label={label}
        required
        hint={hint}
        error={touched && tooShort ? 'Write at least 3 characters.' : undefined}
      >
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-autofocus
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Owner picker for managers (FR-D08). */
export function ReassignDialog({
  open,
  onOpenChange,
  currentOwnerId,
  owners,
  pending,
  error,
  onConfirm,
  what,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentOwnerId: string;
  owners: Array<{ id: string; name: string }>;
  pending: boolean;
  error?: string | null;
  onConfirm: (ownerId: string) => void;
  what: string;
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={`Reassign ${what}`}
      description="The new owner sees it in their lists right away. The change is recorded in the history."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={ownerId === currentOwnerId}
            loading={pending}
            loadingLabel="Saving…"
            onClick={() => onConfirm(ownerId)}
          >
            Reassign
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" title="Not saved" className="mb-4">
          {error}
        </Banner>
      ) : null}
      <Field label="New owner" required>
        {(p) => (
          <Select
            {...p}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            data-autofocus
          >
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.id === currentOwnerId ? ' (current)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Dialog>
  );
}
