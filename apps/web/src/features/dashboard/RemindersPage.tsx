import { RemindersCard } from './SalesDashboard';

export function RemindersPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        Reminders
      </h1>
      <p className="mt-1 text-sm text-muted">
        Your overdue follow-ups, proposals waiting for your review, and proposals that need you.
      </p>
      <div className="mt-6">
        <RemindersCard limit={50} />
      </div>
    </>
  );
}
