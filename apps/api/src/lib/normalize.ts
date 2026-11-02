/** Lowercase + trim only. Gmail dots and plus aliases are kept, as the spec requires (§8.2). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Keeps a leading + and the digits. Returns null when the result is not a plausible number. */
export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'agency';
}
