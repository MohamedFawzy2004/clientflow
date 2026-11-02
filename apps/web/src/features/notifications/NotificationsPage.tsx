import { useState } from 'react';
import { Link } from 'react-router';
import {
  BellOff,
  CalendarClock,
  CheckCheck,
  ListTodo,
  MessageSquare,
  Receipt,
  Settings2,
  ShieldAlert,
} from 'lucide-react';
import {
  can,
  NOTIFICATION_CATEGORY_INFO,
  type NotificationCategory,
  type NotificationView,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { useCanNotify, useMarkRead, useNotifications, useUnreadCount } from './api';

const ICONS: Record<NotificationCategory, typeof Receipt> = {
  CLIENT_ACTIVITY: MessageSquare,
  APPROVALS: CheckCheck,
  TASKS: ListTodo,
  FOLLOW_UPS: CalendarClock,
  INVOICES: Receipt,
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "5 minutes ago", "yesterday", … for the last week; a date after that. */
export function timeAgo(iso: string, timeZone: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return formatDateTime(iso, timeZone);
}

function Item({ n, timeZone }: { n: NotificationView; timeZone: string }) {
  const mark = useMarkRead();
  const Icon = ICONS[n.category];
  const unread = n.readAt === null;
  return (
    <li className="border-b border-border last:border-0">
      <Link
        to={n.link}
        // The mutation outlives the page change; the list refreshes from its hook (ADR-059).
        onClick={() => unread && mark.mutate({ id: n.id })}
        className={cn(
          'flex items-start gap-3 px-4 py-3 hover:bg-surface-alt/60 md:px-5',
          unread && 'bg-primary-soft/40',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
            unread ? 'bg-primary-soft text-primary-strong' : 'bg-surface-alt text-muted',
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block break-words text-sm',
              unread ? 'font-semibold text-text' : 'text-text',
            )}
          >
            {unread ? <span className="sr-only">Unread: </span> : null}
            {n.title}
          </span>
          <span className="block text-[13px] text-muted">
            {NOTIFICATION_CATEGORY_INFO[n.category].label} ·{' '}
            <time dateTime={n.createdAt} title={formatDateTime(n.createdAt, timeZone)}>
              {timeAgo(n.createdAt, timeZone)}
            </time>
          </span>
        </span>
        {unread ? (
          <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
        ) : null}
      </Link>
    </li>
  );
}

export function NotificationsPage() {
  const { data: user } = useSession();
  const allowed = useCanNotify();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useNotifications(unreadOnly);
  const count = useUnreadCount();
  const mark = useMarkRead();
  if (!user) return null;
  const timeZone = user.agency.timezone;

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Notifications are for team members"
      />
    );
  }

  const items = list.data?.pages.flatMap((p) => p.data.items) ?? [];
  const unread = count.data?.data.count ?? list.data?.pages[0]?.data.unreadCount ?? 0;

  let body: React.ReactNode;
  if (list.isPending) {
    body = (
      <div className="grid gap-px p-4" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  } else if (list.isError) {
    const err = list.error instanceof ApiError ? list.error : null;
    body = (
      <ErrorState
        message={list.error.message}
        requestId={err?.requestId}
        onRetry={() => list.refetch()}
        retrying={list.isFetching}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<BellOff aria-hidden className="size-5" />}
        title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
        description={
          unreadOnly
            ? 'You are up to date.'
            : 'Client decisions, approvals, task assignments and reminders will appear here.'
        }
      />
    );
  } else {
    body = (
      <>
        <ul>
          {items.map((n) => (
            <Item key={n.id} n={n} timeZone={timeZone} />
          ))}
        </ul>
        {list.hasNextPage ? (
          <div className="border-t border-border px-4 py-3 md:px-5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => list.fetchNextPage()}
              loading={list.isFetchingNextPage}
              loadingLabel="Loading…"
            >
              Show older
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted">
            {unread === 1 ? '1 unread' : `${unread} unread`}. Only you see your notifications.
          </p>
        </div>
        <Link
          to="/app/notifications/settings"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text hover:bg-surface-alt"
        >
          <Settings2 aria-hidden className="size-4" />
          Settings
        </Link>
      </div>

      <section
        aria-label="Notifications"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:px-5">
          <div className="flex gap-1" role="group" aria-label="Show">
            {[
              { label: 'All', value: false },
              { label: 'Unread', value: true },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={unreadOnly === o.value}
                onClick={() => setUnreadOnly(o.value)}
                className={cn(
                  'h-8 rounded-sm px-3 text-[13px] font-medium',
                  unreadOnly === o.value
                    ? 'bg-primary-soft text-primary-strong'
                    : 'text-muted hover:bg-surface-alt hover:text-text',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || items.length === 0}
            loading={mark.isPending}
            loadingLabel="Marking…"
            // Up to the newest item on screen: one that arrives meanwhile stays unread.
            onClick={() => items[0] && mark.mutate({ all: true, upTo: items[0].createdAt })}
          >
            <CheckCheck aria-hidden className="size-4" />
            Mark all as read
          </Button>
        </div>
        {body}
      </section>

      {can(user.role, 'dashboard.sales') ? (
        <p className="mt-4 text-sm text-muted">
          Your full list of due follow-ups and proposals is on the{' '}
          <Link to="/app/reminders" className="font-medium text-primary hover:underline">
            reminders page
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
