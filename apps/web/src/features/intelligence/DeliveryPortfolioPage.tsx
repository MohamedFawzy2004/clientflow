import { Link } from 'react-router';
import { FolderKanban, ShieldAlert } from 'lucide-react';
import { can, formatMinutes } from '@clientflow/contracts';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { PageHeader, Panel } from '../../components/ui/page';
import { todayIn } from '../../lib/format';
import { useSession } from '../auth/session';
import { useDeliveryIntelligence } from './api';
import { HeatTable } from './charts';
import { shortDay, Timeline, type TimelineRow } from './timeline';

const STATE_LABEL: Record<string, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
};

/**
 * Delivery portfolio: every open project the viewer can read, on one timeline, with task health
 * and the open work on each person. Counts only: there is no capacity model, so nobody is
 * labelled overloaded.
 */
export function DeliveryPortfolioPage() {
  const { data: user } = useSession();
  const q = useDeliveryIntelligence();
  if (!user) return null;
  if (!can(user.role, 'delivery.work')) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Delivery work is for the project team"
        description="Projects you are linked to are still on the Projects page."
      />
    );
  }
  const today = todayIn(user.agency.timezone);
  const header = (
    <PageHeader
      title="Delivery portfolio"
      description={
        user.role === 'OWNER' || user.role === 'ADMIN'
          ? 'Every planned, active and on-hold project, from stored dates and tasks.'
          : 'The open projects you work on, from stored dates and tasks.'
      }
    />
  );
  if (q.isError)
    return (
      <>
        {header}
        <ErrorState
          className="mt-6"
          message="The portfolio did not load. Projects are unaffected."
          onRetry={() => void q.refetch()}
        />
      </>
    );
  if (!q.data)
    return (
      <>
        {header}
        <div className="mt-6 flex flex-col gap-5" aria-busy>
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      </>
    );
  const d = q.data;
  const rows: TimelineRow[] = d.projects.map((p) => ({
    id: p.id,
    name: p.title,
    label: (
      <Link to={`/app/projects/${p.id}/plan`} className="hover:underline">
        {p.title}
      </Link>
    ),
    sub: `${STATE_LABEL[p.state] ?? p.state}, ${p.manager.name}`,
    start: p.startOn,
    end: p.dueOn,
    markers: p.milestones
      .filter((m) => m.dueOn)
      .map((m) => ({
        id: m.id,
        date: m.dueOn!,
        label: m.title,
        kind: 'milestone' as const,
        state: m.status === 'DONE' ? 'done' : m.dueOn! < today ? 'late' : 'open',
      })),
  }));
  const totals = d.projects.reduce(
    (a, p) => ({
      open: a.open + p.tasks.open,
      overdue: a.overdue + p.tasks.overdue,
      blocked: a.blocked + p.tasks.blocked,
      late: a.late + (p.dueOn && p.dueOn < today ? 1 : 0),
    }),
    { open: 0, overdue: 0, blocked: 0, late: 0 },
  );
  const someOwn = d.projects.some((p) => p.loggedScope === 'own');

  return (
    <>
      {header}
      {d.projects.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<FolderKanban aria-hidden className="size-5" />}
          title="No open projects"
          description="Planned, active and on-hold projects you can work on appear here."
        />
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
            {[
              ['Open projects', d.projects.length, 'planned, active or on hold'],
              ['Open tasks', totals.open, 'across these projects'],
              ['Past due tasks', totals.overdue, 'open, with a due date before today'],
              ['Blocked tasks', totals.blocked, 'marked blocked by the team'],
            ].map(([label, value, note]) => (
              <div key={label} className="bg-surface px-4 py-3.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="figure mt-1 text-2xl text-ink">{value}</dd>
                <dd className="mt-0.5 text-xs text-muted">{note}</dd>
              </div>
            ))}
          </dl>

          <Panel
            title="Portfolio timeline"
            description="Bars run from a project's stored start date to its due date. Diamonds are milestone due dates."
          >
            <Timeline
              rows={rows}
              today={today}
              caption="Open projects with their start, due and milestone dates"
              labelHeader="Project"
            />
          </Panel>

          <Panel
            title="Project health"
            description={`Task counts and time per project.${someOwn ? ' Logged time shows only your own entries on projects you do not manage.' : ''}`}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  Task counts, estimates and logged time per project
                </caption>
                <thead className="bg-surface-alt text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2 text-left font-medium">
                      Project
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Due
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Tasks done
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Past due
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Blocked
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Estimated
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      Logged
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <th scope="row" className="px-5 py-2.5 text-left font-medium">
                        <Link to={`/app/projects/${p.id}`} className="text-ink hover:underline">
                          {p.title}
                        </Link>
                        <span className="block text-xs font-normal text-muted">
                          {p.manager.name}
                        </span>
                      </th>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {p.dueOn ? (
                          <span className={p.dueOn < today ? 'font-medium text-danger' : undefined}>
                            {shortDay(p.dueOn)}
                            {p.dueOn < today ? ', past' : ''}
                          </span>
                        ) : (
                          <span className="text-muted">Not set</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">
                        {p.tasks.done}/{p.tasks.total}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{p.tasks.overdue}</td>
                      <td className="px-3 py-2.5 text-right tabular">{p.tasks.blocked}</td>
                      <td className="px-3 py-2.5 text-right tabular">
                        {p.estimateMinutes ? formatMinutes(p.estimateMinutes) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular">
                        {formatMinutes(p.loggedMinutes)}
                        {p.loggedScope === 'own' ? (
                          <span className="block text-xs text-muted">yours</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Open work by person"
            description="Open tasks assigned to each person, by the week they are due. There is no capacity model, so these are counts, not a judgement of load."
          >
            {d.people.length === 0 ? (
              <p className="text-sm text-muted">No open task is assigned to anyone yet.</p>
            ) : (
              <>
                <HeatTable
                  caption="Open tasks per person by due week"
                  rowHeader="Person"
                  columns={d.weekStarts.map((w, i) =>
                    i === 0 ? 'This week' : `Wk ${shortDay(w)}`,
                  )}
                  rows={d.people.map((p) => ({
                    id: p.id,
                    label: p.name,
                    values: p.dueByWeek,
                  }))}
                />
                <ul className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
                  {d.people.map((p) => (
                    <li key={p.id} className="rounded-md border border-border px-3 py-2">
                      <p className="font-medium text-ink">{p.name}</p>
                      <p className="text-xs text-muted">
                        {p.open} open, {p.overdue} past due, {p.blocked} blocked
                        {p.estimateMinutes ? `, ${formatMinutes(p.estimateMinutes)} estimated` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
