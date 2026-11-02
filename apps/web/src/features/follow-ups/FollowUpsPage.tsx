import { Link } from 'react-router';
import { Briefcase, CalendarCheck, ShieldAlert, UserRound } from 'lucide-react';
import { canAny, type FollowUpItem } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { formatDateTime, relativeDay } from '../../lib/format';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { useFollowUps } from '../deals/api';

function ItemRow({
  item,
  timeZone,
  overdue,
}: {
  item: FollowUpItem;
  timeZone: string;
  overdue?: boolean;
}) {
  const href = item.type === 'deal' ? `/app/deals/${item.id}` : `/app/leads/${item.id}`;
  const Icon = item.type === 'deal' ? Briefcase : UserRound;
  return (
    <li className="border-b border-border last:border-0">
      <Link to={href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-alt/50 md:px-5">
        <span
          aria-hidden
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-alt text-muted"
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-text">{item.title}</span>
            <span className="sr-only">{item.type === 'deal' ? '(deal)' : '(lead)'}</span>
          </span>
          <span className="block truncate text-[13px] text-muted">
            {[item.subtitle, item.owner.name].filter(Boolean).join(' · ')}
          </span>
        </span>
        {item.dueAt ? (
          <span className="shrink-0 text-right text-xs">
            {overdue ? (
              <Badge tone="warning">
                Overdue · {relativeDay(item.dueAt, new Date(), timeZone)}
              </Badge>
            ) : (
              <span className="text-muted tabular">{formatDateTime(item.dueAt, timeZone)}</span>
            )}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function Bucket({
  title,
  description,
  items,
  count,
  timeZone,
  overdue,
  emptyText,
}: {
  title: string;
  description: string;
  items: FollowUpItem[];
  count: number;
  timeZone: string;
  overdue?: boolean;
  emptyText: string;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border px-4 py-3 md:px-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text">
          {title}
          <span className={overdue && count > 0 ? 'text-warning' : 'font-normal text-muted'}>
            <span className="tabular">{count}</span>
          </span>
        </h2>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted md:px-5">{emptyText}</p>
      ) : (
        <ul>
          {items.map((i) => (
            <ItemRow key={`${i.type}-${i.id}`} item={i} timeZone={timeZone} overdue={overdue} />
          ))}
          {count > items.length ? (
            <li className="px-4 py-2.5 text-xs text-muted md:px-5">
              +{count - items.length} more. Use the lead and deal filters to see all.
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function FollowUpsPage() {
  const { data: user } = useSession();
  const queue = useFollowUps();
  if (!user) return null;
  const timeZone = user.agency.timezone;

  if (!canAny(user.role, ['contacts.read.all', 'contacts.read.own'])) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Follow-ups are for the sales team"
      />
    );
  }

  let body: React.ReactNode;
  if (queue.isPending) {
    body = (
      <div className="grid gap-6 lg:grid-cols-2" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    );
  } else if (queue.isError) {
    const err = queue.error instanceof ApiError ? queue.error : null;
    body = (
      <ErrorState
        message={queue.error.message}
        requestId={err?.requestId}
        onRetry={() => queue.refetch()}
        retrying={queue.isFetching}
      />
    );
  } else {
    const q = queue.data.data;
    const nothing = Object.values(q.counts).every((n) => n === 0);
    body = nothing ? (
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <EmptyState
          icon={<CalendarCheck aria-hidden className="size-5" />}
          title="All clear"
          description="No follow-ups are due and every open lead and deal has a next step."
        />
      </div>
    ) : (
      <div className="grid gap-6 lg:grid-cols-2">
        <Bucket
          title="Overdue"
          description="Past their follow-up time."
          items={q.overdue}
          count={q.counts.overdue}
          timeZone={timeZone}
          overdue
          emptyText="Nothing overdue."
        />
        <Bucket
          title="Due today"
          description={`Later today, ${timeZone.replace('_', ' ')} time.`}
          items={q.today}
          count={q.counts.today}
          timeZone={timeZone}
          emptyText="Nothing else due today."
        />
        <Bucket
          title="Next 7 days"
          description="Coming up this week."
          items={q.upcoming}
          count={q.counts.upcoming}
          timeZone={timeZone}
          emptyText="Nothing scheduled this week."
        />
        <Bucket
          title="No next step"
          description="Open leads and deals with nothing scheduled, oldest first."
          items={q.noNextStep}
          count={q.counts.noNextStep}
          timeZone={timeZone}
          emptyText="Everything has a next step."
        />
      </div>
    );
  }

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Follow-ups
      </h1>
      <p className="mt-1 text-sm text-muted">
        {user.role === 'SALES'
          ? 'Your leads and deals that need a next move.'
          : 'Leads and deals across the agency that need a next move.'}
      </p>
      <div className="mt-6">{body}</div>
    </>
  );
}
