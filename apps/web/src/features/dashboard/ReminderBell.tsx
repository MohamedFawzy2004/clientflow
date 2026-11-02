import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { can } from '@clientflow/contracts';
import { useSession } from '../auth/session';
import { useReminders } from './api';

/** Header link to the reminders list, with the live count (FR-A01). */
export function ReminderBell() {
  const { data: user } = useSession();
  const reminders = useReminders();
  if (!user || !can(user.role, 'dashboard.sales')) return null;
  const total = reminders.data?.data.total ?? 0;
  return (
    <Link
      to="/app/reminders"
      aria-label={
        total > 0 ? `Reminders: ${total} need attention` : 'Reminders: nothing needs attention'
      }
      title="Reminders"
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
