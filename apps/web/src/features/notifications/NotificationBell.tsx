import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { useCanNotify, useUnreadCount } from './api';

/** Header link to the notification center with the unread count (FR-X09). */
export function NotificationBell() {
  const allowed = useCanNotify();
  const count = useUnreadCount();
  if (!allowed) return null;
  const total = count.data?.data.count ?? 0;
  return (
    <Link
      to="/app/notifications"
      aria-label={total > 0 ? `Notifications: ${total} unread` : 'Notifications: none unread'}
      title="Notifications"
      className="relative grid size-11 place-items-center rounded-md text-muted hover:bg-surface-alt hover:text-text md:size-10"
    >
      <Bell aria-hidden className="size-[18px]" />
      {total > 0 ? (
        <span
          aria-hidden
          className="tabular absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-[18px] text-white"
        >
          {total > 99 ? '99+' : total}
        </span>
      ) : null}
    </Link>
  );
}
