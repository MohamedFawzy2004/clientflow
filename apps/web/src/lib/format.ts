import { clsx, type ClassValue } from 'clsx';

export function cn(...values: ClassValue[]) {
  return clsx(values);
}

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

/** Dates are stored in UTC and shown in the agency's timezone (spec §0.2, §8.2). */
export function formatDate(iso: string, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "today", "tomorrow", "in 3 days", "2 days ago". Day boundaries use the agency timezone. */
export function relativeDay(iso: string, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const day = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    return Date.parse(`${parts}T00:00:00Z`) / 86_400_000;
  };
  return rtf.format(Math.round(day(new Date(iso)) - day(now)), 'day');
}

export function isPast(iso: string, now = new Date()) {
  return new Date(iso).getTime() < now.getTime();
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  );
}
