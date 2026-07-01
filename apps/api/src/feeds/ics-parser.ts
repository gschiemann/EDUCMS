/**
 * Pure iCalendar (RFC 5545) parser. No network, no NestJS deps — takes raw
 * .ics text, returns a normalized `IcsFeedResult`.
 *
 * Hand-rolled (no dependency — `node-ical`/`ical.js` do not exist anywhere
 * in this monorepo's dependency tree; see feeds module research). ICS is a
 * simple line-oriented format, so a focused parser is a few hundred lines
 * and avoids a new lockfile entry for something this bounded.
 *
 * Scope (documented honestly, not silently dropped — CLAUDE.md Standard
 * Audit Surface §16 "swallowed-error sweep" applies to recurrence too):
 *   - VEVENT DTSTART/DTEND/SUMMARY/LOCATION — full support, all-day (VALUE=DATE)
 *     and timed (VALUE=DATE-TIME, with or without TZID) forms.
 *   - RRULE — we expand FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with a plain
 *     INTERVAL, for the next `EXPAND_WINDOW_DAYS` days from "now". This
 *     covers the overwhelming majority of real calendar recurrence (staff
 *     meetings, weekly practice, monthly board meetings).
 *   - RRULE forms we do NOT expand (BYDAY lists, BYSETPOS, COUNT combined
 *     with an unsupported FREQ, EXRULE, RDATE/EXDATE overrides): the event's
 *     FIRST occurrence (its DTSTART) is still returned, and
 *     `meta.hasUnexpandedRecurrence` is set `true` so the caller/UI can show
 *     an honest "some recurring events may be incomplete" caveat instead of
 *     silently under-representing the calendar.
 *   - VTIMEZONE blocks are not resolved to real UTC offsets — timed events
 *     with a `TZID` param are treated as floating local time (parsed as if
 *     UTC). This is a known simplification; documented, not hidden.
 */

import { CalendarEvent, IcsFeedResult } from './feeds.types';

export const MAX_CALENDAR_EVENTS = 200;
export const EXPAND_WINDOW_DAYS = 30;
// Non-recurring ("one-off") events are shown out to a more generous horizon
// than the recurrence-EXPANSION window — expanding a WEEKLY RRULE out a full
// year would be thousands of wasted occurrences, but a single one-off event
// is one row regardless of how far out it is. Without a horizon at all,
// though, a calendar that lists holidays years into the future (a real
// shape — Google's public holiday calendars do this) would flood a signage
// "Upcoming Events" widget with entries a customer will never care about
// today. 120 days (~4 months) is a reasonable "what's actually upcoming"
// horizon for a lobby display; MAX_CALENDAR_EVENTS is the hard backstop
// regardless of horizon.
export const ONE_OFF_HORIZON_DAYS = 120;
const MAX_TITLE_LEN = 300;
const MAX_LOCATION_LEN = 300;

export class IcsParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'IcsParseError';
  }
}

interface RawProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawVEvent {
  props: RawProperty[];
}

/** RFC 5545 §3.1 line unfolding: a line starting with a space or tab is a
 *  continuation of the previous line (folded for 75-octet transport). */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Parse one unfolded content line into NAME;PARAM=VAL;...:VALUE. */
function parseLine(line: string): RawProperty | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = head.split(';');
  const name = (parts[0] || '').toUpperCase().trim();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

/** Unescape ICS TEXT value escaping (RFC 5545 §3.3.11): \\, \;, \,, \n. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Parse a DATE (YYYYMMDD) or DATE-TIME (YYYYMMDDTHHMMSS[Z]) value into a
 *  JS Date. TZID-qualified local times are treated as floating (parsed as
 *  UTC) — see module doc. Returns null if unparseable. */
function parseIcsDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  const v = value.trim();
  const isDateOnly = params['VALUE'] === 'DATE' || /^\d{8}$/.test(v);

  if (isDateOnly) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : { date, allDay: true };
  }

  // DATE-TIME: YYYYMMDDTHHMMSS optionally suffixed with Z (UTC).
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // Floating/TZID times: treated as UTC (documented simplification above).
  // `z` presence doesn't change the math since we always build via Date.UTC,
  // but kept for clarity/future TZID-resolution work.
  void z;
  const date = new Date(utcMs);
  return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
}

/** Split VCALENDAR text into top-level VEVENT blocks (properties only —
 *  nested VALARM/VTIMEZONE blocks are skipped, not needed for our fields). */
function extractVEvents(lines: string[]): RawVEvent[] {
  const events: RawVEvent[] = [];
  let current: RawVEvent | null = null;
  let skipDepth = 0; // depth of nested BEGIN blocks we don't care about (VALARM, etc.)

  for (const raw of lines) {
    if (!raw) continue;
    const prop = parseLine(raw);
    if (!prop) continue;

    if (prop.name === 'BEGIN') {
      if (prop.value.toUpperCase() === 'VEVENT' && skipDepth === 0) {
        current = { props: [] };
      } else if (current) {
        skipDepth++; // inside VEVENT but a nested block (VALARM) — skip its props
      }
      continue;
    }
    if (prop.name === 'END') {
      if (prop.value.toUpperCase() === 'VEVENT' && skipDepth === 0 && current) {
        events.push(current);
        current = null;
      } else if (skipDepth > 0) {
        skipDepth--;
      }
      continue;
    }
    if (current && skipDepth === 0) {
      current.props.push(prop);
    }
  }
  return events;
}

function getProp(props: RawProperty[], name: string): RawProperty | undefined {
  return props.find((p) => p.name === name);
}

interface SimpleRRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: Date;
  /** true if the RRULE had modifiers we don't honor (BYDAY, BYSETPOS, etc.)
   *  — we still expand on FREQ/INTERVAL/COUNT/UNTIL, but flag it so the
   *  caller can be honest about approximation. */
  hasUnsupportedModifiers: boolean;
}

/** Parse a small, common subset of RRULE (RFC 5545 §3.3.10). Returns null
 *  for a value we can't safely interpret at all (e.g. no FREQ). */
function parseRRule(value: string): SimpleRRule | null {
  const parts = value.split(';').reduce<Record<string, string>>((acc, kv) => {
    const eq = kv.indexOf('=');
    if (eq > 0) acc[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
    return acc;
  }, {});
  const freq = parts['FREQ'] as SimpleRRule['freq'] | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const interval = parts['INTERVAL'] ? parseInt(parts['INTERVAL'], 10) : 1;
  const count = parts['COUNT'] ? parseInt(parts['COUNT'], 10) : undefined;
  let until: Date | undefined;
  if (parts['UNTIL']) {
    const parsed = parseIcsDate(parts['UNTIL'], {});
    if (parsed) until = parsed.date;
  }

  // Any key beyond FREQ/INTERVAL/COUNT/UNTIL/WKST means we're only
  // approximating (e.g. BYDAY=MO,WE,FR on a WEEKLY rule expands to every
  // day at our INTERVAL cadence instead of just those weekdays).
  const KNOWN = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST']);
  const hasUnsupportedModifiers = Object.keys(parts).some((k) => !KNOWN.has(k));

  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    count: Number.isFinite(count as number) ? count : undefined,
    until,
    hasUnsupportedModifiers,
  };
}

function addOccurrence(base: Date, freq: SimpleRRule['freq'], interval: number, n: number): Date {
  const d = new Date(base.getTime());
  switch (freq) {
    case 'DAILY':
      d.setUTCDate(d.getUTCDate() + interval * n);
      break;
    case 'WEEKLY':
      d.setUTCDate(d.getUTCDate() + interval * n * 7);
      break;
    case 'MONTHLY':
      d.setUTCMonth(d.getUTCMonth() + interval * n);
      break;
    case 'YEARLY':
      d.setUTCFullYear(d.getUTCFullYear() + interval * n);
      break;
  }
  return d;
}

export function parseIcs(text: string, now: Date = new Date()): IcsFeedResult {
  if (!text || !/BEGIN:VCALENDAR/i.test(text)) {
    throw new IcsParseError('Document was not a recognizable iCalendar (.ics) file');
  }

  const lines = unfoldLines(text);
  const vevents = extractVEvents(lines);

  const events: CalendarEvent[] = [];
  let recurringEventCount = 0;
  let hasUnexpandedRecurrence = false;

  const windowStart = now;
  const windowEnd = new Date(now.getTime() + EXPAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const oneOffHorizon = new Date(now.getTime() + ONE_OFF_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  for (const ev of vevents) {
    const summaryProp = getProp(ev.props, 'SUMMARY');
    const dtStartProp = getProp(ev.props, 'DTSTART');
    const dtEndProp = getProp(ev.props, 'DTEND');
    const locationProp = getProp(ev.props, 'LOCATION');
    const rruleProp = getProp(ev.props, 'RRULE');

    if (!dtStartProp) continue; // DTSTART is mandatory; skip anything without it
    const start = parseIcsDate(dtStartProp.value, dtStartProp.params);
    if (!start) continue;

    const title = clamp(unescapeText(summaryProp?.value || '(untitled event)'), MAX_TITLE_LEN);
    const location = locationProp?.value ? clamp(unescapeText(locationProp.value), MAX_LOCATION_LEN) : null;

    let endDate: Date | null = null;
    if (dtEndProp) {
      const end = parseIcsDate(dtEndProp.value, dtEndProp.params);
      if (end) endDate = end.date;
    }
    const durationMs = endDate ? endDate.getTime() - start.date.getTime() : 0;

    const pushEvent = (occStart: Date) => {
      const occEnd = durationMs > 0 ? new Date(occStart.getTime() + durationMs) : null;
      events.push({
        title,
        start: occStart.toISOString(),
        end: occEnd ? occEnd.toISOString() : null,
        location,
        allDay: start.allDay,
      });
    };

    if (!rruleProp) {
      // Non-recurring: include if it falls within [yesterday, ONE_OFF_HORIZON]
      // — a wider horizon than the (deliberately short, cost-bounded)
      // recurrence-expansion window, so a one-off event 60 days out doesn't
      // vanish just because we don't expand RECURRENCE that far. Still
      // BOUNDED (not unlimited) so a calendar listing entries years into the
      // future (real shape — public holiday .ics feeds do this) doesn't
      // flood a signage widget with dozens of irrelevant future rows.
      if (
        start.date.getTime() >= windowStart.getTime() - 24 * 60 * 60 * 1000 &&
        start.date.getTime() <= oneOffHorizon.getTime()
      ) {
        pushEvent(start.date);
      }
      continue;
    }

    recurringEventCount++;
    const rule = parseRRule(rruleProp.value);
    if (!rule) {
      // Unparseable RRULE — still surface the DTSTART occurrence so the
      // event isn't silently dropped entirely.
      hasUnexpandedRecurrence = true;
      if (start.date.getTime() >= windowStart.getTime() - 24 * 60 * 60 * 1000) {
        pushEvent(start.date);
      }
      continue;
    }
    if (rule.hasUnsupportedModifiers) hasUnexpandedRecurrence = true;

    // Expand occurrences within [windowStart, windowEnd], honoring COUNT/
    // UNTIL when present. Hard iteration cap so a pathological RRULE
    // (INTERVAL=0 normalized to 1, FREQ=DAILY, no COUNT/UNTIL) can't spin
    // forever — bounded by both the date window and MAX_ITERATIONS.
    const MAX_ITERATIONS = 3660; // ~10 years of daily occurrences, generous ceiling
    for (let n = 0; n < MAX_ITERATIONS; n++) {
      const occ = addOccurrence(start.date, rule.freq, rule.interval, n);
      if (occ.getTime() > windowEnd.getTime()) break;
      if (rule.until && occ.getTime() > rule.until.getTime()) break;
      if (rule.count != null && n >= rule.count) break;
      if (occ.getTime() >= windowStart.getTime() - 24 * 60 * 60 * 1000) {
        pushEvent(occ);
        if (events.length >= MAX_CALENDAR_EVENTS) break;
      }
    }

    if (events.length >= MAX_CALENDAR_EVENTS) break;
  }

  // Sort chronologically — VEVENTs in an .ics file are in no guaranteed
  // order, and recurrence expansion interleaves further.
  events.sort((a, b) => a.start.localeCompare(b.start));

  return {
    events: events.slice(0, MAX_CALENDAR_EVENTS),
    meta: {
      recurringEventCount,
      recurrenceExpansionDays: EXPAND_WINDOW_DAYS,
      hasUnexpandedRecurrence,
    },
  };
}
