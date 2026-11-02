import { useState, type FormEvent } from 'react';
import { Coins, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, formatMoney, type CostRateView, type Currency } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDay, todayIn } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select } from '../../components/ui/form';
import { useSession } from '../auth/session';
import { useCostRates, useFinancePermissions, useSetCostRate } from './api';
import { invoiceMessage } from './InvoicesPage';

function SetRateDialog({
  person,
  timeZone,
  onClose,
}: {
  person: CostRateView;
  timeZone: string;
  onClose: () => void;
}) {
  const save = useSetCostRate();
  const [hourly, setHourly] = useState('');
  const [currency, setCurrency] = useState<Currency>(person.current?.currency ?? 'EGP');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIn(timeZone));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save
      .mutateAsync({ userId: person.user.id, body: { hourly, currency, effectiveFrom } })
      .then(() => {
        toast.success('Cost rate saved');
        onClose();
      })
      .catch(() => undefined);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={`Cost rate for ${person.user.name}`}
      description="An internal hourly cost used to estimate project margin. It is never shown to clients or to the person's teammates."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="cost-rate" loading={save.isPending} loadingLabel="Saving…">
            Save rate
          </Button>
        </>
      }
    >
      {save.error ? (
        <Banner tone="danger" title="Not saved" className="mb-5">
          {invoiceMessage(save.error)}
        </Banner>
      ) : null}
      <form id="cost-rate" onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Hourly cost" required>
          {(fp) => (
            <Input
              {...fp}
              data-autofocus
              inputMode="decimal"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
            />
          )}
        </Field>
        <Field label="Currency" required>
          {(fp) => (
            <Select
              {...fp}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Effective from"
          required
          hint="Time logged from this day uses the new rate."
          className="sm:col-span-2"
        >
          {(fp) => (
            <Input
              {...fp}
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Internal hourly costs per person (FR-F06). Set by Owner/Admin, read by Finance. */
export function CostRatesPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const perms = useFinancePermissions();
  const q = useCostRates();
  const [editing, setEditing] = useState<CostRateView | null>(null);
  const error = q.error instanceof ApiError ? q.error : null;
  if (error?.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Cost rates are not part of your role"
      />
    );
  }
  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Cost rates
      </h1>
      <p className="mt-1 text-sm text-muted">
        Internal hourly costs for estimating margin. Each change starts on a date and keeps the
        earlier rates for earlier time.
      </p>
      <section
        aria-label="People and their cost rates"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {q.isPending ? (
          <div aria-busy className="flex flex-col gap-3 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : q.isError ? (
          <ErrorState
            message={invoiceMessage(q.error)}
            requestId={error?.requestId}
            onRetry={() => q.refetch()}
            retrying={q.isFetching}
          />
        ) : q.data.data.length === 0 ? (
          <EmptyState icon={<Coins aria-hidden className="size-5" />} title="No team members yet" />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.data.map((p) => (
              <li
                key={p.user.id}
                className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-text">{p.user.name}</p>
                  <p className="text-[13px] text-muted">
                    {p.current
                      ? `${formatMoney(p.current.hourlyMinor, p.current.currency)} an hour since ${formatDay(p.current.effectiveFrom, timeZone)}`
                      : 'No rate yet: their time is left out of margin estimates.'}
                  </p>
                  {p.history.length > 1 ? (
                    <details className="mt-1 text-[13px] text-muted">
                      <summary className="cursor-pointer">
                        Rate history ({p.history.length})
                      </summary>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {p.history.map((h) => (
                          <li key={h.effectiveFrom + h.currency}>
                            {formatMoney(h.hourlyMinor, h.currency)} from{' '}
                            {formatDay(h.effectiveFrom, timeZone)}, set by {h.setBy}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                {perms.rates ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Set rate for ${p.user.name}`}
                    onClick={() => setEditing(p)}
                  >
                    Set rate
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? (
        <SetRateDialog person={editing} timeZone={timeZone} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
