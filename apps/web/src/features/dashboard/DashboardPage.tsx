import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Receipt, Users } from 'lucide-react';
import { can } from '@clientflow/contracts';
import { ExecutiveStrip } from './ExecutiveStrip';
import { SalesCommandCenter } from './SalesCommandCenter';
import { canSeeLeads } from '../../app/nav';
import { DeferredSection, EmptyState, Skeleton } from '../../components/ui/feedback';
import { PageHeader } from '../../components/ui/page';
import { useSession } from '../auth/session';

// Off the first paint: react-router waits for this route module and its static imports before it
// renders anything, so the delivery section (below the sales command centre) loads as its own
// chunk when it nears the viewport (docs/milestones/FINAL_CLOSURE_REPORT.md §3). The sales command
// centre stays in this chunk: splitting it measured worse (a later, separate long task).
const DeliveryDashboardSection = lazy(() =>
  import('./DeliveryDashboard').then((m) => ({ default: m.DeliveryDashboardSection })),
);

/** Reserves a section's place while its chunk loads, so content below does not jump. */
function SectionPlaceholder({ className = 'h-72' }: { className?: string }) {
  return <Skeleton className={`w-full rounded-lg ${className}`} />;
}

function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function longToday(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());
}

export function DashboardPage() {
  const { data: user } = useSession();
  if (!user) return null;
  const firstName = user.name.split(' ')[0];
  const timeZone = user.agency.timezone;
  const sales = canSeeLeads(user.role) && can(user.role, 'dashboard.sales');
  const delivery = can(user.role, 'dashboard.delivery');

  return (
    <>
      <PageHeader
        title={`${greeting(timeZone)}, ${firstName}`}
        documentTitle="Dashboard"
        description={`${longToday(timeZone)}. ${
          sales
            ? 'Who to talk to next, where the pipeline stands and what closed.'
            : delivery
              ? 'What is moving in delivery and what is waiting on clients.'
              : `Your work at ${user.agency.name}.`
        }`}
      />
      <div className="mt-7 flex flex-col gap-10">
        <ExecutiveStrip />
        {sales ? (
          <DeferredSection placeholderClassName="h-[36rem]">
            <SalesCommandCenter timeZone={timeZone} canInvite={can(user.role, 'team.invite')} />
          </DeferredSection>
        ) : null}
        {delivery ? (
          <DeferredSection placeholderClassName="h-72">
            <Suspense fallback={<SectionPlaceholder />}>
              <DeliveryDashboardSection />
            </Suspense>
          </DeferredSection>
        ) : null}
        {!sales && !delivery ? <FinanceHome /> : null}
      </div>
    </>
  );
}

/** Finance has no sales or delivery dashboard; point to the screens that are theirs. */
function FinanceHome() {
  const { data: user } = useSession();
  const finance = user ? can(user.role, 'finance.view') : false;
  if (!finance) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<Users aria-hidden className="size-5" />}
          title="Nothing to show for your role yet"
          description="Your role has no dashboard. Nothing is hidden from you by mistake."
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {[
        {
          to: '/app/invoices',
          title: 'Invoices',
          body: 'Drafts, issued invoices and payments, with totals per currency.',
        },
        {
          to: '/app/reports/finance',
          title: 'Finance report',
          body: 'What is owed and how old it is, plus project margins from logged time.',
        },
      ].map((c) => (
        <Link
          key={c.to}
          to={c.to}
          className="press group flex items-start gap-4 rounded-lg border border-border bg-surface p-5 hover:border-border-strong"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
            <Receipt aria-hidden className="size-5" />
          </span>
          <span>
            <span className="flex items-center gap-1 text-[15px] font-[620] text-ink">
              {c.title}
              <ArrowUpRight aria-hidden className="size-4 text-subtle group-hover:text-ink" />
            </span>
            <span className="mt-0.5 block text-sm text-muted">{c.body}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
