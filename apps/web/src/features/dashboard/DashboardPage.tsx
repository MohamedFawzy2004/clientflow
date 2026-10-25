import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, Circle, Plus, Users } from 'lucide-react';
import { can } from '@clientflow/contracts';
import { useBoard } from '../deals/api';
import { RemindersCard, SalesDashboard } from './SalesDashboard';
import { canSeeLeads } from '../../app/AppShell';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { AddLeadDialog } from '../leads/AddLeadDialog';
import { NextAction } from '../leads/LeadsListPage';
import { useLeads } from '../leads/api';

function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Every number on this page comes from the API. There are no placeholder KPIs (spec §7.4.11). */
function LeadsOverview({ timeZone, canInvite }: { timeZone: string; canInvite: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const recent = useLeads({ page: 1, limit: 5 });
  const board = useBoard();
  const hasDeals = (board.data?.data.columns ?? []).some((c) => c.count > 0);

  if (recent.isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }
  if (recent.isError) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <ErrorState
          message={recent.error.message}
          onRetry={() => recent.refetch()}
          retrying={recent.isFetching}
        />
      </div>
    );
  }

  const total = recent.data.meta.total;
  const steps: Array<{ done: boolean; label: string; note?: string; to?: string }> = [
    { done: total > 0, label: 'Add your first lead' },
    ...(canInvite
      ? [
          {
            done: false,
            label: 'Invite your team',
            note: 'Give each person their own sign-in',
            to: '/app/team',
          },
        ]
      : []),
    {
      done: hasDeals,
      label: 'Create a deal from a lead',
      note: 'Track it through your pipeline',
      to: '/app/deals',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SalesDashboard />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <RemindersCard />
          <section
            aria-label="Getting started"
            className="rounded-lg border border-border bg-surface p-5 shadow-card"
          >
            <h2 className="text-[15px] font-semibold text-text">Getting started</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {steps.map((s) => (
                <li key={s.label} className="flex items-start gap-2.5 text-sm">
                  {s.done ? (
                    <CircleCheck aria-hidden className="mt-0.5 size-4 text-success" />
                  ) : (
                    <Circle aria-hidden className="mt-0.5 size-4 text-border-strong" />
                  )}
                  <span>
                    {s.to && !s.done ? (
                      <Link to={s.to} className="font-medium text-primary-strong hover:underline">
                        {s.label}
                      </Link>
                    ) : (
                      <span className={s.done ? 'text-muted line-through' : 'text-text'}>
                        {s.label}
                      </span>
                    )}
                    <span className="sr-only">{s.done ? ' (done)' : ' (not done)'}</span>
                    {s.note ? <span className="block text-xs text-muted">{s.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section
          aria-label="Recently added leads"
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-text">Recently added</h2>
            <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
              <Plus aria-hidden className="size-4" /> Add lead
            </Button>
          </div>
          {recent.data.data.length === 0 ? (
            <EmptyState
              icon={<Users aria-hidden className="size-5" />}
              title="No leads yet"
              description="Leads you add show up here with their next step."
              action={
                <Button onClick={() => setAddOpen(true)}>
                  <Plus aria-hidden className="size-4" />
                  Add your first lead
                </Button>
              }
            />
          ) : (
            <ul>
              {recent.data.data.map((c) => (
                <li key={c.id} className="border-b border-border last:border-0">
                  <Link
                    to={`/app/leads/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-alt/50"
                  >
                    <Avatar name={c.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{c.fullName}</p>
                      <p className="truncate text-xs text-muted">{c.companyName ?? c.owner.name}</p>
                    </div>
                    <span className="hidden text-[13px] sm:block">
                      <NextAction iso={c.nextActionAt} timeZone={timeZone} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: user } = useSession();
  if (!user) return null;
  const firstName = user.name.split(' ')[0];
  const timeZone = user.agency.timezone;

  return (
    <>
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
        {greeting(timeZone)}, {firstName}
      </h1>
      <p className="mt-1 text-sm text-muted">
        Here is what needs your attention at {user.agency.name}.
      </p>
      <div className="mt-6">
        {canSeeLeads(user.role) ? (
          <LeadsOverview timeZone={timeZone} canInvite={can(user.role, 'team.invite')} />
        ) : (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState
              icon={<Users aria-hidden className="size-5" />}
              title="Your workspace is being set up"
              description="Projects, tasks and invoices for your role arrive in upcoming releases. Nothing is hidden from you by mistake."
            />
          </div>
        )}
      </div>
    </>
  );
}
