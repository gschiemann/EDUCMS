/**
 * Shared normalized shapes for the feeds module (RSS/Atom + ICS).
 *
 * Both `GET /api/v1/feeds/rss` and `GET /api/v1/feeds/ics` return one of
 * these envelopes — a stable, widget-friendly shape regardless of the
 * upstream format quirks (RSS 2.0 vs Atom, VEVENT vs VEVENT+RRULE, etc.).
 */

export interface FeedItem {
  title: string;
  link: string;
  /** ISO-8601 string, or null when the source didn't provide one. */
  publishedAt: string | null;
  /** Feed-level title (channel/feed name), repeated on every item so a
   *  widget can show "via <source>" without a second lookup. */
  source: string;
}

export interface RssFeedResult {
  title: string;
  items: FeedItem[];
  /** True when the upstream response was served from cache (RSS/ICS
   *  cache layer), so callers/tests can distinguish origin hits. */
  cached?: boolean;
}

export interface CalendarEvent {
  title: string;
  /** ISO-8601 start. */
  start: string;
  /** ISO-8601 end, or null when the source only gave a start time. */
  end: string | null;
  location: string | null;
  allDay: boolean;
}

export interface IcsFeedResult {
  events: CalendarEvent[];
  cached?: boolean;
  meta: {
    /** How many VEVENTs carried an RRULE (recurrence). */
    recurringEventCount: number;
    /** Recurring events are expanded for this many days from "now" —
     *  see feeds.service.ts EXPAND_WINDOW_DAYS. Any occurrence beyond
     *  this window is simply not present in `events`; we never silently
     *  drop a recurring event without saying so here. */
    recurrenceExpansionDays: number;
    /** True if any RRULE used a form we don't expand (e.g. COUNT with an
     *  unsupported FREQ) — such events are represented ONLY by their
     *  first (DTSTART) occurrence. Lets the UI show an honest caveat
     *  instead of silently under-representing a recurring meeting. */
    hasUnexpandedRecurrence: boolean;
  };
}
