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
import { DocumentTitle } from '../../components/ui/page';
import { SEQ } from '../../components/charts/charts';

/** Age buckets run from not yet due to the oldest, so they share one hue, light to dark. */
const AGING_STEPS = [SEQ[0], SEQ[1], SEQ[2], SEQ[3], SEQ[5]] as const;

function Totals({ t }: { t: FinanceTotals }) {
  const m = (v: string) => formatMoney(v, t.currency);
  const buckets = [
    ['Not yet due', t.aging.current],
    ['1–30 days', t.aging.d1to30],
    ['31–60 days', t.aging.d31to60],
    ['61–90 days', t.aging.d61to90],
    ['Over 90 days', t.aging.over90],
  ] as const;
  // Widths only: Number() is precise enough to draw a share, never to show an amount.
  const open = buckets.reduce((s, [, v]) => s + Number(v), 0);
  const figures = [
    { label: `Invoiced (${t.invoiced.count})`, value: t.invoiced.totalMinor, danger: false },
    { label: 'Received', value: t.receivedMinor, danger: false },
    { label: 'Outstanding', value: t.outstandingMinor, danger: false },
    {
      label: `Overdue (${t.overdue.count})`,
      value: t.overdue.balanceMinor,
      danger: t.overdue.count > 0,
    },
  ];
  return (
    <Card title={`In ${t.currency}`}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] text-muted">{f.label}</dt>
            <dd
              className={`figure mt-0.5 truncate text-[22px] leading-7 ${f.danger ? 'text-danger' : 'text-ink'}`}
            >
              {m(f.value)}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 text-[13px] font-semibold text-ink">Open balance by days past due</h3>
      {open > 0 ? (
        <div aria-hidden className="mt-2 flex h-3 gap-[2px] overflow-hidden rounded-sm">
          {buckets.map(([label, v], i) =>
            Number(v) > 0 ? (
              <span
                key={label}
                className="chart-mark"
                style={{ width: `${(Number(v) / open) * 100}%`, background: AGING_STEPS[i] }}
              />
            ) : null,
          )}
        </div>
      ) : (
        <p className="mt-1 text-[13px] text-muted">Nothing is open in {t.currency}.</p>
      )}
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm min-[420px]:grid-cols-2 sm:grid-cols-5">
        {buckets.map(([label, v], i) => (
          <div key={label} className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden
              className="mt-1 size-2.5 shrink-0 rounded-[2px]"
              style={{ background: AGING_STEPS[i] }}
            />
            <div className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="truncate text-ink tabular">{m(v)}</dd>
            </div>
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
          <DocumentTitle title={'Finance report'} />
          <h1 className="page-title">Finance report</h1>
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
