import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Plus, SearchX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeProposalTotals,
  formatMoney,
  formatQuantity,
  minorToDecimalString,
  parseMoneyToMinor,
  parseQuantityToCenti,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type InvoiceDetail,
  type InvoiceItemInput,
  type PaymentMethod,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatDay, todayIn } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { ReasonDialog } from '../../components/sales/sales-ui';
import { Card } from '../../components/proposals/proposal-ui';
import { InvoiceStatusBadge, NOT_ACCOUNTING_NOTICE } from '../../components/finance/finance-ui';
import { useSession } from '../auth/session';
import { useFinancePermissions, useInvoice, useInvoiceAction, useProjectFinance } from './api';
import { ProjectMoney } from './ProjectMoney';
import { invoiceMessage } from './InvoicesPage';

type Line = InvoiceItemInput & { key: string };

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '',
  source: 'OTHER',
  sourceId: null,
});

/** Drafts are edited freely; totals are recomputed exactly here and again on the server. */
function DraftEditor({ inv }: { inv: InvoiceDetail }) {
  const action = useInvoiceAction();
  const finance = useProjectFinance(inv.project?.id ?? null);
  const billable = finance.data?.data.billable ?? null;
  const [dueOn, setDueOn] = useState(inv.dueOn);
  const [tax, setTax] = useState(String(inv.taxRateBp / 100));
  const [terms, setTerms] = useState(inv.terms ?? '');
  const [note, setNote] = useState(inv.internalNote ?? '');
  const [lines, setLines] = useState<Line[]>(
    inv.items.length
      ? inv.items.map((i) => ({
          key: i.id,
          description: i.description,
          quantity: i.quantity,
          unitPrice: minorToDecimalString(i.unitPriceMinor, inv.currency),
          source: i.source,
          sourceId: i.sourceId,
        }))
      : [blankLine()],
  );
  const [pick, setPick] = useState('');
  const preview = useMemo(() => {
    const items = lines.map((l) => ({
      quantityCenti: parseQuantityToCenti(l.quantity) ?? 0,
      unitPriceMinor: parseMoneyToMinor(l.unitPrice || '0', inv.currency) ?? '0',
    }));
    const bp = Math.round(Number(tax || '0') * 100);
    return computeProposalTotals({ items, discountBp: 0, taxRateBp: Number.isFinite(bp) ? bp : 0 });
  }, [lines, tax, inv.currency]);
  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addFromProject = (value: string) => {
    if (!billable || !value) return;
    const [kind, id] = value.split(':');
    if (kind === 'M') {
      const m = billable.milestones.find((x) => x.id === id)!;
      setLines((ls) => [
        ...ls.filter((l) => l.description || l.unitPrice),
        {
          ...blankLine(),
          description: `Milestone: ${m.title}`,
          source: 'MILESTONE',
          sourceId: m.id,
        },
      ]);
    } else {
      const c = billable.changes.find((x) => x.id === id)!;
      setLines((ls) => [
        ...ls.filter((l) => l.description || l.unitPrice),
        {
          ...blankLine(),
          description: `${c.reference} ${c.title}`,
          unitPrice: minorToDecimalString(c.priceMinor, inv.currency),
          source: 'CHANGE',
          sourceId: c.id,
        },
      ]);
    }
    setPick('');
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(
      {
        kind: 'draft',
        id: inv.id,
        body: {
          version: inv.version,
          dueOn,
          taxRatePercent: tax || '0',
          terms: terms.trim() || null,
          internalNote: note.trim() || null,
          items: lines
            .filter((l) => l.description.trim() || l.unitPrice.trim())
            .map(({ key: _key, ...l }) => ({ ...l, description: l.description.trim() })),
        },
      },
      { onSuccess: () => toast.success('Draft saved') },
    );
  };
  return (
    <Card title="Draft">
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        {action.error ? (
          <Banner tone="danger" title="Not saved">
            {invoiceMessage(action.error)}
          </Banner>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Due" required>
            {(fp) => (
              <Input {...fp} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            )}
          </Field>
          <Field label="Tax (%)" required hint="Prices are excluding tax.">
            {(fp) => (
              <Input
                {...fp}
                inputMode="decimal"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            )}
          </Field>
        </div>
        {billable ? (
          <div>
            <label htmlFor="add-billable" className="text-[13px] font-medium text-text">
              Add from the project
            </label>
            <Select
              id="add-billable"
              className="mt-1.5"
              value={pick}
              onChange={(e) => addFromProject(e.target.value)}
            >
              <option value="">Choose a milestone or accepted change…</option>
              {billable.milestones.map((m) => (
                <option key={m.id} value={`M:${m.id}`}>
                  Milestone: {m.title}
                  {m.invoiced ? ' (already invoiced)' : ''}
                </option>
              ))}
              {billable.changes.map((c) => (
                <option key={c.id} value={`C:${c.id}`}>
                  {c.reference} {c.title} · {formatMoney(c.priceMinor, inv.currency)}
                  {c.invoiced ? ' (already invoiced)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[13px] font-semibold text-text">Lines</legend>
          {lines.map((l, n) => (
            <div
              key={l.key}
              className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_96px_140px_auto]"
            >
              <div>
                <label htmlFor={`desc-${l.key}`} className="text-xs text-muted">
                  Line {n + 1} description
                </label>
                <Input
                  id={`desc-${l.key}`}
                  maxLength={500}
                  value={l.description}
                  onChange={(e) => update(l.key, { description: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`qty-${l.key}`} className="text-xs text-muted">
                  Quantity
                </label>
                <Input
                  id={`qty-${l.key}`}
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`price-${l.key}`} className="text-xs text-muted">
                  Unit price ({inv.currency})
                </label>
                <Input
                  id={`price-${l.key}`}
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                />
              </div>
              <div className="flex items-end justify-between gap-2 sm:justify-end">
                <span className="text-sm tabular-nums text-text sm:hidden">
                  {formatMoney(preview.lineTotalsMinor[n] ?? '0', inv.currency)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="size-10 px-0 text-danger"
                  aria-label={`Remove line ${n + 1}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
              {l.source !== 'OTHER' ? (
                <p className="text-xs text-muted sm:col-span-4">
                  Bills the project's {l.source === 'MILESTONE' ? 'milestone' : 'accepted change'}.
                </p>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
            >
              <Plus aria-hidden className="size-4" /> Add line
            </Button>
          </div>
        </fieldset>
        <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(preview.subtotalMinor, inv.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Tax</dt>
            <dd className="tabular-nums">{formatMoney(preview.taxMinor, inv.currency)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(preview.totalMinor, inv.currency)}</dd>
          </div>
        </dl>
        <Field
          label="Payment terms"
          hint="Shown to the client, e.g. bank details and days to pay. Never card numbers."
        >
          {(fp) => (
            <Textarea
              {...fp}
              rows={2}
              maxLength={2000}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          )}
        </Field>
        <Field label="Internal note" hint="Finance only. Never shown to the client.">
          {(fp) => (
            <Input
              {...fp}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button
            type="submit"
            variant="secondary"
            loading={action.isPending}
            loadingLabel="Saving…"
          >
            Save draft
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Lines({ inv }: { inv: InvoiceDetail }) {
  return (
    <Card title="Lines">
      <ul className="flex flex-col divide-y divide-border">
        {inv.items.map((i) => (
          <li
            key={i.id}
            className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0"
          >
            <span className="min-w-0">
              <span className="block break-words text-text">{i.description}</span>
              <span className="text-xs text-muted">
                {formatQuantity(i.quantityCenti)} × {formatMoney(i.unitPriceMinor, inv.currency)}
              </span>
            </span>
            <span className="tabular-nums text-text">
              {formatMoney(i.lineTotalMinor, inv.currency)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="ml-auto mt-3 grid w-full max-w-xs gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(inv.subtotalMinor, inv.currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Tax ({inv.taxRateBp / 100}%)</dt>
          <dd className="tabular-nums">{formatMoney(inv.taxMinor, inv.currency)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(inv.totalMinor, inv.currency)}</dd>
        </div>
      </dl>
      {inv.terms ? (
        <p className="mt-3 whitespace-pre-line break-words text-sm text-muted">{inv.terms}</p>
      ) : null}
    </Card>
  );
}

/** Confirmed payments (FR-F03). One idempotency key per form, so a retry never pays twice. */
function Payments({ inv, timeZone }: { inv: InvoiceDetail; timeZone: string }) {
  const action = useInvoiceAction();
  const canPay = useFinancePermissions().pay;
  const [key, setKey] = useState(() => crypto.randomUUID());
  const balance = BigInt(inv.balanceMinor);
  const [amount, setAmount] = useState(minorToDecimalString(balance, inv.currency));
  const [receivedOn, setReceivedOn] = useState(todayIn(timeZone));
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [reversing, setReversing] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(
      {
        kind: 'pay',
        id: inv.id,
        key,
        body: {
          amount,
          receivedOn,
          method,
          reference: reference.trim() || null,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Payment recorded');
          setKey(crypto.randomUUID());
          setReference('');
          setNote('');
        },
        onError: (err) => toast.error(invoiceMessage(err)),
      },
    );
  };
  return (
    <Card title="Payments">
      {inv.payments.length === 0 ? (
        <p className="text-sm text-muted">No payments recorded.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {inv.payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="text-text">
                  {p.kind === 'REVERSAL' ? '− ' : ''}
                  {formatMoney(p.amountMinor, inv.currency)} · {formatDay(p.receivedOn, timeZone)} ·{' '}
                  {PAYMENT_METHOD_LABELS[p.method]}
                  {p.reference ? ` · ${p.reference}` : ''}
                </span>
                <span className="block text-xs text-muted">
                  {p.kind === 'REVERSAL' ? 'Reversal' : 'Payment'} recorded by {p.recordedBy},{' '}
                  {formatDateTime(p.createdAt, timeZone)}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {p.reversedBy ? <Badge>Reversed</Badge> : null}
                {canPay && p.kind === 'PAYMENT' && !p.reversedBy && inv.status !== 'VOID' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label={`Reverse payment of ${formatMoney(p.amountMinor, inv.currency)}`}
                    onClick={() => setReversing(p.id)}
                  >
                    Reverse
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {inv.access.recordPayment ? (
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
        >
          <p className="text-[13px] font-semibold text-text sm:col-span-2">
            Record a payment you received ({formatMoney(inv.balanceMinor, inv.currency)} open)
          </p>
          <Field label={`Amount (${inv.currency})`} required>
            {(fp) => (
              <Input
                {...fp}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
          <Field label="Received on" required>
            {(fp) => (
              <Input
                {...fp}
                type="date"
                max={todayIn(timeZone)}
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            )}
          </Field>
          <Field label="Method" required>
            {(fp) => (
              <Select
                {...fp}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reference" hint="Bank or receipt reference. Never a card number.">
            {(fp) => (
              <Input
                {...fp}
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </Field>
          <Field label="Note" className="sm:col-span-2" hint="Internal.">
            {(fp) => (
              <Input
                {...fp}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={action.isPending} loadingLabel="Recording…">
              Record payment
            </Button>
          </div>
        </form>
      ) : null}
      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(o) => !o && setReversing(null)}
        title="Reverse this payment?"
        description="The payment stays in the history with a matching reversal, and the balance reopens."
        label="Why?"
        confirmLabel="Reverse"
        pendingLabel="Reversing…"
        tone="danger"
        pending={action.isPending}
        error={reversing && action.error ? invoiceMessage(action.error) : null}
        onConfirm={(reason) =>
          reversing &&
          action.mutate(
            { kind: 'reverse', id: inv.id, paymentId: reversing, reason },
            {
              onSuccess: () => {
                toast.success('Payment reversed');
                setReversing(null);
              },
            },
          )
        }
      />
    </Card>
  );
}

export function InvoicePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const perms = useFinancePermissions();
  const q = useInvoice(id);
  const action = useInvoiceAction();
  const [confirm, setConfirm] = useState<'issue' | 'publish' | 'delete' | null>(null);
  const [voiding, setVoiding] = useState(false);
  const back = (
    <Link
      to="/app/invoices"
      className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" /> All invoices
    </Link>
  );
  if (q.isPending) return <Skeleton className="h-80 rounded-lg" />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <>
        {back}
        <EmptyState icon={<SearchX aria-hidden className="size-5" />} title="Invoice not found" />
      </>
    );
  }
  if (q.isError) {
    return (
      <ErrorState
        message={invoiceMessage(q.error)}
        onRetry={() => q.refetch()}
        retrying={q.isFetching}
      />
    );
  }
  const inv = q.data.data;
  const run = (kind: 'issue' | 'publish' | 'delete') =>
    action.mutate(
      { kind, id: inv.id, version: inv.version },
      {
        onSuccess: () => {
          setConfirm(null);
          if (kind === 'delete') {
            toast.success('Draft deleted');
            navigate('/app/invoices');
          } else {
            toast.success(kind === 'issue' ? 'Invoice issued' : 'Shown in the client portal');
          }
        },
      },
    );
  return (
    <div className="flex flex-col gap-4">
      {back}
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
              {inv.reference}
            </h1>
            <InvoiceStatusBadge status={inv.displayStatus} />
            {inv.published ? <Badge tone="info">In the client portal</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {inv.clientOrg.name}
            {inv.project ? ` · ${inv.project.title}` : ''}
            {inv.issuedOn ? ` · issued ${formatDay(inv.issuedOn, timeZone)}` : ''} · due{' '}
            {formatDay(inv.dueOn, timeZone)}
          </p>
          <p className="mt-2 text-sm text-text">
            Total{' '}
            <span className="font-semibold tabular-nums">
              {formatMoney(inv.totalMinor, inv.currency)}
            </span>{' '}
            · paid <span className="tabular-nums">{formatMoney(inv.paidMinor, inv.currency)}</span>
            {inv.status !== 'VOID' && inv.status !== 'DRAFT' ? (
              <>
                {' '}
                · open{' '}
                <span className="font-semibold tabular-nums">
                  {formatMoney(inv.balanceMinor, inv.currency)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.access.issue ? (
            <Button onClick={() => setConfirm('issue')}>Issue invoice</Button>
          ) : null}
          {inv.access.publish ? (
            <Button variant="secondary" onClick={() => setConfirm('publish')}>
              Show in client portal
            </Button>
          ) : null}
          {inv.access.edit ? (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirm('delete')}>
              Delete draft
            </Button>
          ) : null}
          {inv.access.void && inv.status !== 'DRAFT' ? (
            <Button variant="ghost" className="text-danger" onClick={() => setVoiding(true)}>
              Void
            </Button>
          ) : null}
        </div>
      </header>
      <p className="text-[13px] text-muted">{NOT_ACCOUNTING_NOTICE}</p>
      {inv.status === 'VOID' ? (
        <Banner tone="info" title="Void">
          {inv.voidReason} The number and history are kept.
        </Banner>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {inv.access.edit ? <DraftEditor key={inv.id} inv={inv} /> : <Lines inv={inv} />}
          {inv.status !== 'DRAFT' ? (
            <Payments key={inv.version} inv={inv} timeZone={timeZone} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {inv.billedTo && inv.issuer ? (
            <Card title="Snapshot">
              <p className="text-sm text-text">
                Billed to <span className="font-medium">{inv.billedTo.name}</span>
                {inv.billedTo.contact ? `, attention ${inv.billedTo.contact}` : ''}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">
                From {inv.issuer.name}
                {inv.issuer.details ? `\n${inv.issuer.details}` : ''}
              </p>
            </Card>
          ) : null}
          {inv.internalNote ? (
            <Card title="Internal note">
              <p className="whitespace-pre-line break-words text-sm text-text">
                {inv.internalNote}
              </p>
            </Card>
          ) : null}
          {inv.project && perms.view ? <ProjectMoney projectId={inv.project.id} /> : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === 'issue'
            ? 'Issue this invoice?'
            : confirm === 'publish'
              ? 'Show it in the client portal?'
              : 'Delete this draft?'
        }
        description={
          confirm === 'issue'
            ? 'It gets the next invoice number, and its lines, customer and totals can no longer change. Save your edits first.'
            : confirm === 'publish'
              ? `People of ${inv.clientOrg.name} with portal access will see it.`
              : 'The draft is removed. No number was used.'
        }
        confirmLabel={confirm === 'issue' ? 'Issue' : confirm === 'publish' ? 'Show' : 'Delete'}
        pendingLabel="Working…"
        tone={confirm === 'delete' ? 'danger' : 'primary'}
        pending={action.isPending}
        error={confirm && action.error ? invoiceMessage(action.error) : null}
        onConfirm={() => confirm && run(confirm)}
      />
      <ReasonDialog
        open={voiding}
        onOpenChange={setVoiding}
        title="Void this invoice?"
        description="It stays in the list with its number and history, and the client no longer owes it."
        label="Why?"
        confirmLabel="Void invoice"
        pendingLabel="Voiding…"
        tone="danger"
        pending={action.isPending}
        error={voiding && action.error ? invoiceMessage(action.error) : null}
        onConfirm={(reason) =>
          action.mutate(
            { kind: 'void', id: inv.id, version: inv.version, reason },
            {
              onSuccess: () => {
                toast.success('Invoice voided');
                setVoiding(false);
              },
            },
          )
        }
      />
    </div>
  );
}
