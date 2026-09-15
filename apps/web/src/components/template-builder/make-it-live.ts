/**
 * "Make it live" — turning an imported static design into a living one.
 * Package D of the template-import program (2026-09-15).
 *
 * WHY THIS EXISTS. Every competing signage CMS converts a deck or a PDF into
 * PIXELS and stops there — their own support docs say so ("documents are
 * transcoded into .png", "the content within this card is not editable", "you
 * can not edit text after importing"). VenueOS is the only one of these
 * products with a widget layer underneath the import. So the differentiator is
 * not the import; it is what the operator can do to an imported zone
 * afterwards: promote the "TODAY: TUESDAY" text box someone retypes every
 * Monday into a real CLOCK, and the menu block into the live LUNCH_MENU.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS "LIVE", AND WHY THE LIST IS ONLY SIX.
 *
 * A widget earns a place here only if it KEEPS ITSELF CURRENT with no operator
 * action — that is the whole promise the section's name makes. Each entry was
 * read in `WidgetRenderer.tsx` before it was listed, and each blurb states what
 * that code actually does:
 *
 *   CLOCK          real clock, ticks.
 *   COUNTDOWN      real clock against a target date.
 *   WEATHER        fetches conditions and re-fetches every 15 minutes.
 *   LUNCH_MENU     `LunchMenuBoard` picks today's row off a 60s clock tick.
 *   BELL_SCHEDULE  `BellScheduleBoard` marks the period the real clock is in.
 *   CALENDAR       merges a live ICS feed (`useLiveIcsFeed`) when one is set.
 *
 * TICKER and ANNOUNCEMENT are deliberately NOT here. They move, but their copy
 * is static config an operator still has to retype — putting them under a
 * heading that says "live" would be the same over-claim the import copy itself
 * is being fixed for in Package A. They are one click away in the full widget
 * library, which is exactly where a non-live widget swap belongs.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE SUGGESTION HEURISTIC IS A SUGGESTION ORDER, NOT MAGIC.
 *
 * It reads the copy already on the zone and moves at most three live widgets to
 * the front, each with the matched phrase quoted back so the operator can see
 * exactly what we noticed and disagree with it. Every live widget stays
 * reachable whether or not anything matched, and the full 385-variant library
 * is one button further on. A rule that fires wrongly costs a reordering; it
 * can never hide an option or change anything on its own.
 *
 * Kept deliberately small and readable — one short regex per line, each one
 * checkable by eye. No scoring, no weights, no model.
 */
import type { Zone } from './types';

export interface LiveWidget {
  /** Widget type the zone becomes. Every one of these has a case in `WidgetRenderer`. */
  type: string;
  /** Operator-facing name. Never a SCREAMING_SNAKE enum. */
  label: string;
  /** What it does once it is live, stated as what the code actually does. */
  blurb: string;
}

export const LIVE_WIDGETS: readonly LiveWidget[] = [
  { type: 'CLOCK', label: 'Clock', blurb: 'The real time and date. Never needs retyping.' },
  { type: 'LUNCH_MENU', label: 'Lunch menu', blurb: "Your menu, with today's line picked out by the clock." },
  { type: 'BELL_SCHEDULE', label: 'Bell schedule', blurb: 'Your periods, with the one running right now marked.' },
  { type: 'COUNTDOWN', label: 'Countdown', blurb: 'Counts down to a date you set, on its own.' },
  { type: 'WEATHER', label: 'Weather', blurb: 'Real conditions for this location, refreshed every 15 minutes.' },
  { type: 'CALENDAR', label: 'Calendar', blurb: 'Upcoming events, read from a calendar feed you paste in.' },
];

/** A live widget promoted to the front, with the reason it was promoted. */
export interface LiveSuggestion extends LiveWidget {
  /** Plain English, quoting the exact phrase that matched. Shown to the operator. */
  because: string;
}

interface Rule {
  type: string;
  /** One short regex per signal — each is meant to be checked by eye. Never global. */
  signals: readonly RegExp[];
  because(matched: string): string;
}

/**
 * Ordered. The first rules to match win the top slots, so the strongest,
 * least ambiguous signals come first.
 */
const RULES: readonly Rule[] = [
  {
    type: 'CLOCK',
    signals: [
      /\b(?:today|tomorrow)\b/i,
      /\b(?:mon|tues?|wednes|thur?s|fri|satur|sun)day\b/i,
      /\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/i,
      /\b(?:january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}\b/i,
      // "May" alone is far too common an English word to treat as a month.
      /\bmay\s+\d{1,2}\b/i,
      /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
    ],
    because: (m) => `“${m.trim()}” goes out of date. A clock never does.`,
  },
  {
    type: 'LUNCH_MENU',
    signals: [
      /\blunch\b/i,
      /\bmenu\b/i,
      /\bcafeteria\b/i,
      /\bbreakfast\b/i,
      /\bentr[eé]es?\b/i,
      /\bserving\b/i,
    ],
    because: (m) => `“${m.trim()}” reads like a menu. The live one picks out today for you.`,
  },
  {
    type: 'BELL_SCHEDULE',
    signals: [
      /\bbell\b/i,
      /\bperiod\s*\d\b/i,
      /\bhomeroom\b/i,
      /\bdismissal\b/i,
      /\b(?:1st|2nd|3rd|\d+th)\s+period\b/i,
    ],
    because: (m) => `“${m.trim()}” reads like a class schedule. The live one marks the period running now.`,
  },
  {
    type: 'COUNTDOWN',
    signals: [
      /\bcountdown\b/i,
      /\b\d+\s*days?\b/i,
      /\bdays\s+(?:until|left|to\s+go|remaining)\b/i,
    ],
    because: (m) => `“${m.trim()}” counts down. A countdown does the counting itself.`,
  },
  {
    type: 'WEATHER',
    signals: [
      /\bweather\b/i,
      /\bforecast\b/i,
      /\b(?:high|low)\s*:?\s*\d{1,3}\s*°/i,
      /\d\s*°\s*[fc]\b/i,
    ],
    because: (m) => `“${m.trim()}” is weather. The live one refreshes itself every 15 minutes.`,
  },
  {
    type: 'CALENDAR',
    signals: [
      /\bupcoming\b/i,
      /\bcalendar\b/i,
      /\bthis\s+week\b/i,
      /\bnext\s+week\b/i,
      /\bevents\b/i,
    ],
    because: (m) => `“${m.trim()}” reads like an events list. The live one reads your calendar feed.`,
  },
];

/** At most this many promoted to the front — it is an ordering hint, not a wall. */
export const MAX_SUGGESTIONS = 3;

/** Config keys that carry operator copy on the widgets an import produces. */
const COPY_KEYS = ['content', 'text', 'message', 'title', 'label', 'headline', 'body'] as const;

/** Enough text to read the zone's intent; a cap keeps the regex pass trivial. */
const MAX_TEXT = 400;

/**
 * The copy on a zone, as one lowercase-able string.
 *
 * `name` is included on purpose: the PDF and PPTX parsers both set a text
 * zone's name to `text.slice(0, 40)`, so on an imported board the NAME *is*
 * the copy — and it is the part still visible once the operator collapses the
 * content fields.
 */
export function zoneLiveText(zone: Pick<Zone, 'name' | 'defaultConfig'>): string {
  const parts: string[] = [];
  if (zone.name) parts.push(zone.name);
  const cfg = (zone.defaultConfig || {}) as Record<string, unknown>;
  for (const k of COPY_KEYS) {
    const v = cfg[k];
    if (typeof v === 'string' && v.trim()) parts.push(v);
  }
  return parts.join(' ').slice(0, MAX_TEXT);
}

/**
 * The copy this zone would LOSE, short enough to quote in a confirm dialog.
 *
 * Config copy only — never the zone name, which survives the swap. The confirm
 * has to name the specific thing that goes (the lead's rule for this program:
 * "Name the specific thing that changed"), and quoting a name the operator is
 * about to keep would be a lie in the other direction.
 */
export function zoneCopyPreview(zone: Pick<Zone, 'defaultConfig'>, maxLen = 60): string | null {
  const cfg = (zone.defaultConfig || {}) as Record<string, unknown>;
  for (const k of COPY_KEYS) {
    const v = cfg[k];
    if (typeof v === 'string' && v.trim()) {
      const flat = v.trim().replace(/\s+/g, ' ');
      return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
    }
  }
  return null;
}

/** The first signal in `signals` that matches, or null. Returns the matched text. */
function firstSignal(text: string, signals: readonly RegExp[]): string | null {
  for (const re of signals) {
    const m = text.match(re);
    if (m && m[0]) return m[0];
  }
  return null;
}

export interface LiveOptions {
  /** Promoted to the front, each carrying the phrase that promoted it. */
  suggested: LiveSuggestion[];
  /** Every other live widget, in catalogue order. Always reachable. */
  others: LiveWidget[];
}

/**
 * The live widgets on offer for a zone, ordered.
 *
 * The zone's CURRENT type never appears — "make it live" cannot mean "become
 * what you already are". Everything else is always present in one list or the
 * other, so a heuristic that fires wrongly costs an ordering and nothing else.
 */
export function suggestLiveWidgets(zone: Pick<Zone, 'name' | 'widgetType' | 'defaultConfig'>): LiveOptions {
  const text = zoneLiveText(zone);
  const byType = new Map(LIVE_WIDGETS.map((w) => [w.type, w]));
  const suggested: LiveSuggestion[] = [];

  for (const rule of RULES) {
    if (suggested.length >= MAX_SUGGESTIONS) break;
    if (rule.type === zone.widgetType) continue;
    const base = byType.get(rule.type);
    if (!base) continue;
    const matched = firstSignal(text, rule.signals);
    if (!matched) continue;
    suggested.push({ ...base, because: rule.because(matched) });
  }

  const taken = new Set(suggested.map((s) => s.type));
  const others = LIVE_WIDGETS.filter((w) => w.type !== zone.widgetType && !taken.has(w.type));
  return { suggested, others };
}

// ───────────────────────────────────────────────────────────────────────────
// Telling an imported template apart from a hand-built one
// ───────────────────────────────────────────────────────────────────────────

/**
 * The importer's own stamp. `imports.controller.ts` writes
 * `Imported from <source> on <YYYY-MM-DD>` into `Template.description` on BOTH
 * of its create paths (structured per-page and the legacy single-canvas
 * fallback), so the marker already exists and needs no schema change.
 *
 * It is a heuristic on a field the operator can edit, and it fails SAFE in both
 * directions: rewrite the description and the hint stops appearing (the control
 * itself is unaffected); type this prefix by hand into a description and you
 * get one dismissible line of advice. Neither outcome can lose work.
 *
 * If Package A changes the import copy, this constant is the one line to update.
 */
export const IMPORTED_DESCRIPTION_PREFIX = 'Imported from ';

export function isImportedTemplate(description?: string | null): boolean {
  return typeof description === 'string' && description.trimStart().startsWith(IMPORTED_DESCRIPTION_PREFIX);
}

/** The widget types an import produces that carry copy an operator retypes. */
const IMPORTED_TEXT_TYPES = new Set(['TEXT', 'RICH_TEXT']);

/**
 * Whether to show the one-line hint on this zone.
 *
 * Three gates, all required, so it cannot nag:
 *   1. the template actually came from an import;
 *   2. the zone is a text zone an import produced;
 *   3. the heuristic actually matched something, so the hint can name what it
 *      saw. With nothing to point at there is no hint — only the control.
 */
export function shouldOfferLiveHint(
  zone: Pick<Zone, 'name' | 'widgetType' | 'defaultConfig'>,
  templateDescription?: string | null,
): boolean {
  if (!isImportedTemplate(templateDescription)) return false;
  if (!IMPORTED_TEXT_TYPES.has(zone.widgetType)) return false;
  return suggestLiveWidgets(zone).suggested.length > 0;
}

/**
 * localStorage key for "I have seen this tip on this board".
 *
 * Per TEMPLATE, not per zone: an imported deck's zones all came from the same
 * page, so dismissing on one and being told again on the next is nagging. A
 * per-viewer convenience exactly as CLAUDE.md scopes localStorage — losing it
 * costs one line of advice reappearing, never any work.
 */
export function liveHintDismissKey(templateId: string): string {
  return `educms:make-it-live-hint:${templateId}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Reaching the full library from here
// ───────────────────────────────────────────────────────────────────────────

/**
 * Asks the builder shell to open the WIDGETS panel with REPLACE already armed
 * for this zone, so "Browse all widgets" from Properties lands the operator
 * somewhere a click actually swaps the zone rather than adding a second one.
 *
 * A CustomEvent because the panel key is BuilderShell's own local UI state, not
 * template data — the same shape the builder already uses for
 * `template-edit-field` (BuilderZone and PropertiesPanel dispatch it,
 * BuilderShell listens). Putting chrome state in the zone store would drag it
 * into undo history, where it does not belong.
 */
export const OPEN_WIDGET_LIBRARY_EVENT = 'educms:open-widget-library';

export interface OpenWidgetLibraryDetail {
  /** Arm REPLACE for this zone once the widgets panel is up. */
  zoneId: string;
}

export function openWidgetLibrary(zoneId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenWidgetLibraryDetail>(OPEN_WIDGET_LIBRARY_EVENT, { detail: { zoneId } }),
  );
}
