/**
 * Schedule-window evaluation + edge detection (2026-08-30 deep audit,
 * findings B-P0-1 / B-P0-2 / B-P0-3).
 *
 * THE HISTORY, HONESTLY. Playlist-level daysOfWeek/timeStart/timeEnd have
 * existed in the product for months — and were NEVER enforced on the glass:
 * the manifest's per-item payload never carried the fields, so the player's
 * per-item gate always returned "playable". The 2026-08-30 ranked-winner
 * change started consulting `pl.schedule` windows for winner selection —
 * i.e. it silently switched enforcement on for the whole fleet — with two
 * latching bugs the adversarial audit caught before they shipped further:
 *
 *   1. The inline compare had no overnight wrap: a 22:00–06:00 window was
 *      NEVER open (23:00 fails `>` end; 02:00 fails `<` start). Every bar,
 *      gym and hotel board with a night window → permanently dark.
 *   2. Windows were only evaluated on a 200 — and the steady state is 304,
 *      because window bounds are constants inside the ETag-hashed payload.
 *      06:59 and 07:00 serve byte-identical 304s, so a verdict, once
 *      applied, LATCHED: blank at boot-outside-window stayed blank all
 *      day; blank at window-close never came back.
 *
 * This module is the deliberate version: a pure, wrap-aware evaluator
 * (unit-tested for every window shape) plus a WINDOW SIGNATURE the reconcile
 * loop diffs before each poll — when the local verdict for the last-applied
 * manifest changes (a window edge crossed), the caller drops its ETag so the
 * next poll is a full 200 and selection re-runs. Cost: one full manifest
 * body per screen per window edge (typically ≤2/day), not per poll.
 *
 * DAY SEMANTICS FOR WRAPPING WINDOWS: the START day owns the whole window.
 * A `Fri 22:00–06:00` schedule covers Friday 22:00 → Saturday 06:00 (the
 * operator scheduled "Friday night", and Friday night ends Saturday
 * morning). Concretely: a time inside the pre-midnight half must match
 * TODAY in daysOfWeek; a time inside the post-midnight half must match
 * YESTERDAY.
 */

export interface WindowFields {
  daysOfWeek?: string | null; // "Mon,Tue,Wed" — day-name substrings
  timeStart?: string | null;  // "HH:MM"
  timeEnd?: string | null;    // "HH:MM"
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function dayMatches(daysOfWeek: string, dayIndex: number): boolean {
  return daysOfWeek.includes(DAY_NAMES[((dayIndex % 7) + 7) % 7]);
}

/** The wall clock a window is judged against: "HH:MM" and 0 = Sunday … 6 = Saturday. */
export interface WallClock {
  hhmm: string;
  dayIndex: number;
  /** Where the wall clock came from — evidence for a log line, never a decision input. */
  source: 'zone' | 'device';
}

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

/**
 * A formatter for `zone`, or null when this runtime does not know the zone
 * (or `zone` is empty). Cached: construction is the expensive part, and the
 * reconcile loop asks several times a minute. `Intl.DateTimeFormat` with a
 * `timeZone` + `formatToParts` is Chrome 57+ and `hourCycle` Chrome 73+, so
 * this runs on the Chromium-83 LED controllers too.
 */
function zoneFormatter(zone: string | null | undefined): Intl.DateTimeFormat | null {
  if (typeof zone !== 'string') return null;
  const key = zone.trim();
  if (!key) return null;
  const cached = zoneFormatters.get(key);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      hourCycle: 'h23',
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    fmt = null;
  }
  zoneFormatters.set(key, fmt);
  return fmt;
}

/**
 * THE WALL CLOCK A WINDOW IS JUDGED AGAINST (2026-10-24).
 *
 * Signage windows are wall-clock local by definition — local to the SCREEN,
 * which is the manifest's effective `timeZone` (screenTimeZone.ts: the
 * screen's override, else the location's setting, else the automatic zone
 * from the address). Until this change they were judged against the DEVICE's
 * clock, so a Goodview GUQ left on Asia/Shanghai switched its lunch menu and
 * its weekday boards about fifteen hours off while its clocks already showed
 * the right time.
 *
 * Three answers, kept apart exactly as screenTimeZone.ts keeps them: a zone
 * the runtime can format in → that zone's wall clock; `null` / `undefined`
 * (the server has no zone, an older manifest) → the device's clock, as
 * before; a zone the runtime does NOT know → the device's clock too, never a
 * throw and never UTC (a window must not silently move to Greenwich because
 * a column holds a typo).
 */
export function wallClockAt(now: Date, zone?: string | null): WallClock {
  const fmt = zoneFormatter(zone);
  if (fmt) {
    try {
      const parts = fmt.formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      let hour = Number(get('hour'));
      if (hour === 24) hour = 0; // an engine without `hourCycle` renders midnight as 24
      const minute = Number(get('minute'));
      const dayIndex = DAY_INDEX[get('weekday')];
      if (Number.isFinite(hour) && Number.isFinite(minute) && dayIndex !== undefined) {
        return {
          hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          dayIndex,
          source: 'zone',
        };
      }
    } catch {
      /* fall through to the device clock */
    }
  }
  return {
    hhmm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    dayIndex: now.getDay(),
    source: 'device',
  };
}

/**
 * Is this schedule's window open at `now`, judged on the wall clock of
 * `zone` (the screen's effective time zone) — or on the device's clock when
 * no zone is known? See [wallClockAt].
 */
export function isWindowOpen(sched: WindowFields | null | undefined, now: Date, zone?: string | null): boolean {
  if (!sched) return true;
  const daysOfWeek = sched.daysOfWeek ? String(sched.daysOfWeek) : null;
  const start = sched.timeStart || null;
  const end = sched.timeEnd || null;
  if (!daysOfWeek && !start && !end) return true;

  const { hhmm, dayIndex: today } = wallClockAt(now, zone);

  const wraps = !!(start && end && end < start);
  if (!wraps) {
    // Simple same-day window (or open-ended one side).
    if (daysOfWeek && !dayMatches(daysOfWeek, today)) return false;
    if (start && hhmm < start) return false;
    if (end && hhmm > end) return false;
    return true;
  }

  // Overnight wrap: open when at/after start (the pre-midnight half, owned
  // by TODAY) or at/before end (the post-midnight half, owned by YESTERDAY).
  if (hhmm >= (start as string)) {
    return daysOfWeek ? dayMatches(daysOfWeek, today) : true;
  }
  if (hhmm <= (end as string)) {
    return daysOfWeek ? dayMatches(daysOfWeek, today - 1) : true;
  }
  return false;
}

/**
 * One character per playlist: '1' open / '0' closed, in manifest order.
 * The reconcile loop compares this against the signature computed when the
 * manifest was APPLIED; a difference means a window edge was crossed and
 * the cached 304 identity is no longer the truth on the glass.
 */
export function windowSignature(
  playlists: Array<{ schedule?: WindowFields | null }> | null | undefined,
  now: Date,
  zone?: string | null,
): string {
  if (!Array.isArray(playlists) || playlists.length === 0) return '';
  return playlists.map((pl) => (isWindowOpen(pl?.schedule ?? null, now, zone) ? '1' : '0')).join('');
}

/** A playlist ITEM's own dayparting fields (PlaylistItem.daysOfWeek / timeStart / timeEnd). */
export interface ItemWindowFields {
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
}

/**
 * The per-ITEM gate the player has applied since the beginning, now on the
 * screen's wall clock (2026-10-24; it lived twice inline in page.tsx on the
 * device clock). Its semantics are kept EXACTLY — they are not the playlist
 * window's: a day gate by name substring; a time gate only when BOTH bounds
 * are set, inclusive at both ends, with NO overnight wrap (an item window
 * `22:00–06:00` is never open, as before — a playlist-level window is the
 * wrap-aware tool). Only the clock it reads changed.
 */
export function isItemWindowOpen(item: ItemWindowFields | null | undefined, now: Date, zone?: string | null): boolean {
  if (!item) return true;
  if (!item.daysOfWeek && !item.timeStart && !item.timeEnd) return true;
  const clock = wallClockAt(now, zone);
  if (item.daysOfWeek && !String(item.daysOfWeek).includes(DAY_NAMES[clock.dayIndex])) return false;
  if (item.timeStart && item.timeEnd) {
    const [sh, sm] = String(item.timeStart).split(':').map(Number);
    const [eh, em] = String(item.timeEnd).split(':').map(Number);
    const [ch, cm] = clock.hhmm.split(':').map(Number);
    const currentMins = ch * 60 + cm;
    if (currentMins < sh * 60 + sm || currentMins > eh * 60 + em) return false;
  }
  return true;
}
