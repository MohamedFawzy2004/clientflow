// Gantt markers due on the same day (or within a day or two on a long range) are drawn once,
// with a count, instead of on top of each other (final closure, desktop and mobile Gantt).
import { describe, expect, it } from 'vitest';
import {
  clusterMarkers,
  clusterState,
  type TimelineMarker,
} from '../src/features/intelligence/timeline';

const DAY = 86_400_000;
const m = (id: string, date: string, state: TimelineMarker['state'] = 'open'): TimelineMarker => ({
  id,
  date,
  label: id,
  kind: 'task',
  state,
});

describe('clusterMarkers', () => {
  it('groups same-day markers and keeps distant ones apart', () => {
    const span = 120 * DAY;
    const c = clusterMarkers(
      [m('b', '2026-11-10'), m('a', '2026-11-10'), m('c', '2026-12-20'), m('d', '2026-11-11')],
      span,
    );
    expect(c.map((x) => x.markers.map((i) => i.id))).toEqual([['a', 'b', 'd'], ['c']]);
    expect(c[0]!.date).toBe('2026-11-10');
  });

  it('keeps every marker separate when none are close', () => {
    const span = 30 * DAY;
    expect(clusterMarkers([m('a', '2026-11-01'), m('b', '2026-11-10')], span)).toHaveLength(2);
  });

  it('shows the most urgent state of the items in a cluster', () => {
    const [c] = clusterMarkers(
      [m('a', '2026-11-10', 'done'), m('b', '2026-11-10', 'late'), m('c', '2026-11-10', 'blocked')],
      60 * DAY,
    );
    expect(clusterState(c!)).toBe('late');
  });
});
