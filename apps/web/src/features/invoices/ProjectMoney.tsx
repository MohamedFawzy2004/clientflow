import { formatMoney, type Currency } from '@clientflow/contracts';
import { Skeleton } from '../../components/ui/feedback';
import { Card } from '../../components/proposals/proposal-ui';
import { useProjectFinance } from './api';

/** Project money for finance (FR-F05 – FR-F07): what was agreed, billed and received. */
export function ProjectMoney({ projectId }: { projectId: string }) {
  const q = useProjectFinance(projectId);
  if (q.isPending) return <Skeleton className="h-32 rounded-lg" />;
  if (q.isError) return null;
  const f = q.data.data;
  const c = f.currency as Currency;
  return (
    <Card title="Project money">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {(
          [
            ['Expected (budget, excl. tax)', f.expectedMinor],
            ['Invoiced (excl. tax)', f.invoicedMinor],
            ['Received (cash, incl. tax)', f.receivedMinor],
            ['Outstanding (incl. tax)', f.outstandingMinor],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular-nums text-text">{formatMoney(v, c)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-text">
        Estimated margin{' '}
        <span className="font-semibold tabular-nums">{formatMoney(f.estimatedMarginMinor, c)}</span>{' '}
        (budget minus an estimated time cost of {formatMoney(f.cost.estimatedMinor, c)}).
      </p>
      <p className="mt-1 text-xs text-muted">
        Estimate based on {f.cost.completenessPercent}% of logged time.
        {f.cost.missingRates.length
          ? ` No usable cost rate for: ${f.cost.missingRates.join(', ')}.`
          : ''}
      </p>
    </Card>
  );
}
