import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type Currency, type FinanceIntelligence } from '@clientflow/contracts';
import { Panel } from '../../components/ui/page';
import { cn } from '../../lib/format';

type Row = NonNullable<FinanceIntelligence['profitability']>[number];

const STATE: Record<string, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
};

/** Margin as a share of budget, one decimal, from integers (no float money). */
export function marginPercent(r: Pick<Row, 'budgetMinor' | 'estimatedMarginMinor'>) {
  const budget = BigInt(r.budgetMinor);
  if (budget === 0n) return null;
  return Number((BigInt(r.estimatedMarginMinor) * 1000n) / budget) / 10;
}

/**
 * The steps from the signed budget to the estimated margin, each a start and an end in minor
 * units: original budget, plus accepted change requests, minus logged-time cost.
 */
export function waterfallSteps(r: Row) {
  const original = BigInt(r.originalBudgetMinor);
  const budget = BigInt(r.budgetMinor);
  const margin = BigInt(r.estimatedMarginMinor);
  return [
    { key: 'original', label: 'Signed budget', from: 0n, to: original, kind: 'total' as const },
    {
      key: 'changes',
      label: 'Accepted changes',
      from: original,
      to: budget,
      kind: 'up' as const,
    },
    {
      key: 'cost',
      label: 'Logged time cost',
      from: budget,
      to: margin,
      kind: 'down' as const,
    },
    { key: 'margin', label: 'Estimated margin', from: 0n, to: margin, kind: 'total' as const },
  ];
}

/**
 * Estimated project profitability for finance and admins. Every figure stays in the project's
 * own currency. It is an estimate from logged time, not accounting profit, and says so.
 */
export function Profitability({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState(rows[0]?.id ?? '');
  const row = rows.find((r) => r.id === selected) ?? rows[0];
  if (!row) return null;
  const c = row.currency as Currency;
  const steps = waterfallSteps(row);
  const values = steps.flatMap((s) => [s.from, s.to]);
  const hi = values.reduce((a, b) => (b > a ? b : a), 0n);
  const lo = values.reduce((a, b) => (b < a ? b : a), 0n);
  const span = hi - lo === 0n ? 1n : hi - lo;
  const pos = (v: bigint) => Number(((v - lo) * 10000n) / span) / 100;

  return (
    <Panel
      title="Estimated profitability"
      description="Budget (including accepted change requests) minus logged time at each person's rate for that day. An estimate for steering projects, not accounting profit. Each project stays in its own currency."
    >
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <label className="block text-xs text-muted" htmlFor="profit-project">
            Project
          </label>
          <select
            id="profit-project"
            value={row.id}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded-md border border-control bg-surface px-3 py-2 text-sm text-ink"
          >
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.currency})
              </option>
            ))}
          </select>
          <ol
            className="mt-4 flex flex-col gap-3"
            aria-label={`From budget to estimated margin, ${row.title}`}
          >
            {steps.map((s) => {
              const a = pos(s.from < s.to ? s.from : s.to);
              const b = pos(s.from < s.to ? s.to : s.from);
              const amount = s.kind === 'total' ? s.to : s.to - s.from;
              return (
                <li key={s.key}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-muted">{s.label}</span>
                    <span
                      className={cn(
                        'tabular font-medium',
                        s.kind === 'total' && amount < 0n ? 'text-danger' : 'text-ink',
                      )}
                    >
                      {s.kind === 'up' ? '+ ' : s.kind === 'down' ? '− ' : ''}
                      {formatMoney(
                        (amount < 0n && s.kind !== 'total' ? -amount : amount).toString(),
                        c,
                      )}
                    </span>
                  </div>
                  <div aria-hidden className="relative mt-1 h-3 rounded-[3px] bg-surface-alt">
                    {lo < 0n ? (
                      <span
                        className="absolute inset-y-0 w-px bg-ink/50"
                        style={{ left: `${pos(0n)}%` }}
                      />
                    ) : null}
                    <span
                      className={cn(
                        'absolute inset-y-0 rounded-[3px]',
                        s.kind === 'total'
                          ? 'bg-ink'
                          : s.kind === 'up'
                            ? 'bg-seq-3'
                            : 'bg-series-4',
                      )}
                      style={{
                        left: `${a}%`,
                        width: `${Math.max(b - a, s.to === s.from ? 0 : 0.6)}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted">
            {row.costCompletenessPercent < 100
              ? `${100 - row.costCompletenessPercent}% of logged time has no rate in ${row.currency} yet, so the cost is understated.`
              : 'Every logged minute on this project has a rate.'}{' '}
            Invoiced so far, excluding VAT: {formatMoney(row.invoicedMinor, c)}.
          </p>
        </div>

        <div
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling area must take focus (axe scrollable-region-focusable)
          tabIndex={0}
          role="region"
          aria-label="Estimated profitability by project"
          className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <table className="w-full text-[13px]">
            <caption className="sr-only">Budget, cost and estimated margin per project</caption>
            <thead className="bg-surface-alt text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Project
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Budget
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Time cost
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Est. margin
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rc = r.currency as Currency;
                const pct = marginPercent(r);
                const negative = BigInt(r.estimatedMarginMinor) < 0n;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-t border-border',
                      r.id === row.id && 'bg-primary-soft/40',
                    )}
                  >
                    <th scope="row" className="px-3 py-2.5 text-left font-medium">
                      <Link to={`/app/projects/${r.id}`} className="text-ink hover:underline">
                        {r.title}
                      </Link>
                      <span className="block text-xs font-normal text-muted">
                        {STATE[r.state] ?? r.state}
                        {BigInt(r.acceptedChangesMinor) > 0n
                          ? `, ${formatMoney(r.acceptedChangesMinor, rc)} from changes`
                          : ''}
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                      {formatMoney(r.budgetMinor, rc)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                      {formatMoney(r.estimatedCostMinor, rc)}
                      {r.costCompletenessPercent < 100 ? (
                        <span className="block text-xs text-warning">
                          {r.costCompletenessPercent}% costed
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right tabular whitespace-nowrap font-medium',
                        negative ? 'text-danger' : 'text-ink',
                      )}
                    >
                      {formatMoney(r.estimatedMarginMinor, rc)}
                      {pct !== null ? (
                        <span className="block text-xs font-normal text-muted">
                          {pct}% of budget
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
