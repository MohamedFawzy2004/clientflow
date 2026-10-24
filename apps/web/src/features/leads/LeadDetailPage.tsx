import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  Building,
  CalendarClock,
  ChevronRight,
  Clock,
  Mail,
  Phone,
  SearchX,
  ShieldAlert,
  StickyNote,
  UserRound,
} from 'lucide-react';
import { CONTACT_SOURCE_LABELS } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Avatar } from '../../components/ui/brand';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { useLead } from './api';
import { NextAction } from './LeadsListPage';

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-3">
      <span aria-hidden className="mt-0.5 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-text">{children}</dd>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-lg border border-border bg-surface shadow-card ${className ?? ''}`}
    >
      <h2 className="border-b border-border px-4 py-3.5 text-[15px] font-semibold text-text md:px-5">
        {title}
      </h2>
      <div className="px-4 py-2 md:px-5">{children}</div>
    </section>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/leads"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back to leads
    </Link>
  );
}

export function LeadDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useLead(id);
  const error = query.error instanceof ApiError ? query.error : null;

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error?.status === 404) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Lead not found"
          description="This lead does not exist, was archived, or is not assigned to you."
        />
      </>
    );
  }
  if (error?.status === 403) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="You do not have access to leads"
          description="Ask your agency owner or admin if you need access."
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <BackLink />
        <ErrorState
          message={query.error.message}
          requestId={error?.requestId}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </>
    );
  }

  const lead = query.data.data;
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link to="/app/leads" className="hover:text-text">
              Leads
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate text-text">
            {lead.fullName}
          </li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="hidden sm:block">
          <Avatar name={lead.fullName} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
              {lead.fullName}
            </h1>
            {lead.lifecycle === 'CUSTOMER' ? (
              <Badge tone="success">Customer</Badge>
            ) : (
              <Badge tone="info">Lead</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {lead.companyName ? `${lead.companyName} · ` : ''}Owned by {lead.owner.name}
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <Card title="Next step">
            <div className="py-3 text-sm">
              <NextAction iso={lead.nextActionAt} timeZone={timeZone} />
            </div>
          </Card>
          <Card title="Contact details">
            <dl className="divide-y divide-border">
              <DetailRow icon={<Mail className="size-4" />} label="Email">
                {lead.email ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline"
                    href={`mailto:${lead.email}`}
                  >
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Phone className="size-4" />} label="Phone">
                {lead.phone ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline tabular"
                    href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
                  >
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Building className="size-4" />} label="Company">
                {lead.companyName ?? <span className="text-muted">Not provided</span>}
              </DetailRow>
              <DetailRow icon={<UserRound className="size-4" />} label="Source">
                {lead.source ? (
                  CONTACT_SOURCE_LABELS[lead.source]
                ) : (
                  <span className="text-muted">Not specified</span>
                )}
              </DetailRow>
              <DetailRow icon={<CalendarClock className="size-4" />} label="Added">
                <span className="tabular">{formatDateTime(lead.createdAt, timeZone)}</span>
              </DetailRow>
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Notes">
            {lead.notes ? (
              // Rendered as text, never as HTML, so stored markup cannot run (T-SEC-03).
              <p className="whitespace-pre-wrap break-words py-3 text-sm leading-[22px] text-text">
                {lead.notes}
              </p>
            ) : (
              <p className="flex items-center gap-2 py-4 text-sm text-muted">
                <StickyNote aria-hidden className="size-4" />
                No notes yet.
              </p>
            )}
          </Card>
          <Card title="Activity">
            {lead.activities.length === 0 ? (
              <p className="py-4 text-sm text-muted">No activity recorded yet.</p>
            ) : (
              <ol className="relative py-3">
                {lead.activities.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-5 last:pb-1">
                    {i < lead.activities.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-border"
                      />
                    ) : null}
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong ring-4 ring-surface"
                    >
                      <Clock className="size-3.5" />
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className="text-sm text-text">{a.summary}</p>
                      <p className="mt-0.5 text-xs text-muted tabular">
                        {formatDateTime(a.createdAt, timeZone)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
