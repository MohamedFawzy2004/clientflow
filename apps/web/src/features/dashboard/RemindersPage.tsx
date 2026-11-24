import { RemindersCard } from './SalesDashboard';
import { DocumentTitle } from '../../components/ui/page';

export function RemindersPage() {
  return (
    <>
      <DocumentTitle title={'Reminders'} />
      <h1 className="page-title">Reminders</h1>
      <p className="mt-1 text-sm text-muted">
        Your overdue follow-ups, proposals waiting for your review, and proposals that need you.
      </p>
      <div className="mt-6">
        <RemindersCard limit={50} />
      </div>
    </>
  );
}
