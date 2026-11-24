import { useState } from 'react';
import type { Currency } from '@clientflow/contracts';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { Panel, Segmented } from '../../components/ui/page';
import { useSalesIntelligence } from './api';
import { HeatTable, MonthBars, monthLabels, MoneyList, StageFunnel } from './charts';

const AGE_COLUMNS = ['0–7 days', '8–14', '15–30', '31+'];
const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

/**
 * Pipeline intelligence: where open deals sit, how long they have sat there, what closed each
 * month and which sources produce wins. Every number comes from `GET /insights/sales`, inside
 * the viewer's deal scope (a rep sees their own deals only).
 */
export function SalesIntelligence({ scopeNote }: { scopeNote: string }) {
  const [months, setMonths] = useState<'6' | '12'>('12');
  const q = useSalesIntelligence(Number(months));

  if (q.isError) {
    return (
      <ErrorState
        message="Sales intelligence did not load. Your pipeline itself is unaffected."
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!q.data) {
    return (
      <div className="grid gap-5 lg:grid-cols-2" aria-busy>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const s = q.data;
  const openDeals = s.stages.reduce((n, st) => n + st.open, 0);
  const won = s.monthly.reduce((n, m) => n + m.won, 0);
  const lost = s.monthly.reduce((n, m) => n + m.lost, 0);
  const created = s.monthly.reduce((n, m) => n + m.created, 0);
  const currencies = [...new Set(s.monthly.flatMap((m) => Object.keys(m.wonTotals)))].sort();
  const stale = s.stages.reduce((n, st) => n + st.age.d31plus, 0);
  const active = [...s.monthly].reverse().filter((m) => m.created + m.won + m.lost > 0);
  const quiet = s.monthly.length - active.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-sm text-muted">{scopeNote}</p>
        <Segmented
          label="Period"
          value={months}
          onChange={setMonths}
          options={[
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        {[
          ['Open deals', String(openDeals), 'in the pipeline now'],
          ['New deals', String(created), `created in ${months} months`],
          ['Win rate', pct(won, won + lost), `${won} won, ${lost} lost in ${months} months`],
          ['Sitting 31+ days', String(stale), 'open deals in the same stage'],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-surface px-4 py-3.5">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="figure mt-1 text-2xl text-ink">{value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{note}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Panel
          title="Funnel by stage"
          description="Open deals in each stage, in pipeline order. Values stay per currency."
        >
          <StageFunnel stages={s.stages} />
        </Panel>
        <Panel
          title="Time in current stage"
          description="Open deals by days since they entered their stage (last stage move, or creation if never moved)."
        >
          <HeatTable
            caption="Open deals by stage and days in stage"
            rowHeader="Stage"
            columns={AGE_COLUMNS}
            rows={s.stages.map((st) => ({
              id: st.id,
              label: st.name,
              values: [st.age.d0to7, st.age.d8to14, st.age.d15to30, st.age.d31plus],
            }))}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Panel
          title="Won value by month"
          description="Closed-won deals by the month they closed, one chart per currency."
        >
          {currencies.length === 0 ? (
            <p className="text-sm text-muted">No deals were won in this period.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {currencies.map((c) => (
                <MonthBars
                  key={c}
                  currency={c as Currency}
                  measure="Won value"
                  points={s.monthly.map((m) => ({
                    key: m.month,
                    ...monthLabels(m.month),
                    minor: BigInt(m.wonTotals[c] ?? '0'),
                  }))}
                />
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title="Deals opened and closed"
          description="Per month: deals created, won and lost. Counts, not value."
        >
          {active.length === 0 ? (
            <p className="text-sm text-muted">No deal was created or closed in this period.</p>
          ) : (
            <>
              <HeatTable
                caption="Deals created, won and lost per month"
                rowHeader="Month"
                columns={['Created', 'Won', 'Lost']}
                rows={active.map((m) => ({
                  id: m.month,
                  label: monthLabels(m.month).longLabel,
                  values: [m.created, m.won, m.lost],
                }))}
              />
              {quiet > 0 ? (
                <p className="mt-3 text-xs text-muted">
                  {quiet} other month{quiet === 1 ? ' had' : 's had'} no deals created or closed.
                </p>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Lead sources"
        description="Every deal by its contact's source. Win rate counts closed deals only."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Deals, wins and won value by lead source</caption>
            <thead className="bg-surface-alt text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 text-left font-medium">
                  Source
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Deals
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Won
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Lost
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Win rate
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Won value
                </th>
              </tr>
            </thead>
            <tbody>
              {s.sources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-4 text-muted">
                    No deals yet.
                  </td>
                </tr>
              ) : (
                s.sources.map((r) => (
                  <tr key={r.source ?? 'none'} className="border-t border-border">
                    <th scope="row" className="px-5 py-2.5 text-left font-medium text-ink">
                      {r.source ? r.source.replace(/_/g, ' ').toLowerCase() : 'No source'}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular">{r.deals}</td>
                    <td className="px-3 py-2.5 text-right tabular">{r.won}</td>
                    <td className="px-3 py-2.5 text-right tabular">{r.lost}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(r.won, r.won + r.lost)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <MoneyList totals={r.wonTotals} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
