import { utcIsoToZonedLocal, zonedLocalToUtcIso } from '@clientflow/contracts';

/**
 * The agency's calendar day containing `now`, as UTC instants [start, end). Follow-up buckets use
 * the agency timezone (spec §8.2: "calculate user day boundaries using configured timezone").
 */
export function agencyDayBounds(now: Date, timeZone: string) {
  const localDate = utcIsoToZonedLocal(now.toISOString(), timeZone).slice(0, 10);
  const start = new Date(zonedLocalToUtcIso(`${localDate}T00:00`, timeZone)!);
  // The next local midnight, found from the following calendar date (handles DST-length days).
  const next = new Date(`${localDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextLocal = next.toISOString().slice(0, 10);
  const end = new Date(zonedLocalToUtcIso(`${nextLocal}T00:00`, timeZone)!);
  return { start, end };
}

/** `YYYY-MM-DD` ↔ the Date Prisma stores in a DATE column (midnight UTC). */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Today's date (`YYYY-MM-DD`) in the agency timezone. Expiry dates are compared against it. */
export function agencyToday(now: Date, timeZone: string): string {
  return utcIsoToZonedLocal(now.toISOString(), timeZone).slice(0, 10);
}

/** `YYYY-MM-DD` plus a number of calendar days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD HH:mm` in the agency timezone, for exports. */
export function utcToLocalDateTime(instant: Date, timeZone: string): string {
  return utcIsoToZonedLocal(instant.toISOString(), timeZone).slice(0, 16).replace('T', ' ');
}
