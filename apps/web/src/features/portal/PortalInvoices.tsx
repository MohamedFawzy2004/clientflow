import { Link, useParams } from 'react-router';
import { ArrowLeft, Receipt, SearchX } from 'lucide-react';
import {
  formatMoney,
  formatQuantity,
  PAYMENT_METHOD_LABELS,
  parseQuantityToCenti,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { InvoiceStatusBadge } from '../../components/finance/finance-ui';
import { useSession } from '../auth/session';
import { usePortalInvoice, usePortalInvoices } from '../invoices/api';

const PAY_NOTICE =
  'Pay the way the terms say. Payments are marked here once the agency confirms them; this portal does not take payments.';

/** Invoices the agency published to this client organization (FR-X03). */
export function PortalInvoicesPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalInvoices();
  const error = query.error instanceof ApiError ? query.error : null;

  let body;
  if (query.isError) {
    body = (
      <ErrorState
        title="We could not load your invoices"
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (query.isPending) {
    body = (
      <div aria-busy className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  } else if (query.data.data.length === 0) {
    body = (
      <EmptyState
        icon={<Receipt aria-hidden className="size-5" />}
        title="No invoices yet"
        description={`Invoices ${user?.agency.name ?? 'the agency'} sends you appear here with what is paid and what is open.`}
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((i) => (
          <li key={i.id} className="relative px-4 py-4 hover:bg-surface-alt/50 md:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/portal/invoices/${i.id}`}
                  className="block break-words font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  <span className="tabular">{i.reference}</span>
                  {i.project ? ` · ${i.project.title}` : ''}
                </Link>
                <p className="mt-0.5 text-[13px] text-muted">
                  Issued {formatDay(i.issuedOn, timeZone)} · due {formatDay(i.dueOn, timeZone)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <InvoiceStatusBadge status={i.displayStatus} />
                <span className="text-right text-sm">
                  <span className="block font-medium tabular-nums text-text">
                    {formatMoney(i.totalMinor, i.currency)}
                  </span>
                  {i.balanceMinor !== '0' && i.displayStatus !== 'VOID' ? (
                    <span className="block text-xs tabular-nums text-muted">
                      {formatMoney(i.balanceMinor, i.currency)} open
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Invoices
      </h1>
      <p className="mt-1 text-sm text-muted">{PAY_NOTICE}</p>
      <section
        aria-label="Your invoices"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {body}
      </section>
    </>
  );
}

export function PortalInvoicePage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const q = usePortalInvoice(id);
  const back = (
    <Link
      to="/portal/invoices"
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
        message={q.error.message}
        requestId={q.error instanceof ApiError ? q.error.requestId : undefined}
        onRetry={() => q.refetch()}
        retrying={q.isFetching}
      />
    );
  }
  const inv = q.data.data;
  return (
    <div className="flex flex-col gap-4">
      {back}
      <header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            {inv.reference}
          </h1>
          <InvoiceStatusBadge status={inv.displayStatus} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {inv.project ? `${inv.project.title} · ` : ''}issued {formatDay(inv.issuedOn, timeZone)} ·
          due {formatDay(inv.dueOn, timeZone)}
        </p>
        <p className="mt-2 text-sm text-text">
          Total{' '}
          <span className="font-semibold tabular-nums">
            {formatMoney(inv.totalMinor, inv.currency)}
          </span>{' '}
          · paid <span className="tabular-nums">{formatMoney(inv.paidMinor, inv.currency)}</span>
          {inv.displayStatus !== 'VOID' ? (
            <>
              {' '}
              · open{' '}
              <span className="font-semibold tabular-nums">
                {formatMoney(inv.balanceMinor, inv.currency)}
              </span>
            </>
          ) : null}
        </p>
      </header>
      <p className="text-[13px] text-muted">{PAY_NOTICE}</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Lines">
          <ul className="flex flex-col divide-y divide-border">
            {inv.items.map((i, n) => (
              <li
                key={n}
                className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0"
              >
                <span className="min-w-0">
                  <span className="block break-words text-text">{i.description}</span>
                  <span className="text-xs text-muted">
                    {formatQuantity(parseQuantityToCenti(i.quantity) ?? 0)} ×{' '}
                    {formatMoney(i.unitPriceMinor, inv.currency)}
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
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Details">
            <p className="text-sm text-text">
              Billed to <span className="font-medium">{inv.billedTo.name}</span>
              {inv.billedTo.contact ? `, attention ${inv.billedTo.contact}` : ''}
            </p>
            <p className="mt-2 whitespace-pre-line text-sm text-muted">
              From {inv.issuer.name}
              {inv.issuer.details ? `\n${inv.issuer.details}` : ''}
            </p>
            {inv.terms ? (
              <p className="mt-3 whitespace-pre-line break-words border-t border-border pt-3 text-sm text-text">
                {inv.terms}
              </p>
            ) : null}
          </Card>
          <Card title="Payments received">
            {inv.payments.length === 0 ? (
              <p className="text-sm text-muted">None confirmed yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {inv.payments.map((p, n) => (
                  <li key={n} className="flex justify-between gap-3">
                    <span className="text-muted">
                      {formatDay(p.receivedOn, timeZone)} · {PAYMENT_METHOD_LABELS[p.method]}
                    </span>
                    <span className="tabular-nums text-text">
                      {formatMoney(p.amountMinor, inv.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
