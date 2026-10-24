// Exact money handling (FR-F10, ADR-006). Amounts are integer minor units carried as decimal
// strings in JSON, so they are never rounded by binary floating point. Different currencies are
// never added together.

export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Digits after the decimal point. All supported currencies use 2 today. */
export const CURRENCY_EXPONENT: Record<Currency, number> = {
  EGP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SAR: 2,
  AED: 2,
};

/** Upper bound shared with the database check constraint, well below 2^53. */
export const MAX_AMOUNT_MINOR = 900_000_000_000_000n;

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Parses user input such as "12,500.50", "12500" or "0.5" into minor units ("1250050").
 * Rejects negatives, exponents, more decimals than the currency allows, and values over the cap.
 * Returns null when the input is not a valid amount.
 */
export function parseMoneyToMinor(input: string, currency: Currency): string | null {
  const exponent = CURRENCY_EXPONENT[currency];
  const cleaned = input.trim().replace(/[,\s]/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  if (minor > MAX_AMOUNT_MINOR) return null;
  return minor.toString();
}

/** "1250050" → "12500.50" (exact decimal string, no float). */
export function minorToDecimalString(minor: string | bigint, currency: Currency): string {
  const exponent = CURRENCY_EXPONENT[currency];
  const digits = BigInt(minor)
    .toString()
    .padStart(exponent + 1, '0');
  if (exponent === 0) return digits;
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * Formats minor units for display, e.g. "EGP 12,500.50". Intl receives a decimal STRING, which
 * modern engines format exactly (no conversion through a JavaScript number).
 */
export function formatMoney(minor: string | bigint, currency: Currency, locale = 'en-GB'): string {
  const decimal = minorToDecimalString(minor, currency);
  const exponent = CURRENCY_EXPONENT[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(decimal as unknown as number);
}

/** Adds amounts per currency with BigInt. Result: { EGP: "250000", USD: "1200" }. */
export function sumByCurrency(
  items: ReadonlyArray<{ amountMinor: string; currency: Currency }>,
): Partial<Record<Currency, string>> {
  const totals = new Map<Currency, bigint>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0n) + BigInt(item.amountMinor));
  }
  return Object.fromEntries([...totals].map(([c, v]) => [c, v.toString()]));
}
