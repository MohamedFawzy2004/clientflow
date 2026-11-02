import {
  CHANGE_STATUS_LABELS,
  TASK_SCOPE_LABELS,
  type ChangeStatus,
  type TaskScope,
  DELIVERABLE_STATUS_LABELS,
  PORTAL_DELIVERABLE_STATE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type DeliverableStatus,
  type PortalDeliverableState,
  type TaskPriority,
  type TaskStatus,
} from '@clientflow/contracts';
import { Badge } from '../ui/feedback';

const TASK_TONE = {
  TODO: 'neutral',
  IN_PROGRESS: 'primary',
  BLOCKED: 'danger',
  IN_REVIEW: 'info',
  DONE: 'success',
  CANCELED: 'neutral',
} as const;

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONE[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_TONE = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
} as const;

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{TASK_PRIORITY_LABELS[priority]} priority</Badge>;
}

const DELIVERABLE_TONE = {
  DRAFT: 'neutral',
  READY: 'info',
  PUBLISHED: 'primary',
  REVISION_REQUESTED: 'warning',
  APPROVED: 'success',
  ARCHIVED: 'neutral',
} as const;

export function DeliverableStatusBadge({ status }: { status: DeliverableStatus }) {
  return <Badge tone={DELIVERABLE_TONE[status]}>{DELIVERABLE_STATUS_LABELS[status]}</Badge>;
}

const PORTAL_TONE = {
  AWAITING_REVIEW: 'primary',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
} as const;

export function PortalDeliverableBadge({ state }: { state: PortalDeliverableState }) {
  return <Badge tone={PORTAL_TONE[state]}>{PORTAL_DELIVERABLE_STATE_LABELS[state]}</Badge>;
}

export function OverdueBadge() {
  return <Badge tone="danger">Overdue</Badge>;
}

const CHANGE_TONE = {
  REQUESTED: 'info',
  ESTIMATING: 'neutral',
  IN_REVIEW: 'warning',
  AWAITING_CLIENT: 'primary',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
} as const;

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  return <Badge tone={CHANGE_TONE[status]}>{CHANGE_STATUS_LABELS[status]}</Badge>;
}

/** Marks extra work on task cards (FR-S05); original-scope tasks show nothing. */
export function TaskScopeBadge({ scope, reference }: { scope: TaskScope; reference?: string }) {
  if (scope === 'BASELINE') return null;
  return (
    <Badge tone={scope === 'CHANGE' ? 'info' : 'warning'}>
      {scope === 'CHANGE' && reference ? `Extra: ${reference}` : TASK_SCOPE_LABELS[scope]}
    </Badge>
  );
}
