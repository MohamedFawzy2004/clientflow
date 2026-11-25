// The dashboard's won-by-month and lead-source panels read the cached /insights/sales response
// instead of paging deals and counting contacts per source (final closure, request budget).
import { describe, expect, it } from 'vitest';
import type { SalesIntelligence } from '@clientflow/contracts';
import { leadSourceRows, wonByMonth } from '../src/features/dashboard/insights';

const month = (
  key: string,
  wonTotals: Record<string, string> = {},
  wonCounts: Record<string, number> = {},
): SalesIntelligence['monthly'][number] => ({
  month: key,
  won: Object.values(wonCounts).reduce((a, b) => a + b, 0),
  lost: 0,
  created: 0,
  wonTotals,
  wonCounts,
});

describe('wonByMonth', () => {
  const monthly = [
    month('2025-12', { EGP: '999' }, { EGP: 1 }),
    month('2026-06'),
    month('2026-07', { EGP: '250000', USD: '70000' }, { EGP: 2, USD: 1 }),
    month('2026-08'),
    month('2026-09'),
    month('2026-10', { USD: '5000' }, { USD: 1 }),
    month('2026-11'),
  ];

  it('keeps the last N months and one series per currency, never a cross-currency total', () => {
    const w = wonByMonth(monthly, 6);
    expect(w.byCurrency.map((c) => c.currency)).toEqual(['EGP', 'USD']);
    const egp = w.byCurrency[0]!.points;
    expect(egp.map((p) => p.key)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(egp[1]).toMatchObject({
      label: 'Jul',
      longLabel: 'July 2026',
      minor: 250000n,
      count: 2,
    });
    // December 2025 is outside the 6-month window and does not leak in.
    expect(egp.reduce((n, p) => n + p.minor, 0n)).toBe(250000n);
    expect(w.byCurrency[1]!.points.map((p) => p.count)).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it('returns no series when nothing was won in the window', () => {
    expect(wonByMonth([month('2026-10'), month('2026-11')], 6).byCurrency).toEqual([]);
  });
});

describe('leadSourceRows', () => {
  it('labels each source and keeps the server order', () => {
    expect(
      leadSourceRows([
        { source: 'WEBSITE', leads: 3, clients: 1 },
        { source: 'REFERRAL', leads: 2, clients: 2 },
      ]),
    ).toEqual([
      { source: 'WEBSITE', label: 'Website', leads: 3, clients: 1 },
      { source: 'REFERRAL', label: 'Referral', leads: 2, clients: 2 },
    ]);
  });
});
