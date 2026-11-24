import { describe, expect, it } from 'vitest';
import { changePercent, periodSums } from '../src/features/dashboard/ExecutiveStrip';

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
});
