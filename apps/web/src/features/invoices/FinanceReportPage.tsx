import { useState } from 'react';
import { Link } from 'react-router';
import { BarChart3, Download, ShieldAlert } from 'lucide-react';
import {
  formatMoney,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  type FinanceReportQuery,
  type FinanceTotals,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { Card } from '../../components/proposals/proposal-ui';
import { InvoiceStatusBadge, NOT_ACCOUNTING_NOTICE } from '../../components/finance/finance-ui';
import { useSession } from '../auth/session';
import { exportUrl, useFinanceReport } from './api';
import { invoiceMessage } from './InvoicesPage';

function Totals({ t }: { t: FinanceTotals }) {
  const m = (v: string) => formatMoney(v, t.currency);
  return (
    <Card title={`In ${t.currency}`}>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Invoiced ({t.invoiced.count})</dt>
          <dd className="font-semibold tabular-nums text-text">{m(t.invoiced.totalMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Received</dt>
          <dd className="font-semibold tabular-nums text-text">{m(t.receivedMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Outstanding</dt>
          <dd className="font-semibold tabular-nums text-text">{m(t.outstandingMinor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Overdue ({t.overdue.count})</dt>
          <dd
            className={`font-semibold tabular-nums ${t.overdue.count > 0 ? 'text-danger' : 'text-text'}`}
          >
            {m(t.overdue.balanceMinor)}
          </dd>
        </div>
      </dl>
      <h3 className="mt-4 text-[13px] font-semibold text-text">Open balance by days past due</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        {(
          [
            ['Not yet due', t.aging.current],
            ['1–30 days', t.aging.d1to30],
            ['31–60 days', t.aging.d31to60],
            ['61–90 days', t.aging.d61to90],
            ['Over 90 days', t.aging.over90],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-md bg-surface-alt/60 px-2.5 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular-nums text-text">{m(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Invoiced vs received vs outstanding, per currency (FR-F08, US-14). */
export function FinanceReportPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const filter: FinanceReportQuery = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(status ? { status: status as FinanceReportQuery['status'] } : {}),
  };
  const q = useFinanceReport(filter);
  const error = q.error instanceof ApiError ? q.error : null;
  if (error?.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Finance reports are not part of your role"
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Finance report
          </h1>
          <p className="mt-1 text-sm text-muted">{NOT_ACCOUNTING_NOTICE}</p>
        </div>
        <a
          href={exportUrl(filter)}
          download
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-alt"
        >
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="report-from" className="text-[13px] font-medium text-text">
            Issued from
          </label>
          <Input
            id="report-from"
            type="date"
            className="mt-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="report-to" className="text-[13px] font-medium text-text">
            Issued to
          </label>
          <Input
            id="report-to"
            type="date"
            className="mt-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="report-status" className="text-[13px] font-medium text-text">
            Status
          </label>
          <Select
            id="report-status"
            className="mt-1.5"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {[...INVOICE_STATUSES, 'OVERDUE' as const].map((s) => (
              <option key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {q.isPending ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : q.isError ? (
          <ErrorState
            message={invoiceMessage(q.error)}
            requestId={error?.requestId}
            onRetry={() => q.refetch()}
            retrying={q.isFetching}
          />
        ) : q.data.data.invoices.length === 0 ? (
          <EmptyState
            icon={<BarChart3 aria-hidden className="size-5" />}
            title="No invoices in this range"
            description="Issued invoices and the payments you record are counted here, kept apart by currency."
          />
        ) : (
          <>
            {q.data.data.totals.map((t) => (
              <Totals key={t.currency} t={t} />
            ))}
            <section
              aria-label="Invoices in the report"
              className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
            >
              <ul className="divide-y divide-border">
                {q.data.data.invoices.map((i) => (
                  <li
                    key={i.id}
                    className="relative flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4 md:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/app/invoices/${i.id}`}
                        className="block break-words font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                      >
                        <span className="tabular">{i.reference}</span> · {i.clientOrg.name}
                      </Link>
                      <p className="text-[13px] text-muted">
                        {i.issuedOn ? `issued ${formatDay(i.issuedOn, timeZone)} · ` : ''}due{' '}
                        {formatDay(i.dueOn, timeZone)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <InvoiceStatusBadge status={i.displayStatus} />
                      <span className="tabular-nums text-text">
                        {formatMoney(i.totalMinor, i.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
