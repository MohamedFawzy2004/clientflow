import { Link } from 'react-router';
import { FileText } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Money } from '../../components/sales/sales-ui';
import { ProposalStatusBadge } from '../../components/proposals/proposal-ui';
import { useSession } from '../auth/session';
import { usePortalProposals } from './api';

export function PortalProposalsPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = usePortalProposals();
  const error = query.error instanceof ApiError ? query.error : null;

  let body;
  if (query.isError) {
    body = (
      <ErrorState
        title="We could not load your proposals"
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
        icon={<FileText aria-hidden className="size-5" />}
        title="Nothing to review yet"
        description={`When ${user?.agency.name ?? 'the agency'} sends you a proposal, it appears here and you get an email.`}
      />
    );
  } else {
    body = (
      <ul className="divide-y divide-border">
        {query.data.data.map((p) => (
          <li key={p.id} className="relative px-4 py-4 hover:bg-surface-alt/50 md:px-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/portal/proposals/${p.id}`}
                  className="block break-words font-medium text-text after:absolute after:inset-0 hover:text-primary-strong"
                >
                  {p.title}
                </Link>
                <p className="mt-0.5 text-[13px] text-muted">
                  <span className="tabular">{p.reference}</span> · Version {p.versionNo} · Valid
                  until {formatDate(`${p.expiresOn}T12:00:00Z`, timeZone)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ProposalStatusBadge status={p.displayStatus} />
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
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Proposals
      </h1>
      <p className="mt-1 text-sm text-muted">
        Proposals {user?.agency.name} shared with {user?.clientOrg?.name ?? 'you'}.
      </p>
      <section
        aria-label="Your proposals"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        {body}
      </section>
    </>
  );
}
