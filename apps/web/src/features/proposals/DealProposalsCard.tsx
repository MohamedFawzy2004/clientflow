import { Link, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { DealDetail } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/feedback';
import { Money } from '../../components/sales/sales-ui';
import { ProposalStatusBadge } from '../../components/proposals/proposal-ui';
import { useCreateProposal, useProposalPermissions, useProposals } from './api';

/** Proposals written for one deal, with the entry point to write a new one. */
export function DealProposalsCard({ deal }: { deal: DealDetail }) {
  const perms = useProposalPermissions();
  const list = useProposals({ dealId: deal.id });
  const create = useCreateProposal();
  const navigate = useNavigate();
  if (!perms.read) return null;

  const start = () =>
    create.mutate(
      { dealId: deal.id },
      {
        onSuccess: (res) => {
          toast.success(`Proposal ${res.data.reference} created`);
          navigate(`/app/proposals/${res.data.id}`);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not create the proposal'),
      },
    );

  return (
    <section
      aria-label="Proposals"
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <h2 className="text-[15px] font-semibold text-text">Proposals</h2>
        {perms.write && deal.status === 'OPEN' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={start}
            loading={create.isPending}
            loadingLabel="Creating…"
          >
            <Plus aria-hidden className="size-4" /> Create proposal
          </Button>
        ) : null}
      </div>
      <div className="px-4 md:px-5">
        {list.isPending ? (
          <div className="py-4">
            <Skeleton className="h-10" />
          </div>
        ) : list.isError ? (
          <p className="py-4 text-sm text-danger">{list.error.message}</p>
        ) : list.data.data.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            No proposals yet. A deal is won when the client accepts one in the portal.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.data.map((p) => (
              <li
                key={p.id}
                className="relative flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <Link
                  to={`/app/proposals/${p.id}`}
                  className="min-w-0 text-sm font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  <span className="tabular text-muted">{p.reference}</span> · v{p.currentVersionNo}
                </Link>
                <span className="flex items-center gap-3">
                  <ProposalStatusBadge status={p.displayStatus} />
                  <Money minor={p.totalMinor} currency={p.currency} className="text-sm" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
