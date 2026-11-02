// Wall-clock ↔ UTC conversion in a named IANA timezone, without a date library.
// Used so a "9:00" follow-up means 9:00 in the agency's timezone, whatever the device timezone is.

const pad = (n: number) => String(n).padStart(2, '0');

/** Offset in minutes of `timeZone` from UTC at the given instant (e.g. Africa/Cairo summer = +180). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Converts a `datetime-local` value ("2026-11-01T09:00") interpreted in `timeZone` to an ISO
 * UTC string. Returns null for malformed input. Times skipped by a DST jump resolve forward.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const m = LOCAL_PATTERN.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wallAsUtc)) return null;
  // Two passes handle instants near a DST transition.
  let guess = wallAsUtc - timeZoneOffsetMinutes(new Date(wallAsUtc), timeZone) * 60_000;
  guess = wallAsUtc - timeZoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess).toISOString();
}

/** Converts an ISO instant to a `datetime-local` value in `timeZone`. */
export function utcIsoToZonedLocal(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const shifted = new Date(instant.getTime() + timeZoneOffsetMinutes(instant, timeZone) * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
