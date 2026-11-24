import type { ProjectPlan } from '@clientflow/contracts';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { DocumentTitle, Panel } from '../../components/ui/page';
import { todayIn } from '../../lib/format';
import { useSession } from '../auth/session';
import { useProjectContext } from '../projects/ProjectOverview';
import { useProjectPlan } from './api';
import {
  DependencyMap,
  shortDay,
  Timeline,
  type TimelineMarker,
  type TimelineRow,
} from './timeline';

/**
 * Milestones have a due date but no start date. So each milestone's window runs from the
 * previous milestone's due date (or the project start) to its own due date, and says so.
 * Tasks have a due date only, so they are markers, never bars.
 */
export function planRows(plan: ProjectPlan, today: string): TimelineRow[] {
  const state = (status: string, due: string): TimelineMarker['state'] =>
    status === 'DONE'
      ? 'done'
      : status === 'BLOCKED'
        ? 'blocked'
        : due < today && status !== 'CANCELED'
          ? 'late'
          : 'open';
  const taskMarkers = (milestoneId: string | null) =>
    plan.tasks
      .filter((t) => t.milestoneId === milestoneId && t.dueOn && t.status !== 'CANCELED')
      .map((t): TimelineMarker => ({
        id: t.id,
        date: t.dueOn!,
        label: t.title,
        kind: 'task',
        state: state(t.status, t.dueOn!),
      }));
  let previous = plan.project.startOn;
  const rows: TimelineRow[] = [...plan.milestones]
    .sort((a, b) => a.sequence - b.sequence)
    .map((m) => {
      const start = m.dueOn ? previous : null;
      const row: TimelineRow = {
        id: m.id,
        name: m.title,
        label: m.title,
        sub: m.status === 'DONE' ? 'Done' : m.status === 'IN_PROGRESS' ? 'In progress' : 'Planned',
        start: start && m.dueOn && start <= m.dueOn ? start : null,
        end: m.dueOn,
        barNote:
          previous === plan.project.startOn
            ? 'from the project start'
            : 'from the previous milestone',
        markers: [
          ...taskMarkers(m.id),
          ...(m.dueOn
            ? [
                {
                  id: `ms-${m.id}`,
                  date: m.dueOn,
                  label: `${m.title} due`,
                  kind: 'milestone' as const,
                  state: state(m.status, m.dueOn),
                },
              ]
            : []),
        ],
      };
      if (m.dueOn) previous = m.dueOn;
      return row;
    });
  const loose = taskMarkers(null);
  if (loose.length > 0)
    rows.push({
      id: 'no-milestone',
      name: 'Tasks without a milestone',
      label: 'No milestone',
      sub: `${loose.length} task${loose.length === 1 ? '' : 's'} with a due date`,
      start: null,
      end: null,
      markers: loose,
    });
  return rows;
}

export function ProjectPlanPage() {
  const project = useProjectContext();
  const { data: user } = useSession();
  const q = useProjectPlan(project.id);
  const today = todayIn(user?.agency.timezone);

  if (q.isError)
    return (
      <ErrorState
        message="The plan did not load. The project itself is unaffected."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data)
    return (
      <div className="flex flex-col gap-5" aria-busy>
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  const plan = q.data;
  const rows = planRows(plan, today);
  const undated = plan.tasks.filter((t) => !t.dueOn && t.status !== 'CANCELED').length;
  return (
    <div className="flex flex-col gap-5">
      <DocumentTitle title={`Plan: ${plan.project.title}`} />
      <Panel
        title="Timeline"
        description={
          plan.project.startOn && plan.project.dueOn
            ? `Project runs ${shortDay(plan.project.startOn)} to ${shortDay(plan.project.dueOn)}. Bars are milestone windows; dots are task due dates.`
            : 'Bars are milestone windows; dots are task due dates. Set a project start date to draw the first window.'
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted">This project has no milestones or dated tasks yet.</p>
        ) : (
          <Timeline
            rows={rows}
            today={today}
            caption={`Milestones and task due dates for ${plan.project.title}`}
            labelHeader="Milestone"
          />
        )}
        {undated > 0 ? (
          <p className="mt-3 text-xs text-muted">
            {undated} open task{undated === 1 ? ' has' : 's have'} no due date and{' '}
            {undated === 1 ? 'is' : 'are'} not drawn.
          </p>
        ) : null}
      </Panel>
      <Panel
        title="Task dependencies"
        description="Only stored dependencies are drawn. Tasks with none are left out."
      >
        <DependencyMap
          tasks={plan.tasks}
          dependencies={plan.dependencies}
          taskHref={() => `/app/projects/${plan.project.id}/board`}
        />
      </Panel>
    </div>
  );
}
