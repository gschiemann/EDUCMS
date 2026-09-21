/**
 * Typed-or-picked date/time entry — the pure half.
 *
 * 2026-09-21 (operator, desktop Safari, playlist Schedule dialog): "the date
 * picker in schedule is kinda tiny…also i think we should have time picker
 * menu but also be able to type it in". Safari's native `<input type=date>`
 * popup is small and unstyleable, and its native `<input type=time>` has no
 * menu at all — so the fields become our own text inputs backed by `TimeField`
 * / `DateField`, and every rule about what an operator may TYPE lives here,
 * away from React, where it can be tested exhaustively.
 *
 * The wire formats never change: time is `''` or 24-hour `HH:MM`, date is `''`
 * or `YYYY-MM-DD`. The hosts serialize a date with
 * `new Date(`${iso}T00:00:00`)` — LOCAL midnight — which is why every helper
 * here reads and writes LOCAL calendar parts and never round-trips through
 * `Date.toISOString()`.
 */

/** Sunday. US product; one constant so a locale-week change is one line. */
export const WEEK_STARTS_ON = 0;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * `YYYY-MM-DD` from a Date's LOCAL parts.
 *
 * NAMED BUG this replaces: `ScheduleWindowFields` computed its `min` with
 * `new Date().toISOString().slice(0, 10)`, which is the UTC date. After ~5pm
 * Pacific that is already tomorrow, so the `min` attribute pushed "today" out
 * of range and the operator could not schedule anything for the current day.
 */
export function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ── Time ───────────────────────────────────────────────────────────── */

/**
 * Anything an operator plausibly types → `HH:MM`, or null if it is not a time.
 *
 * Accepts `8a` · `8 AM` · `8:30p` · `8:30 pm` · `noon` · `midnight` ·
 * `14:00` · `1400` · `830` · `08` · `0`.
 *
 * THE ONE GUESS — a bare hour 1–12 with no am/pm and no leading zero is
 * ambiguous (`3` could be 03:00 or 15:00), so it takes a business-hours rule:
 *   7–11 → AM · 12 → PM (noon) · 1–6 → PM
 * i.e. `3` → 15:00, `130` → 13:30, `9` → 09:00. A LEADING ZERO opts out and
 * means literal 24-hour (`08` → 08:00, `0130` → 01:30), as does any hour ≥ 13.
 * The guess is safe because the field immediately re-renders the normalized
 * 12-hour display, so the operator SEES what was assumed and can correct it by
 * typing `5a`.
 */
export function parseTypedTime(text: string): string | null {
  const s = (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';

  // Split a trailing meridiem off: `a`, `am`, `a.m.`, `p`, `pm`, `p.m.`.
  let body = s;
  let meridiem: 'a' | 'p' | null = null;
  const withMeridiem = /^(.*?)\s*([ap])\.?\s*(?:m\.?)?$/.exec(s);
  if (withMeridiem) {
    body = withMeridiem[1].trim();
    meridiem = withMeridiem[2] as 'a' | 'p';
  }

  const split = splitHourMinute(body);
  if (!split) return null;
  const hour = Number(split.h);
  const minute = Number(split.m);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null; // `13pm` is not a time
    const h24 = meridiem === 'a' ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
    return `${pad2(h24)}:${pad2(minute)}`;
  }

  if (hour > 23) return null; // `24`, `2500`
  const explicit24 = split.h.length === 2 && split.h[0] === '0';
  if (!explicit24 && hour >= 1 && hour <= 6) return `${pad2(hour + 12)}:${pad2(minute)}`;
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** `8:30` / `0830` / `830` / `08` / `8` → hour + minute STRINGS (padding matters). */
function splitHourMinute(raw: string): { h: string; m: string } | null {
  const colon = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (colon) return { h: colon[1], m: colon[2] };
  const bare = /^(\d{1,4})$/.exec(raw);
  if (!bare) return null;
  const d = bare[1];
  if (d.length <= 2) return { h: d, m: '00' };
  return { h: d.slice(0, d.length - 2), m: d.slice(-2) };
}

/** `08:30` → `8:30 AM` in en-US. Empty / malformed → `''`. */
export function formatTimeDisplay(hhmm: string, locale?: string): string {
  const p = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!p) return '';
  const h = Number(p[1]);
  const m = Number(p[2]);
  if (h > 23 || m > 59) return '';
  return (
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
      .format(new Date(2000, 0, 1, h, m))
      // ICU ≥ 72 emits U+202F (narrow no-break space) before AM/PM and older
      // builds emit a plain space. Normalize so the text the operator sees —
      // and the text that gets re-parsed on the next commit — is identical on
      // every Node/browser ICU we ship against.
      .replace(/[  ]/g, ' ')
  );
}

/** Every `HH:MM` on a step, from 00:00. Default 15 min ⇒ 96 options. */
export function timeOptions(stepMinutes = 15): string[] {
  const step = Math.max(1, Math.floor(stepMinutes));
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  return out;
}

function toMinutes(hhmm: string): number | null {
  const p = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!p) return null;
  const h = Number(p[1]);
  const m = Number(p[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Index of the option closest to `hhmm`; -1 when it is not a time. */
export function nearestOptionIndex(hhmm: string, options: string[]): number {
  const target = toMinutes(hhmm);
  if (target === null || options.length === 0) return -1;
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < options.length; i++) {
    const v = toMinutes(options[i]);
    if (v === null) continue;
    const delta = Math.abs(v - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/* ── Date ───────────────────────────────────────────────────────────── */

export type DateOrder = 'mdy' | 'dmy';

/** Does this locale write the day before the month? (`10/12` ⇒ mdy vs dmy.) */
export function localeDateOrder(locale?: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2026, 9, 12));
    const day = parts.findIndex((p) => p.type === 'day');
    const month = parts.findIndex((p) => p.type === 'month');
    if (day >= 0 && month >= 0 && day < month) return 'dmy';
  } catch {
    /* Intl can throw on a malformed tag — fall through to the US default. */
  }
  return 'mdy';
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Full name or a ≥3-letter prefix → 0-based month. `ma` stays ambiguous ⇒ null. */
function monthFromName(word: string): number | null {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return null;
  const hits: number[] = [];
  for (let i = 0; i < MONTH_NAMES.length; i++) if (MONTH_NAMES[i].startsWith(w)) hits.push(i);
  return hits.length === 1 ? hits[0] : null;
}

/** Two-digit year → century, the usual pivot (00–69 ⇒ 2000s). */
function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

/** Local `new Date(y, m, d)` round-trip — the only honest "is this real" test. */
function isoIfReal(year: number, monthIndex: number, day: number): string | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, monthIndex, day);
  if (d.getFullYear() !== year || d.getMonth() !== monthIndex || d.getDate() !== day) return null;
  return toLocalIsoDate(d);
}

export interface ParseDateOptions {
  /** `YYYY-MM-DD` for "now" — the caller's LOCAL today, never a UTC slice. */
  today: string;
  /** Earliest date the host will accept. Used ONLY for the no-year rollover. */
  min?: string;
  /** How to read `10/12`. Default `'mdy'`; `localeDateOrder()` derives it. */
  order?: DateOrder;
}

/**
 * Anything an operator plausibly types → `YYYY-MM-DD`, or null.
 *
 * `2026-10-12` · `10/12/2026` · `10/12/26` · `10-12-2026` · `10.12.2026` ·
 * `10/12` · `Oct 12` · `October 12` · `Oct 12, 2026` · `12 Oct` ·
 * `12 October 2026` · `today` · `tomorrow`.
 *
 * A form with NO year means the next such date that is not already behind the
 * floor (`min ?? today`) — typing `10/12` in November means next year, which is
 * what an operator scheduling forward means. `min` is used for THAT and
 * nothing else: enforcing it is the component's job, because only the
 * component can explain why a date was refused.
 */
export function parseTypedDate(text: string, opts: ParseDateOptions): string | null {
  const s = (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Drop a leading weekday. `formatDateDisplay` writes one ("Mon, Oct 12,
    // 2026") and the field re-reads its own display on commit, so without
    // this the field's own text does not parse — which flagged an untouched,
    // perfectly good date as unreadable the moment focus left it. No month
    // name begins with one of these, so the strip is unambiguous.
    .replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,? /, '');
  if (!s) return null;

  const todayIso = /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : toLocalIsoDate(new Date());
  const [ty, tm, td] = todayIso.split('-').map(Number);

  if (s === 'today') return todayIso;
  if (s === 'tomorrow') return toLocalIsoDate(new Date(ty, tm - 1, td + 1));

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return isoIfReal(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const order = opts.order ?? 'mdy';
  const floor = opts.min && /^\d{4}-\d{2}-\d{2}$/.test(opts.min) ? opts.min : todayIso;

  /** No-year forms resolve to this year, or next year if already behind. */
  const resolveNoYear = (monthIndex: number, day: number): string | null => {
    const thisYear = isoIfReal(ty, monthIndex, day);
    if (thisYear && thisYear >= floor) return thisYear;
    return isoIfReal(ty + 1, monthIndex, day) ?? thisYear;
  };

  // 10/12/2026 · 10/12/26 · 10-12-2026 · 10.12.2026 · 10/12
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const monthIndex = (order === 'dmy' ? second : first) - 1;
    const day = order === 'dmy' ? first : second;
    if (!numeric[3]) return resolveNoYear(monthIndex, day);
    return isoIfReal(expandYear(numeric[3]), monthIndex, day);
  }

  // Oct 12 · October 12 · Oct 12 2026 · Oct 12, 2026
  const monthFirst = /^([a-z]+)\.? (\d{1,2})(?:,? ?(\d{2}|\d{4}))?$/.exec(s);
  if (monthFirst) {
    const monthIndex = monthFromName(monthFirst[1]);
    if (monthIndex === null) return null;
    const day = Number(monthFirst[2]);
    if (!monthFirst[3]) return resolveNoYear(monthIndex, day);
    return isoIfReal(expandYear(monthFirst[3]), monthIndex, day);
  }

  // 12 Oct · 12 October 2026
  const dayFirst = /^(\d{1,2}) ([a-z]+)\.?(?:,? ?(\d{2}|\d{4}))?$/.exec(s);
  if (dayFirst) {
    const monthIndex = monthFromName(dayFirst[2]);
    if (monthIndex === null) return null;
    const day = Number(dayFirst[1]);
    if (!dayFirst[3]) return resolveNoYear(monthIndex, day);
    return isoIfReal(expandYear(dayFirst[3]), monthIndex, day);
  }

  return null;
}

/** `2026-10-12` → `Mon, Oct 12, 2026`. Empty / malformed → `''`. */
export function formatDateDisplay(iso: string, locale?: string): string {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!p) return '';
  // LOCAL parts, never `new Date(iso)` — that parses as UTC midnight and shows
  // the previous day west of Greenwich.
  const d = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export interface MonthCell {
  iso: string;
  day: number;
  /** False for the leading/trailing days borrowed from the neighbouring month. */
  inMonth: boolean;
}

/** Always 42 cells (6 rows × 7) so the popover never changes height month to month. */
export function buildMonthGrid(
  year: number,
  monthIndex: number,
  weekStartsOn: number = WEEK_STARTS_ON,
): MonthCell[] {
  const first = new Date(year, monthIndex, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, monthIndex, 1 - lead + i);
    cells.push({
      iso: toLocalIsoDate(d),
      day: d.getDate(),
      inMonth: d.getFullYear() === year && d.getMonth() === monthIndex,
    });
  }
  return cells;
}
