import { describe, expect, it } from 'vitest';
import {
  dealCloseSchema,
  dealCreateSchema,
  dealUpdateSchema,
  formatMoney,
  minorToDecimalString,
  parseMoneyToMinor,
  sumByCurrency,
} from '@clientflow/contracts';
import { agencyDayBounds } from '../src/lib/agency-time.js';
import { zodFieldErrors } from '../src/lib/validation.js';

describe('FR-F10 money in integer minor units', () => {
  it('parses user input exactly', () => {
    expect(parseMoneyToMinor('12,500.50', 'EGP')).toBe('1250050');
    expect(parseMoneyToMinor('12500', 'EGP')).toBe('1250000');
    expect(parseMoneyToMinor('0.5', 'USD')).toBe('50');
    expect(parseMoneyToMinor(' 1 000 ', 'EGP')).toBe('100000');
    expect(parseMoneyToMinor('0', 'EGP')).toBe('0');
  });

  it('rejects negatives, exponents, extra decimals, text and values over the cap', () => {
    for (const bad of [
      '-1',
      '1e5',
      '12.345',
      'abc',
      '',
      '.',
      '1.2.3',
      '9000000000000.01',
      '99999999999999999',
    ]) {
      expect(parseMoneyToMinor(bad, 'EGP'), bad).toBeNull();
    }
  });

  it('never goes through binary floating point (0.1 + 0.2 is exactly 0.30)', () => {
    const totals = sumByCurrency([
      { amountMinor: parseMoneyToMinor('0.1', 'EGP')!, currency: 'EGP' },
      { amountMinor: parseMoneyToMinor('0.2', 'EGP')!, currency: 'EGP' },
    ]);
    expect(totals).toEqual({ EGP: '30' });
    expect(minorToDecimalString(totals.EGP!, 'EGP')).toBe('0.30');
  });

  it('handles amounts beyond 2^53 minor-unit precision limits of floats exactly', () => {
    // 9,007,199,254,740,993 is not representable as a double; BigInt keeps it exact.
    const big = [
      { amountMinor: '900719925474099', currency: 'EGP' as const },
      { amountMinor: '3', currency: 'EGP' as const },
    ];
    expect(sumByCurrency(big)).toEqual({ EGP: '900719925474102' });
  });

  it('keeps currencies apart when summing', () => {
    expect(
      sumByCurrency([
        { amountMinor: '1000', currency: 'EGP' },
        { amountMinor: '250', currency: 'USD' },
        { amountMinor: '500', currency: 'EGP' },
      ]),
    ).toEqual({ EGP: '1500', USD: '250' });
  });

  it('formats from decimal strings (non-breaking space keeps the code with the number)', () => {
    expect(formatMoney('1250050', 'EGP')).toBe('EGP 12,500.50');
    expect(formatMoney('5', 'USD')).toBe('USD 0.05');
    expect(minorToDecimalString('7', 'EGP')).toBe('0.07');
  });
});

describe('deal DTOs', () => {
  const contactId = '018f0000-0000-7000-8000-000000000001';

  it('reports invalid amounts on the amount field', () => {
    const r = dealCreateSchema.safeParse({
      contactId,
      title: 'Site',
      amount: '12.345',
      currency: 'EGP',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error))).toEqual(['amount']);
  });

  it('rejects mass-assignment fields on create and update', () => {
    const c = dealCreateSchema.safeParse({
      contactId,
      title: 'x',
      amount: '1',
      currency: 'EGP',
      ownerId: contactId,
      status: 'WON',
    });
    expect(c.success).toBe(false);
    const u = dealUpdateSchema.safeParse({ version: 1, stageId: contactId, amountMinor: '1' });
    expect(u.success).toBe(false);
    if (!u.success)
      expect(Object.keys(zodFieldErrors(u.error)).sort()).toEqual(['amountMinor', 'stageId']);
  });

  it('refuses a currency change without re-entering the amount', () => {
    const r = dealUpdateSchema.safeParse({ version: 1, currency: 'USD' });
    expect(r.success).toBe(false);
  });

  it('requires a reason to mark a deal lost', () => {
    expect(dealCloseSchema.safeParse({ outcome: 'LOST', version: 1 }).success).toBe(false);
    expect(
      dealCloseSchema.safeParse({ outcome: 'LOST', version: 1, reason: 'Budget cut' }).success,
    ).toBe(true);
  });
});

describe('agency day boundaries', () => {
  it('uses Cairo midnight, not UTC midnight', () => {
    // 23:30 UTC on 1 Nov 2026 is 01:30 on 2 Nov in Cairo (UTC+2).
    const { start, end } = agencyDayBounds(new Date('2026-11-01T23:30:00Z'), 'Africa/Cairo');
    expect(start.toISOString()).toBe('2026-11-01T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T22:00:00.000Z');
  });

  it('handles a day during Egyptian summer time (UTC+3)', () => {
    const { start, end } = agencyDayBounds(new Date('2026-07-15T12:00:00Z'), 'Africa/Cairo');
    expect(start.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });
});
