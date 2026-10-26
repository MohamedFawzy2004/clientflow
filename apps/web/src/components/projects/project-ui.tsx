import { CircleCheck, CirclePause, Clock, Archive, PlayCircle } from 'lucide-react';
import {
  MILESTONE_STATUS_LABELS,
  PROJECT_STATE_LABELS,
  type MilestoneStatus,
  type ProjectState,
} from '@clientflow/contracts';
import { Badge } from '../ui/feedback';

const STATE_TONE = {
  PLANNED: 'info',
  ACTIVE: 'primary',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  ARCHIVED: 'neutral',
} as const;
const STATE_ICON = {
  PLANNED: Clock,
  ACTIVE: PlayCircle,
  ON_HOLD: CirclePause,
  COMPLETED: CircleCheck,
  ARCHIVED: Archive,
} as const;

export function ProjectStateBadge({ state }: { state: ProjectState }) {
  const Icon = STATE_ICON[state];
  return (
    <Badge tone={STATE_TONE[state]} icon={<Icon aria-hidden className="size-3.5" />}>
      {PROJECT_STATE_LABELS[state]}
    </Badge>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <Badge tone={status === 'DONE' ? 'success' : status === 'IN_PROGRESS' ? 'primary' : 'neutral'}>
      {MILESTONE_STATUS_LABELS[status]}
    </Badge>
  );
}
