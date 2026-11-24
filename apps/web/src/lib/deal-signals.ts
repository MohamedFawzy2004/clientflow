import type { DealSummary } from '@clientflow/contracts';

/**
 * Deal health signals: rule-based and fully explainable. Nothing here is a prediction or "AI".
 * The rules are documented in docs/design/redesign/02_DATA_SOURCES.md §Deal signals.
 *
 * - Age: whole days since the deal was created.
 * - Idle: whole days since the deal record last changed (`updatedAt`: any edit, stage move,
 *   reassignment or next-step change updates it).
 * - Next step overdue: `nextStepAt` is in the past.
 * - No next step: no `nextStepAt` scheduled.
 * - Stalled: open, idle for STALL_DAYS or more, AND either no next step or an overdue one.
 *   An idle deal with a future next step is waiting on purpose, so it is not stalled.
 */
export const STALL_DAYS = 14;
const DAY = 86_400_000;

export interface DealSignals {
  ageDays: number;
  idleDays: number;
  nextStepOverdue: boolean;
  noNextStep: boolean;
  stalled: boolean;
  /** Any of the three: shown as "needs attention". */
  atRisk: boolean;
}

export function dealSignals(
  deal: Pick<DealSummary, 'createdAt' | 'updatedAt' | 'nextStepAt' | 'status'>,
  now = new Date(),
): DealSignals {
  const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(deal.createdAt)) / DAY));
  const idleDays = Math.max(0, Math.floor((now.getTime() - Date.parse(deal.updatedAt)) / DAY));
  const open = deal.status === 'OPEN';
  const nextStepOverdue = open && !!deal.nextStepAt && Date.parse(deal.nextStepAt) < now.getTime();
  const noNextStep = open && !deal.nextStepAt;
  const stalled = open && idleDays >= STALL_DAYS && (noNextStep || nextStepOverdue);
  return {
    ageDays,
    idleDays,
    nextStepOverdue,
    noNextStep,
    stalled,
    atRisk: stalled || nextStepOverdue || noNextStep,
  };
}

export function daysLabel(n: number) {
  return n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`;
}

/** Why a deal is flagged, in plain words, most serious first. */
export function signalReason(s: DealSignals): string | null {
  if (s.stalled) return `Stalled: no change for ${daysLabel(s.idleDays)}`;
  if (s.nextStepOverdue) return 'Next step overdue';
  if (s.noNextStep) return 'No next step';
  return null;
}
