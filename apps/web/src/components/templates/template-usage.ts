/**
 * Templates Gallery — Calm v1 · usage truth (§4.3, §6.3, §18).
 *
 * Pure derivation, deliberately separated from the card so the truth rules
 * are unit-testable without mounting a widget tree.
 *
 * THE THREE RULES THIS FILE EXISTS TO ENFORCE
 *
 *  1. UNKNOWN IS NOT ZERO. When the server can't tell us (endpoint not
 *     deployed, request failed) the card shows NOTHING — never "Not in
 *     use", never "0 playlists". Telling an operator that a board running
 *     on three lobby screens is idle is worse than telling them nothing.
 *
 *  2. NEVER CLAIM `LIVE` WITHOUT PROOF (§6.3: "Do not use LIVE unless the
 *     backend can prove current reach through playlists, schedules and
 *     screens"). Both `activeNow` AND `screensReached > 0` must be true.
 *     A server that says activeNow with zero reach is not proof.
 *
 *  3. NEVER STATE BY COLOR ALONE (§14). Every state carries text; the
 *     pill's tone is decoration on top of a readable label.
 *
 * `SCHEDULED` from §6.3 is intentionally NOT derived here: the contract
 * carries no schedule-window field, so a template that sits in playlists
 * without proven live reach simply reports its playlist reach and gets no
 * status pill. Inventing a scheduled claim would break rule 2.
 */

import type { TemplateUsageEntry } from '@/hooks/use-api';

export type TemplateUsageState =
  /** Server didn't tell us. Render no pill and no reach line. */
  | { kind: 'unknown' }
  /** Proven current reach: activeNow AND screensReached > 0. */
  | { kind: 'live'; screens: number; playlists: number }
  /** Referenced by playlists, but current on-screen reach isn't proven. */
  | { kind: 'in-playlists'; playlists: number }
  /** Server proved nothing references this template. */
  | { kind: 'idle' };

/** Narrow an unvalidated map entry to a usable entry, or undefined. */
function readEntry(entry: unknown): TemplateUsageEntry | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as Record<string, unknown>;
  const playlists = typeof e.playlists === 'number' && Number.isFinite(e.playlists) ? e.playlists : undefined;
  const screensReached =
    typeof e.screensReached === 'number' && Number.isFinite(e.screensReached) ? e.screensReached : undefined;
  // A row missing its numbers is unknown, not zero.
  if (playlists === undefined || screensReached === undefined) return undefined;
  return { playlists, screensReached, activeNow: e.activeNow === true };
}

/**
 * @param byTemplate the whole summary map, or `undefined` when the summary
 *   is unavailable (see useTemplateUsageSummary — it resolves to undefined,
 *   never `{}`, precisely so this stays distinguishable).
 * @param templateId the tenant-owned template's id.
 */
export function deriveTemplateUsage(
  byTemplate: Record<string, TemplateUsageEntry> | undefined,
  templateId: string,
): TemplateUsageState {
  if (!byTemplate) return { kind: 'unknown' };
  const entry = readEntry(byTemplate[templateId]);
  // A template absent from a KNOWN summary is a real "nothing references
  // it" answer — the server enumerated the tenant's templates and this one
  // carried no rows. (A row that is present but malformed is unknown.)
  if (!entry) {
    return Object.prototype.hasOwnProperty.call(byTemplate, templateId) ? { kind: 'unknown' } : { kind: 'idle' };
  }
  if (entry.activeNow && entry.screensReached > 0) {
    return { kind: 'live', screens: entry.screensReached, playlists: entry.playlists };
  }
  if (entry.playlists > 0) return { kind: 'in-playlists', playlists: entry.playlists };
  return { kind: 'idle' };
}

/** `Active · 3 screens` / `Not in use` — the status pill's text, or null.
 *  Not "LIVE" (2026-09-01, Codex truth audit) — matches the word the
 *  Playlists page already uses for this exact same underlying claim
 *  (a schedule provably eligible right now, per evaluateScheduleEligibility
 *  server-side), so the app doesn't use three different words for one
 *  fact across Templates/Assets/Playlists. */
export function usagePillLabel(state: TemplateUsageState): string | null {
  switch (state.kind) {
    case 'live':
      return `Active · ${state.screens} screen${state.screens === 1 ? '' : 's'}`;
    case 'idle':
      return 'Not in use';
    // 'in-playlists' is carried by the reach line below, not a second pill.
    default:
      return null;
  }
}

/** `Used by 2 playlists` — the reach line, or null when there is none. */
export function usageReachLabel(state: TemplateUsageState): string | null {
  const n = state.kind === 'live' ? state.playlists : state.kind === 'in-playlists' ? state.playlists : 0;
  if (n <= 0) return null;
  return `Used by ${n} playlist${n === 1 ? '' : 's'}`;
}

/**
 * §10.5 — "Add `Needs attention` if the saved template itself is broken,
 * not merely the thumbnail service."
 *
 * The one break we can PROVE from the list payload: a saved layout with no
 * zones renders as an empty background, so a screen running it shows
 * nothing. Everything else (a slow thumbnail, a missing image host) is a
 * preview problem, not a broken template, and must NOT raise this flag.
 */
export function templateNeedsAttention(t: { isSystem?: boolean; zones?: unknown[] }): boolean {
  if (t.isSystem) return false; // presets are immutable + shipped verified
  return Array.isArray(t.zones) && t.zones.length === 0;
}

/**
 * §4.4 — the single compact canvas badge that replaced the card's
 * top-left segmented control.
 *
 * "LED canvas" is claimed only for genuinely extreme geometry (a banner or
 * a totem), which is what the LED poster chains and ribbon boards actually
 * are — an ordinary 16:9 or 9:16 board stays Landscape / Portrait.
 */
export function canvasBadgeLabel(t: {
  category?: string;
  screenWidth?: number;
  screenHeight?: number;
}): 'Touch kiosk' | 'LED canvas' | 'Landscape' | 'Portrait' {
  if ((t.category || '').toUpperCase() === 'KIOSK') return 'Touch kiosk';
  const w = t.screenWidth || 0;
  const h = t.screenHeight || 0;
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (ratio >= 3 || ratio <= 1 / 3) return 'LED canvas';
    return ratio >= 1 ? 'Landscape' : 'Portrait';
  }
  return 'Landscape';
}

/** "Edited 18 min ago" — §6.1 item 6. Returns null for an unusable date. */
export function lastEditedLabel(updatedAt: string | undefined, now: number = Date.now()): string | null {
  if (!updatedAt) return null;
  const then = Date.parse(updatedAt);
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 0) return 'Edited just now';
  if (mins < 1) return 'Edited just now';
  if (mins < 60) return `Edited ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `Edited ${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Edited ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `Edited ${years} year${years === 1 ? '' : 's'} ago`;
}
