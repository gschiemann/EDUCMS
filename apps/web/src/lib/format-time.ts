/**
 * Time formatting helpers — used by every bell-schedule / countdown /
 * clock widget so the entire app speaks 12-hour time consistently.
 *
 * 2026-05-03 — Operator: "Bell schedule is in military time and we
 * should not have that anywhere in the entire app." Created this
 * module as the single source of truth so we don't fork the parser
 * + formatter across the v2 pack, the legacy renderers, and the
 * editor. Add new time-display widgets to this module rather than
 * inlining parsing logic in the widget file.
 */

/**
 * Parse a loose time string into minutes-since-midnight (0-1439).
 * Accepts: "8", "8:30", "8am", "8:30 PM", "13:30", "08:30", "1:30pm".
 * Heuristic: bare hours 1-7 with no AM/PM marker are treated as PM
 * (so "1" → 13:00, common in school-day scheduling).
 * Returns null on parse failure.
 */
export function parseTimeToMinutes(input?: string | null): number | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Match: digits[:digits][space][am|pm|a|p]
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(s);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || '').toLowerCase().charAt(0); // 'a' / 'p' / ''
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  // Bare 1-7 with no marker → PM (e.g. school period at "1" = 1pm)
  if (!ap && h >= 1 && h <= 7) h += 12;
  return h * 60 + mm;
}

/**
 * Convert any input format to a canonical 12-hour display string
 * like "8:30am" / "1:05pm" / "12:00pm". Lowercase suffix (no space)
 * keeps the line tight in tight bell-schedule grids.
 *
 * Pass-through behavior: if the input fails to parse, the original
 * string is returned UNCHANGED so the operator's typo is still
 * visible (rather than silently dropped to empty).
 */
export function formatTime12(input?: string | null): string {
  if (!input) return '';
  const min = parseTimeToMinutes(input);
  if (min == null) return String(input);
  const h24 = Math.floor(min / 60);
  const mm = min % 60;
  const ap = h24 >= 12 ? 'pm' : 'am';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, '0')}${ap}`;
}

/**
 * Spaced variant — "8:30 AM" with uppercase AM/PM and a space.
 * Used by editor field normalization so the saved value reads
 * naturally when the user re-opens the form.
 */
export function formatTime12Spaced(input?: string | null): string {
  if (!input) return '';
  const min = parseTimeToMinutes(input);
  if (min == null) return String(input);
  const h24 = Math.floor(min / 60);
  const mm = min % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
