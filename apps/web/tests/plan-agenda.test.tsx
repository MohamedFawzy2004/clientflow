// The plan's agenda view lists every dated item of the timeline by day, so a phone never needs
// to scroll the drawing sideways (final closure, mobile Gantt).
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Agenda, agendaDays, type TimelineRow } from '../src/features/intelligence/timeline';

const rows: TimelineRow[] = [
  {
    id: 'm1',
    label: 'Discovery',
    name: 'Discovery',
    start: '2026-11-01',
    end: '2026-11-20',
    markers: [
      { id: 't2', date: '2026-11-20', label: 'Workshop notes', kind: 'task', state: 'done' },
      { id: 'ms1', date: '2026-11-20', label: 'Discovery due', kind: 'milestone', state: 'done' },
      { id: 't1', date: '2026-11-12', label: 'Kick-off', kind: 'task', state: 'late' },
    ],
  },
  {
    id: 'no-milestone',
    label: 'No milestone',
    name: 'Tasks without a milestone',
    start: null,
    end: null,
    markers: [{ id: 't3', date: '2026-11-12', label: 'Brief', kind: 'task', state: 'blocked' }],
  },
];

describe('agendaDays', () => {
  it('groups every marker by date, earliest first, milestones before tasks', () => {
    const days = agendaDays(rows);
    expect(days.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-20']);
    expect(days[0]!.items.map((i) => i.id)).toEqual(['t3', 't1']);
    expect(days[1]!.items.map((i) => i.id)).toEqual(['ms1', 't2']);
    expect(days.flatMap((d) => d.items)).toHaveLength(4);
    expect(days[0]!.items[0]!.group).toBe('Tasks without a milestone');
  });
});

describe('Agenda', () => {
  it('states each item in words, not colour alone', () => {
    render(<Agenda rows={rows} today="2026-11-12" />);
    const groups = screen.getAllByRole('listitem').filter((li) => li.querySelector('time'));
    expect(groups).toHaveLength(2);
    const first = within(groups[0]!);
    expect(first.getByText('Today')).toBeInTheDocument();
    expect(first.getByText('Past due')).toBeInTheDocument();
    expect(first.getByText('Blocked')).toBeInTheDocument();
    expect(within(groups[1]!).getAllByText('Done')).toHaveLength(2);
    expect(screen.getByText('Milestone:', { exact: false })).toBeInTheDocument();
  });

  it('says so when nothing is dated', () => {
    render(<Agenda rows={[]} today="2026-11-12" />);
    expect(screen.getByText('Nothing on this plan has a due date yet.')).toBeInTheDocument();
  });
});
