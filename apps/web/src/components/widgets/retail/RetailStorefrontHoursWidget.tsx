'use client';

/**
 * RetailStorefrontHoursWidget — store-hours card with open/closed indicator.
 *
 * Used as the welcome-board chrome: renders a tidy day-by-day hours
 * table with the current day highlighted, and a live open/closed pill
 * computed from `openHours`. Reads as the printed "STORE HOURS" plate
 * in a department-store window — restrained type, tracked uppercase
 * day labels, ink-on-parchment palette by default.
 *
 * Hours strings are accepted free-form ("10am – 9pm" / "Closed") so
 * the widget never tries to math out edge cases. We do compute the
 * open/closed pill for the current weekday by parsing the first
 * 12-hour range we find in today's string; falls back to "Open today"
 * if the parse is ambiguous.
 */

import { useEffect, useState } from 'react';
import { sceneCss } from '../scene-css';
import { WidgetEmptyState } from '../WidgetEmptyState';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

export interface RetailStorefrontHoursConfig {
  /** Eyebrow line above the headline e.g. "EST. 1998". */
  eyebrow?: string;
  /** Big serif headline / store name. */
  headline?: string;
  /** Italic subhead under headline. */
  subhead?: string;
  /** Hours per day. Each value is a free-form string (e.g. "10am – 9pm" / "Closed"). */
  openHours?: Partial<Record<DayKey, string>>;
  /** Force the open/closed pill rather than computing it. 'auto' (default) | 'open' | 'closed'. */
  statusOverride?: 'auto' | 'open' | 'closed';
  /** Background color. */
  bgColor?: string;
  /** Body text color. */
  inkColor?: string;
  /** Accent color for headline + open pill. */
  accentColor?: string;
}

// §19, 2026-09-11. A DEMO_HOURS table stood here and was MERGED UNDER the
// operator's own hours (`{ ...DEMO_HOURS, ...c.openHours }`), so any day he
// had not filled in silently showed invented trading hours. Worse, those
// hours drive the live OPEN NOW / CLOSED pill below — an un-configured widget
// told shoppers the store was open at 10am on a Sunday it is shut. A day with
// no hours now renders as blank, and the pill only makes a claim it can back.

/**
 * Parse a free-form hours string and return whether `now` is inside
 * the first detected range. Returns null if we can't parse the string.
 */
function isOpenForRange(rangeStr: string, now: Date): boolean | null {
  if (!rangeStr) return null;
  if (/closed/i.test(rangeStr)) return false;

  // Match e.g. "10am - 9pm", "10:30 am – 9 pm", "9:00am-9:30pm"
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const m = rangeStr.match(re);
  if (!m) return null;

  let h1 = parseInt(m[1] || '0', 10);
  const min1 = parseInt(m[2] || '0', 10);
  let h2 = parseInt(m[4] || '0', 10);
  const min2 = parseInt(m[5] || '0', 10);
  const mer1 = (m[3] || '').toLowerCase();
  const mer2 = (m[6] || '').toLowerCase();

  // If only one meridiem given, assume both share it (e.g. "10 - 6 pm").
  const mer1Final = mer1 || mer2;
  const mer2Final = mer2 || mer1;
  if (mer1Final === 'pm' && h1 < 12) h1 += 12;
  if (mer1Final === 'am' && h1 === 12) h1 = 0;
  if (mer2Final === 'pm' && h2 < 12) h2 += 12;
  if (mer2Final === 'am' && h2 === 12) h2 = 0;

  const openMin = h1 * 60 + min1;
  const closeMin = h2 * 60 + min2;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= openMin && nowMin < closeMin;
}

export function RetailStorefrontHoursWidget({
  config,
}: {
  config?: RetailStorefrontHoursConfig;
  live?: boolean;
}) {
  const c: RetailStorefrontHoursConfig = config || {};
  // §19: 'EST. 1998 · MAIN STREET' and 'Step inside · A new season is here.'
  // were DEFAULTS — a founding year and a marketing line invented for a store
  // that never supplied either. Blank omits the line. 'Welcome.' stays as the
  // headline default: it is a generic greeting, not a claim about the business.
  const eyebrow = (c.eyebrow ?? '').trim();
  const headline = c.headline ?? 'Welcome.';
  const subhead = (c.subhead ?? '').trim();
  const hours = (c.openHours || {}) as Partial<Record<DayKey, string>>;
  const hasAnyHours = DAY_KEYS.some((k) => (hours[k] || '').trim());
  const bg = c.bgColor ?? '#faf6f1';
  const ink = c.inkColor ?? '#1a1411';
  const accent = c.accentColor ?? '#9a2d2d';

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayKey: DayKey | null = now ? DAY_KEYS[now.getDay()] : null;
  let isOpen: boolean | null = null;
  if (c.statusOverride === 'open') isOpen = true;
  else if (c.statusOverride === 'closed') isOpen = false;
  else if (now && todayKey && (hours[todayKey] || '').trim()) isOpen = isOpenForRange(hours[todayKey] as string, now);

  // §19: the old third arm said 'OPEN TODAY' whenever we could not work out
  // the answer — a claim made from ignorance. Now an unknown state shows no
  // pill at all rather than asserting the store is open.
  const statusLabel = isOpen === true ? 'OPEN NOW' : isOpen === false ? 'CLOSED' : null;

  // Nothing configured at all — no hours, no copy of the operator's own.
  if (!hasAnyHours && !eyebrow && !subhead && !(c.headline || '').trim()) {
    return (
      <WidgetEmptyState
        eyebrow="STORE HOURS"
        action="Add your opening hours"
        hint="Properties → Hours"
        accent={accent}
        tone="light"
      />
    );
  }

  return (
    <div
      className="rshw-root"
      style={
        {
          '--rshw-bg': bg,
          '--rshw-ink': ink,
          '--rshw-accent': accent,
        } as React.CSSProperties
      }
    >
      <style>{sceneCss(CSS)}</style>

      <div className="rshw-header">
        {eyebrow ? <div className="rshw-eyebrow">{eyebrow}</div> : null}
        <h1 className="rshw-headline">{headline}</h1>
        {subhead && <div className="rshw-subhead">{subhead}</div>}
      </div>

      {statusLabel ? (
        <div className="rshw-status-row">
          <span
            className={`rshw-pill ${isOpen === false ? 'rshw-pill-closed' : 'rshw-pill-open'}`}
          >
            <span className="rshw-pill-dot" />
            {statusLabel}
          </span>
        </div>
      ) : null}

      <div className="rshw-hours-card">
        <div className="rshw-hours-title">Store Hours</div>
        <ul className="rshw-hours-list">
          {DAY_KEYS.map((d) => (
            <li
              className={`rshw-hours-row ${d === todayKey ? 'rshw-hours-today' : ''}`}
              key={d}
            >
              <span className="rshw-hours-day">{DAY_LABELS[d]}</span>
              <span className="rshw-hours-dots" aria-hidden />
              {/* §19: this said 'Closed' for any day the operator had not filled
                  in — asserting a shut door from a blank field. An em dash says
                  "not stated"; an operator who IS shut that day types "Closed". */}
              <span className="rshw-hours-time">{(hours[d] || '').trim() || '—'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

.rshw-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: var(--rshw-bg, #faf6f1);
  color: var(--rshw-ink, #1a1411);
  font-family: 'Inter', sans-serif;
  padding: clamp(20px, 4cqh, 60px) clamp(24px, 5cqw, 72px);
  display: flex; flex-direction: column;
  container-type: size;
  overflow: hidden;
  gap: clamp(8px, 1.5cqh, 16px);
}
.rshw-header { flex: none; }
.rshw-eyebrow {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(10px, 1.5cqh, 14px);
  letter-spacing: 0.5em;
  text-transform: uppercase;
  color: var(--rshw-accent);
}
.rshw-headline {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(28px, 7cqh, 88px);
  line-height: 1.0;
  letter-spacing: -0.015em;
  margin: 6px 0 0 0;
}
.rshw-subhead {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(14px, 2.2cqh, 24px);
  opacity: 0.7;
  margin-top: clamp(4px, 1cqh, 10px);
}

.rshw-status-row {
  display: flex; flex: none;
  margin-top: clamp(6px, 1cqh, 12px);
}
.rshw-pill {
  display: inline-flex; align-items: center;
  gap: clamp(6px, 1cqw, 10px);
  padding: 6px 14px;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.5cqh, 13px);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  border-radius: 999px;
}
.rshw-pill-open {
  background: rgba(20,120,60,0.14);
  color: #167a40;
}
.rshw-pill-closed {
  background: rgba(154,45,45,0.14);
  color: var(--rshw-accent);
}
.rshw-pill-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
  animation: rshw-pulse 1.6s ease-in-out infinite;
}
@keyframes rshw-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.6; transform: scale(0.85); }
}

.rshw-hours-card {
  flex: 1;
  margin-top: clamp(8px, 2cqh, 18px);
  border-top: 1px solid rgba(0,0,0,0.12);
  padding-top: clamp(12px, 2.5cqh, 24px);
  min-height: 0;
  /* Become a flex column so the day list can claim the remaining
     height and spread the rows instead of bunching at the top. */
  display: flex; flex-direction: column;
}
.rshw-hours-title {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.4cqh, 13px);
  letter-spacing: 0.5em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-bottom: clamp(8px, 1.5cqh, 14px);
  flex: 0 0 auto;
}
.rshw-hours-list {
  list-style: none;
  padding: 0; margin: 0;
  display: flex; flex-direction: column;
  /* Fill + distribute the 7 day rows across the card height. */
  flex: 1 1 0; min-height: 0;
  justify-content: space-between;
  gap: clamp(4px, 0.8cqh, 8px);
}
.rshw-hours-row {
  display: flex; align-items: baseline;
  flex: 0 1 auto;
  gap: clamp(6px, 1cqw, 12px);
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(12px, 1.9cqh, 18px);
  letter-spacing: 0.04em;
  opacity: 0.8;
}
.rshw-hours-today {
  font-weight: 700;
  opacity: 1;
  color: var(--rshw-accent);
}
.rshw-hours-day {
  flex: none;
  min-width: 8ch;
}
.rshw-hours-dots {
  flex: 1;
  border-bottom: 1px dotted currentColor;
  opacity: 0.45;
  transform: translateY(-3px);
}
.rshw-hours-time {
  flex: none;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
`;
