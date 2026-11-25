import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type Currency } from '@clientflow/contracts';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { Panel, Segmented } from '../../components/ui/page';
import { useFinanceIntelligence } from './api';
import { monthLabels, PairedColumns } from './charts';
import { Profitability } from './Profitability';

/**
 * Invoiced and received money per month, and money per project, from
 * `GET /insights/finance`. Invoiced counts issued, non-void invoices by issue date; received is
 * payments minus reversals by the date the money arrived. One chart per currency, no conversion.
 */
export function FinanceTrends() {
  const [months, setMonths] = useState<'6' | '12'>('12');
  const q = useFinanceIntelligence(Number(months));
  return (
    <section aria-labelledby="finance-trends" className="mt-10 flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="finance-trends" className="text-xl font-semibold text-ink">
            Trends
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted">
            Invoiced is issued, non-void invoices by issue date. Received is payments minus
            reversals by the date the money arrived. Not filtered by the dates above.
          </p>
        </div>
        <Segmented
          label="Trend period"
          value={months}
          onChange={setMonths}
          options={[
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
          ]}
        />
      </div>
      {q.isError ? (
        <ErrorState message="Trends did not load." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-56 rounded-lg" />
      ) : (
        <>
          <Panel title="Invoiced and received by month" description="One chart per currency.">
            {q.data.monthly.length === 0 ? (
              <p className="text-sm text-muted">No invoice was issued in this period.</p>
            ) : (
              <div className="grid gap-8 lg:grid-cols-2">
                {q.data.monthly.map((series) => (
                  <PairedColumns
                    key={series.currency}
                    currency={series.currency as Currency}
                    aLabel="Invoiced"
                    bLabel="Received"
                    points={series.points.map((p) => ({
                      key: p.month,
                      ...monthLabels(p.month),
                      a: BigInt(p.invoicedMinor),
                      b: BigInt(p.receivedMinor),
                    }))}
                  />
                ))}
              </div>
            )}
          </Panel>
          <Panel
            title="Money by project"
            description="All issued invoices linked to a project, all time. Outstanding is invoiced minus paid."
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  Invoiced, received and outstanding per project
                </caption>
                <thead className="bg-surface-alt text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2 text-left font-medium">
                      Project
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Invoices
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Invoiced
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Received
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.projects.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-4 text-muted">
                        No issued invoice is linked to a project yet.
                      </td>
                    </tr>
                  ) : (
                    q.data.projects.map((p) => {
                      const c = p.currency as Currency;
                      const share =
                        BigInt(p.invoicedMinor) > 0n
                          ? Number((BigInt(p.receivedMinor) * 1000n) / BigInt(p.invoicedMinor)) / 10
                          : 0;
                      return (
                        <tr key={`${p.id}-${p.currency}`} className="border-t border-border">
                          <th scope="row" className="px-5 py-2.5 text-left font-medium">
                            <Link to={`/app/projects/${p.id}`} className="text-ink hover:underline">
                              {p.title}
                            </Link>
                            <span
                              aria-hidden
                              className="mt-1.5 block h-1.5 max-w-48 rounded-full bg-surface-alt"
                            >
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${Math.min(100, share)}%` }}
                              />
                            </span>
                          </th>
                          <td className="px-3 py-2.5 text-right tabular">{p.invoices}</td>
                          <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                            {formatMoney(p.invoicedMinor, c)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                            {formatMoney(p.receivedMinor, c)}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular whitespace-nowrap font-medium text-ink">
                            {formatMoney(p.outstandingMinor, c)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
          {q.data.profitability && q.data.profitability.length > 0 ? (
            <Profitability rows={q.data.profitability} />
          ) : null}
        </>
      )}
    </section>
  );
}
