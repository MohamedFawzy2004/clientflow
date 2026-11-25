import { describe, expect, it } from 'vitest';
import { changePercent, expectedTiles, periodSums } from '../src/features/dashboard/ExecutiveStrip';
import { can, canAny, type Role } from '@clientflow/contracts';

describe('executive strip maths', () => {
  it('compares periods in whole percent from integers, and says nothing when there was nothing', () => {
    expect(changePercent(150n, 100n)).toBe(50);
    expect(changePercent(50n, 100n)).toBe(-50);
    expect(changePercent(100n, 100n)).toBe(0);
    expect(changePercent(100n, 0n)).toBeNull();
    // Truncates toward zero rather than rounding up a partial point.
    expect(changePercent(1n, 3n)).toBe(-66);
  });

  it('sums the last n points and the n before them, per currency, never across currencies', () => {
    const points = [
      { c: 'EGP', v: 1n },
      { c: 'USD', v: 10n },
      { c: 'EGP', v: 100n },
      { c: 'EGP', v: 1000n },
    ];
    const one = periodSums(points, 1, (p) => [[p.c, p.v]]);
    expect(one.now).toEqual({ EGP: 1000n });
    expect(one.before).toEqual({ EGP: 100n });
    const two = periodSums(points, 2, (p) => [[p.c, p.v]]);
    expect(two.now).toEqual({ EGP: 1100n });
    expect(two.before).toEqual({ EGP: 1n, USD: 10n });
  });

  it('has an empty previous period when the history is shorter than two periods', () => {
    const s = periodSums([{ v: 5n }], 3, (p) => [['EGP', p.v]]);
    expect(s.now).toEqual({ EGP: 5n });
    expect(s.before).toEqual({});
  });

  it('knows each role tile count before data arrives, so loading does not shift the page', () => {
    const count = (role: Role) =>
      expectedTiles({
        sales: can(role, 'dashboard.sales'),
        delivery: can(role, 'delivery.work'),
        invoices: canAny(role, ['invoices.read.all', 'invoices.read.project']),
        financeView: can(role, 'finance.view'),
      });
    // Owner: 3 sales + received + outstanding + margin + 2 delivery.
    expect(count('OWNER')).toBe(8);
    expect(count('SALES')).toBe(3);
    // Finance: received + invoiced + outstanding + margin.
    expect(count('FINANCE')).toBe(4);
    // PM: received + invoiced (project invoices) + 2 delivery.
    expect(count('PM')).toBe(4);
    expect(count('MEMBER')).toBe(2);
  });
});
