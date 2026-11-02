// FR-Q03 / FR-F10: exact proposal arithmetic shared by the server and the editor preview.
import { describe, expect, it } from 'vitest';
import {
  computeProposalTotals,
  formatQuantity,
  parsePercentToBp,
  parseQuantityToCenti,
  proposalReference,
} from '@clientflow/contracts';

describe('quantities and percentages', () => {
  it('parses quantities to hundredths without floats', () => {
    expect(parseQuantityToCenti('1')).toBe(100);
    expect(parseQuantityToCenti('1.5')).toBe(150);
    expect(parseQuantityToCenti('0.25')).toBe(25);
    expect(parseQuantityToCenti('1,000')).toBe(100_000);
    expect(parseQuantityToCenti('100000')).toBe(10_000_000);
  });

  it('rejects zero, negatives, 3 decimals, exponents and huge quantities', () => {
    for (const bad of ['0', '0.00', '-1', '1.234', '1e3', 'abc', '', '100000.01']) {
      expect({ bad, v: parseQuantityToCenti(bad) }).toEqual({ bad, v: null });
    }
  });

  it('formats quantities back without trailing zeros', () => {
    expect([150, 100, 25, 105].map(formatQuantity)).toEqual(['1.5', '1', '0.25', '1.05']);
  });

  it('parses percentages to basis points within 0–100', () => {
    expect(parsePercentToBp('14')).toBe(1400);
    expect(parsePercentToBp('12.5')).toBe(1250);
    expect(parsePercentToBp('0')).toBe(0);
    expect(parsePercentToBp('100')).toBe(10_000);
    expect(parsePercentToBp('100.01')).toBeNull();
    expect(parsePercentToBp('-1')).toBeNull();
  });

  it('formats reference numbers', () => {
    expect(proposalReference(1)).toBe('P-0001');
    expect(proposalReference(12345)).toBe('P-12345');
  });
});

describe('computeProposalTotals', () => {
  it('computes line, discount, VAT and total with half-up rounding at each step', () => {
    const t = computeProposalTotals({
      items: [
        { quantityCenti: 300, unitPriceMinor: '150050' }, // 3 × 1,500.50 = 4,501.50
        { quantityCenti: 50, unitPriceMinor: '1' }, // 0.5 × 0.01 = 0.005 → 0.01
      ],
      discountBp: 1000,
      taxRateBp: 1400,
    });
    expect(t).toEqual({
      lineTotalsMinor: ['450150', '1'],
      subtotalMinor: '450151',
      discountMinor: '45015', // 450.151 → 450.15
      taxableMinor: '405136',
      taxMinor: '56719', // 567.1904 → 567.19
      totalMinor: '461855',
    });
  });

  it('rounds exactly half up, never through binary floating point', () => {
    // 0.1 + 0.2 style traps: 3 lines of 0.10 and 0.20 add to exactly 0.90.
    const t = computeProposalTotals({
      items: [
        { quantityCenti: 100, unitPriceMinor: '10' },
        { quantityCenti: 100, unitPriceMinor: '20' },
        { quantityCenti: 300, unitPriceMinor: '20' },
      ],
      discountBp: 0,
      taxRateBp: 0,
    });
    expect(t.totalMinor).toBe('90');
    // 14% of 0.25 = 0.035 → 0.04 (half up), and of 0.24 = 0.0336 → 0.03.
    expect(
      computeProposalTotals({
        items: [{ quantityCenti: 100, unitPriceMinor: '25' }],
        discountBp: 0,
        taxRateBp: 1400,
      }).taxMinor,
    ).toBe('4');
    expect(
      computeProposalTotals({
        items: [{ quantityCenti: 100, unitPriceMinor: '24' }],
        discountBp: 0,
        taxRateBp: 1400,
      }).taxMinor,
    ).toBe('3');
  });

  it('handles amounts far beyond float precision exactly', () => {
    const t = computeProposalTotals({
      items: [{ quantityCenti: 10_000_000, unitPriceMinor: '900000000000000' }],
      discountBp: 0,
      taxRateBp: 1400,
    });
    expect(t.subtotalMinor).toBe('90000000000000000000');
    expect(t.totalMinor).toBe('102600000000000000000');
  });

  it('a 100% discount leaves no tax and a zero total; an empty proposal totals zero', () => {
    expect(
      computeProposalTotals({
        items: [{ quantityCenti: 100, unitPriceMinor: '1000' }],
        discountBp: 10_000,
        taxRateBp: 1400,
      }).totalMinor,
    ).toBe('0');
    expect(computeProposalTotals({ items: [], discountBp: 0, taxRateBp: 1400 }).totalMinor).toBe(
      '0',
    );
  });
});
