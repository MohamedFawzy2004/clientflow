import { Link, useSearchParams } from 'react-router';
import { FileText, ShieldAlert } from 'lucide-react';
import {
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import { Money } from '../../components/sales/sales-ui';
import { ProposalStatusBadge } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { useProposals } from './api';

function isStatus(v: string | null): v is ProposalStatus {
  return v !== null && (PROPOSAL_STATUSES as readonly string[]).includes(v);
}

export function ProposalsListPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = isStatus(raw) ? raw : undefined;
  const query = useProposals(status ? { status } : {});
  const error = query.error instanceof ApiError ? query.error : null;

  let body;
  if (error?.status === 403) {
    body = (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Proposals are not part of your role"
        description="Ask an owner or admin if you need access."
      />
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        title="We could not load proposals"
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (query.isPending) {
    body = (
      <ul aria-busy className="divide-y divide-border">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    );
  } else if (query.data.data.length === 0) {
    body = (
      <EmptyState
        icon={<FileText aria-hidden className="size-5" />}
        title={status ? 'No proposals with this status' : 'No proposals yet'}
        description={
          status
            ? 'Try another status.'
            : 'Open a deal and choose “Create proposal” to write the first one.'
        }
        action={
          <Link
            to="/app/deals"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Go to deals
          </Link>
        }
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((p) => (
          <li key={p.id} className="relative px-4 py-3.5 hover:bg-surface-alt/50 md:px-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-2">
                  <span className="tabular shrink-0 text-[13px] text-muted">{p.reference}</span>
                  <Link
                    to={`/app/proposals/${p.id}`}
                    className="min-w-0 truncate font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                  >
                    {p.title}
                  </Link>
                </p>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {p.contact.fullName}
                  {p.contact.companyName ? ` · ${p.contact.companyName}` : ''} · v
                  {p.currentVersionNo} · {p.owner.name}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 md:justify-end">
                <ProposalStatusBadge status={p.displayStatus} />
                <span className="text-[13px] text-muted">
                  Valid until {formatDate(`${p.expiresOn}T12:00:00Z`, timeZone)}
                </span>
                <Money minor={p.totalMinor} currency={p.currency} className="font-medium" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Proposals
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user?.role === 'SALES'
              ? 'Proposals on your deals.'
              : 'Every proposal in your agency, newest activity first.'}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <label htmlFor="proposal-status" className="text-[13px] font-medium text-text">
            Status
          </label>
          <Select
            id="proposal-status"
            className="mt-1.5"
            value={status ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
          >
            <option value="">All statuses</option>
            {PROPOSAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROPOSAL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <section
        aria-label="Proposals list"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {body}
      </section>
    </>
  );
}
