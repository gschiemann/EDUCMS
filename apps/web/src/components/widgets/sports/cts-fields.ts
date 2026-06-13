'use client';

/**
 * cts-fields.ts — the CANONICAL CTS feed-field catalog.
 * ═══════════════════════════════════════════════════════════════════
 * Operator mandate (2026-05-30): *"i want the drop down to be picking
 * what CTS is giving us in the API so there is no question we are
 * mapping the correct thing."*
 *
 * This is the SINGLE SOURCE OF TRUTH for which real fields a CTS
 * (Colorado Time Systems Gen-6) console feed exposes to a scoreboard
 * element. Every entry's `key` is the EXACT field the cloud API ships
 * — either a top-level `GameSnapshot` key (homeScore / awayScore /
 * segment / clock / status / teams) or a `stats.<key>` the CTS overlay
 * actually writes. No abstraction, no free-text, no `cfg.team` side
 * selector floating above a mystery field: the dropdown label IS the
 * field coming off the console.
 *
 * ── How the catalog was verified against the REAL API (do not skip
 *    this when editing — only list fields the bridge truly emits) ──
 *
 * The CTS data path is, end-to-end:
 *
 *   1. CtsParser (`@cms/scoreboard-cts` → `types.ts`) decodes the
 *      RS-232 console into a `CtsFullSnapshot`: clock, period,
 *      homeScore, awayScore, homeShotClock, awayShotClock,
 *      homeExclusions[], awayExclusions[], homeTimeoutsRemaining,
 *      awayTimeoutsRemaining, horn.
 *
 *   2. The kiosk bridge POSTs that to
 *      `POST /api/v1/sports/games/:id/cts-snapshot`. The API's
 *      `SportsService.cleanCtsSnapshot()` (apps/api/src/sports/
 *      sports.service.ts) ACCEPTS exactly these keys:
 *        clockMs, clockRunning, segment, homeScore, awayScore,
 *        shotClock{ms,running,len,at}, homeShotClock{ms,running,raw,at},
 *        awayShotClock{ms,running,raw,at},
 *        homeExclusions[{playerJersey,secondsRemaining}|null]×3,
 *        awayExclusions[…]×3, homeTimeoutsRemaining, awayTimeoutsRemaining,
 *        horn, raw.
 *      It writes ALL of them under `Game.stats.cts` (never the operator
 *      columns).
 *
 *   3. `applyCtsOverlay()` (apps/web/src/lib/cts-merge.ts) is the
 *      render-time bridge every public surface runs. When the CTS
 *      heartbeat is fresh it overlays:
 *        • TOP-LEVEL GameSnapshot:  homeScore, awayScore, segment,
 *          clockMs (→ liveClockMs), clockRunning
 *        • stats.*:  shotClock, homeShotClock, awayShotClock,
 *          homeExclusions, awayExclusions, homeTimeoutsRemaining,
 *          awayTimeoutsRemaining
 *
 * Those — plus the always-present identity fields (homeTeam, awayTeam,
 * homeLogoUrl, awayLogoUrl, status) the board endpoint ships
 * unconditionally — are the COMPLETE set of fields a CTS feed drives.
 *
 * NOT in this catalog, on purpose (the bridge does NOT emit them as
 * renderable values, so listing them would be fabrication):
 *   • `horn` — consumed only as a one-shot celebration trigger, never
 *     stored as a field a value-widget renders.
 *   • down / distance / ballOn / balls / strikes / outs / fouls /
 *     possession / sets / serve / etc. — these are OPERATOR-INPUT-only
 *     `def.stats` keys (packages/api-types/src/sports.ts). The water
 *     polo CTS profile we ship today does not transmit them. They stay
 *     editable as manual chips in the Run console; a future
 *     football/basketball CTS profile would extend `cleanCtsSnapshot`
 *     AND this catalog together.
 *
 * Chromium-83 / NovaStar-Taurus safe — pure data + helpers, no DOM,
 * no CSS, no `inset`/`gap`/`backdrop-filter`.
 */

import { fmtClock, fmtSegment, type GameSnapshot } from './GameStateContext';

/** Optgroup buckets, in display order. */
export type CtsFieldGroup =
  | 'Score'
  | 'Clock'
  | 'Period'
  | 'Teams'
  | 'Shot Clock'
  | 'Timeouts'
  | 'Penalties'
  | 'Status';

export const CTS_FIELD_GROUP_ORDER: CtsFieldGroup[] = [
  'Score',
  'Clock',
  'Period',
  'Teams',
  'Shot Clock',
  'Timeouts',
  'Penalties',
  'Status',
];

export interface CtsFieldDef {
  /** The REAL field key. A top-level GameSnapshot key OR a `stats.<key>`
   *  the CTS overlay writes. This is what `cfg.ctsField` stores and what
   *  `resolveCtsField` reads. */
  key: string;
  /** Operator-facing label shown in the dropdown. */
  label: string;
  /** Optgroup bucket. */
  group: CtsFieldGroup;
  /** Where the value lives on the merged snapshot — informs resolution.
   *  'top' = GameSnapshot top-level; 'stat' = snapshot.stats[key]. */
  source: 'top' | 'stat';
}

/**
 * THE catalog. Every key here is emitted by the CTS path verified above.
 * Order within a group = display order in the dropdown.
 */
export const CTS_FIELDS: CtsFieldDef[] = [
  // ── Score (top-level, CTS HOME_SCORE / AWAY_SCORE modules) ──
  { key: 'homeScore', label: 'Home Score', group: 'Score', source: 'top' },
  { key: 'awayScore', label: 'Away Score', group: 'Score', source: 'top' },

  // ── Clock (top-level, CTS GAME_CLOCK module → clockMs/clockRunning) ──
  { key: 'clock', label: 'Game Clock', group: 'Clock', source: 'top' },

  // ── Period (top-level, CTS PERIOD module → segment) ──
  { key: 'segment', label: 'Period / Quarter', group: 'Period', source: 'top' },

  // ── Teams (board-endpoint identity fields — always present) ──
  { key: 'homeTeam', label: 'Home Team Name', group: 'Teams', source: 'top' },
  { key: 'awayTeam', label: 'Away Team Name', group: 'Teams', source: 'top' },
  { key: 'homeLogoUrl', label: 'Home Team Logo', group: 'Teams', source: 'top' },
  { key: 'awayLogoUrl', label: 'Away Team Logo', group: 'Teams', source: 'top' },

  // ── Shot Clock (CTS HOME_SHOT_CLOCK / AWAY_SHOT_CLOCK → stats.*) ──
  { key: 'homeShotClock', label: 'Home Shot Clock', group: 'Shot Clock', source: 'stat' },
  { key: 'awayShotClock', label: 'Away Shot Clock', group: 'Shot Clock', source: 'stat' },
  // The single-side shot clock the bridge also writes (back-compat /
  // basketball one-clock installs).
  { key: 'shotClock', label: 'Shot Clock', group: 'Shot Clock', source: 'stat' },

  // ── Timeouts (CTS HOME_TIMEOUTS / AWAY_TIMEOUTS → stats.*) ──
  { key: 'homeTimeoutsRemaining', label: 'Home Timeouts Remaining', group: 'Timeouts', source: 'stat' },
  { key: 'awayTimeoutsRemaining', label: 'Away Timeouts Remaining', group: 'Timeouts', source: 'stat' },

  // ── Penalties (CTS HOME_EXCL_* / AWAY_EXCL_* → stats.*) ──
  { key: 'homeExclusions', label: 'Home Exclusions (penalty box)', group: 'Penalties', source: 'stat' },
  { key: 'awayExclusions', label: 'Away Exclusions (penalty box)', group: 'Penalties', source: 'stat' },

  // ── Status (board-endpoint field — always present) ──
  { key: 'status', label: 'Game Status (LIVE / FINAL / HALFTIME)', group: 'Status', source: 'top' },
];

/** Fast lookup: key → CtsFieldDef. */
export const CTS_FIELD_BY_KEY: Record<string, CtsFieldDef> = CTS_FIELDS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<string, CtsFieldDef>,
);

/** The catalog grouped into optgroups (display order preserved). */
export function ctsFieldsByGroup(): Array<{ group: CtsFieldGroup; fields: CtsFieldDef[] }> {
  return CTS_FIELD_GROUP_ORDER.map((group) => ({
    group,
    fields: CTS_FIELDS.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);
}

/** Human label for a key (falls back to the raw key for unknowns). */
export function ctsFieldLabel(key: string | undefined | null): string {
  if (!key) return '';
  return CTS_FIELD_BY_KEY[key]?.label ?? key;
}

// ────────────────────────────────────────────────────────────────────
// Per-element DEFAULT mapping.
//
// Each scoreboard element variant (sb-*) and each standalone sport
// widget type (SCORE_HOME / GAME_CLOCK / …) defaults to its CORRECT CTS
// field, so the operator drops a "Home Score" tile and it is already
// pointed at `homeScore` with zero clicks. They can re-point via the
// dropdown; that just changes `cfg.ctsField`.
//
// Keys here are EITHER a variant id (sb-score-home, sb-team-name-home,
// …) OR a canonical widgetType (SCORE_HOME, GAME_CLOCK, …). Lookups try
// both. A null entry means "this element is not a single-CTS-field
// reader" (sponsor slots, possession arrows that need both sides, etc.)
// — those keep their own bespoke logic and don't show the field picker.
// ────────────────────────────────────────────────────────────────────
const CTS_DEFAULT_FIELD: Record<string, string | null> = {
  // Standalone sport widgets (SportWidgets.tsx).
  SCORE_HOME: 'homeScore',
  SCORE_AWAY: 'awayScore',
  GAME_CLOCK: 'clock',
  GAME_SEGMENT: 'segment',
  // GAME_STAT has no single canonical default — the operator picks.
  GAME_STAT: null,

  // Element widgets (SportElementWidgets.tsx) — scoreboard sb-* variants.
  // NOTE: score/clock/period are NOT sb-* elements — they're the
  // standalone SCORE_HOME / GAME_CLOCK / GAME_SEGMENT widget types above.
  // The sb-* set below is exactly what's registered in variants-register.ts.
  'sb-team-name-home': 'homeTeam',
  'sb-team-name-away': 'awayTeam',
  'sb-team-abbr-home': 'homeTeam',
  'sb-team-abbr-away': 'awayTeam',
  'sb-team-logo-home': 'homeLogoUrl',
  'sb-team-logo-away': 'awayLogoUrl',
  'sb-status': 'status',
  'sb-timeouts-home': 'homeTimeoutsRemaining',
  'sb-timeouts-away': 'awayTimeoutsRemaining',
  'sb-shot-clock': 'shotClock',
  'sb-penalty-home': 'homeExclusions',
  'sb-penalty-away': 'awayExclusions',

  // Elements that read a value but have NO direct CTS field today
  // (operator-input only / multi-side) → null = no field picker, keep
  // bespoke logic.
  'sb-team-record-home': null,
  'sb-team-record-away': null,
  'sb-possession-arrow': null,
  'sb-possession-ball-home': null,
  'sb-possession-ball-away': null,
  'sb-play-clock': null,
  'sb-added-time': null,
  'sb-bonus-home': null,
  'sb-bonus-away': null,
  'sb-fouls-home': null,
  'sb-fouls-away': null,
  'sb-sponsor': null,
};

/**
 * The default CTS field for an element, by variant id OR widgetType.
 * Returns `undefined` when the element is unknown to the map (treat as
 * "no default, no picker"); returns `null` when the element is known
 * but deliberately has no single CTS field (no picker, keep bespoke
 * logic); returns a key string otherwise.
 */
export function defaultCtsField(
  variantOrType: string | undefined | null,
): string | null | undefined {
  if (!variantOrType) return undefined;
  if (variantOrType in CTS_DEFAULT_FIELD) return CTS_DEFAULT_FIELD[variantOrType];
  return undefined;
}

/**
 * Whether an element should show the "Reads from CTS field" picker.
 * True when it has a concrete default field in the map (i.e. it is a
 * single-CTS-field reader). Sponsor slots / possession / etc. (null)
 * and unknown elements (undefined) do not.
 */
export function ctsFieldEligible(variantOrType: string | undefined | null): boolean {
  return typeof defaultCtsField(variantOrType) === 'string';
}

/**
 * Back-compat: derive a CTS field from a legacy element config that
 * predates `cfg.ctsField`. Old scoreboards stored a `cfg.team`
 * (home/away) side selector and/or a free-text `cfg.statKey`. Map them
 * to the right real field so existing templates keep working without a
 * re-save.
 *
 * Priority:
 *   1. an explicit `cfg.ctsField` always wins (handled by callers);
 *   2. a legacy `cfg.statKey` that names a REAL catalog field is used
 *      verbatim;
 *   3. otherwise the element's default field is specialized by the
 *      legacy `cfg.team` side (home/away) when applicable.
 */
export function deriveCtsField(
  variantOrType: string | undefined | null,
  cfg: { ctsField?: unknown; team?: unknown; statKey?: unknown } | undefined,
): string | undefined {
  // 1. explicit new field wins.
  if (cfg && typeof cfg.ctsField === 'string' && cfg.ctsField) {
    return cfg.ctsField;
  }
  // 2. a legacy statKey that is a real catalog field → use it.
  if (cfg && typeof cfg.statKey === 'string' && cfg.statKey && CTS_FIELD_BY_KEY[cfg.statKey]) {
    return cfg.statKey;
  }
  // 3. default for this element, possibly side-specialized.
  const def = defaultCtsField(variantOrType);
  if (typeof def !== 'string') return undefined;
  const side = cfg && typeof cfg.team === 'string' ? cfg.team.toLowerCase() : '';
  if (side === 'home' || side === 'away') {
    const sided = sidedField(def, side);
    if (sided) return sided;
  }
  return def;
}

/** Swap a home/away-paired field to the requested side, when one exists. */
function sidedField(key: string, side: 'home' | 'away'): string | null {
  const PAIRS: Record<string, [string, string]> = {
    homeScore: ['homeScore', 'awayScore'],
    awayScore: ['homeScore', 'awayScore'],
    homeTeam: ['homeTeam', 'awayTeam'],
    awayTeam: ['homeTeam', 'awayTeam'],
    homeLogoUrl: ['homeLogoUrl', 'awayLogoUrl'],
    awayLogoUrl: ['homeLogoUrl', 'awayLogoUrl'],
    homeShotClock: ['homeShotClock', 'awayShotClock'],
    awayShotClock: ['homeShotClock', 'awayShotClock'],
    homeTimeoutsRemaining: ['homeTimeoutsRemaining', 'awayTimeoutsRemaining'],
    awayTimeoutsRemaining: ['homeTimeoutsRemaining', 'awayTimeoutsRemaining'],
    homeExclusions: ['homeExclusions', 'awayExclusions'],
    awayExclusions: ['homeExclusions', 'awayExclusions'],
  };
  const pair = PAIRS[key];
  if (!pair) return null;
  return side === 'home' ? pair[0] : pair[1];
}

// ────────────────────────────────────────────────────────────────────
// resolveCtsField — turn a (snapshot, liveClockMs, key) triple into the
// display value the widget renders. ONE place to read every CTS field,
// so a re-pointed dropdown genuinely changes what the widget shows.
// ────────────────────────────────────────────────────────────────────

interface ShotClockEntry {
  ms?: number;
  running?: boolean;
  len?: number;
  at?: string;
}
interface ExclusionEntry {
  playerJersey?: number;
  secondsRemaining?: number;
}

/** Format a shot-clock entry to a short string ("24", "4.5", ""). */
function fmtShotClock(sc: ShotClockEntry | null | undefined): string {
  if (!sc || typeof sc !== 'object') return '';
  const ms = Math.max(0, Number(sc.ms) || 0);
  // Parked / expired reads blank, matching the physical board.
  const len = Number(sc.len) || 0;
  if (len <= 0 && ms <= 0) return '';
  if (ms <= 0) return '0';
  return ms <= 5000 ? (ms / 1000).toFixed(1) : String(Math.ceil(ms / 1000));
}

/** Format an exclusion array ("#7 12s", or "—" when the box is empty). */
function fmtExclusions(arr: (ExclusionEntry | null)[] | null | undefined): string {
  if (!Array.isArray(arr)) return '';
  const active = arr.filter(
    (e): e is ExclusionEntry => !!e && typeof e === 'object' && (Number(e.secondsRemaining) || 0) > 0,
  );
  if (active.length === 0) return '—';
  return active
    .map((e) => {
      const jersey = Number(e.playerJersey) || 0;
      const secs = Math.max(0, Number(e.secondsRemaining) || 0);
      return `${jersey ? `#${jersey} ` : ''}${secs}s`;
    })
    .join('  ');
}

/**
 * Resolve a CTS field to its display value.
 *
 * @param snapshot     the CTS-merged GameSnapshot (already through
 *                     applyCtsOverlay), or null in builder/thumbnail mode
 * @param liveClockMs  the projected game clock (the provider ticks it)
 * @param key          the real CTS field key (cfg.ctsField ?? default)
 * @returns            the string the widget renders, or null when there
 *                     is no live snapshot OR the field is empty — the
 *                     caller then falls back to cfg.placeholder.
 *
 * Pure — no side effects, never throws.
 */
export function resolveCtsField(
  snapshot: GameSnapshot | null | undefined,
  liveClockMs: number,
  key: string | undefined | null,
  opts?: { showTenths?: boolean },
): string | null {
  if (!snapshot || !key) return null;
  const def = CTS_FIELD_BY_KEY[key];
  const stats = (snapshot.stats ?? {}) as Record<string, unknown>;

  switch (key) {
    // Clock — always projected from liveClockMs (the provider ticks it
    // forward from the CTS anchor), never the stale snapshot.clockMs.
    case 'clock':
      return fmtClock(liveClockMs, !!opts?.showTenths);
    // Period — sport-aware label ("Q3", "Inning 5", "Set 2").
    case 'segment':
      return fmtSegment(snapshot.sport, snapshot.segment);
    // Shot clocks — short countdown string.
    case 'homeShotClock':
      return fmtShotClock(stats.homeShotClock as ShotClockEntry);
    case 'awayShotClock':
      return fmtShotClock(stats.awayShotClock as ShotClockEntry);
    case 'shotClock':
      return fmtShotClock(stats.shotClock as ShotClockEntry);
    // Exclusions — penalty-box summary string.
    case 'homeExclusions':
      return fmtExclusions(stats.homeExclusions as (ExclusionEntry | null)[]);
    case 'awayExclusions':
      return fmtExclusions(stats.awayExclusions as (ExclusionEntry | null)[]);
    default:
      break;
  }

  // Generic resolution for the remaining catalog fields.
  if (def?.source === 'top') {
    const v = (snapshot as unknown as Record<string, unknown>)[key];
    return v == null || v === '' ? null : String(v);
  }
  // stat-sourced numeric (timeouts) or any future stats.<key>.
  const v = stats[key];
  return v == null || v === '' ? null : String(v);
}

// ────────────────────────────────────────────────────────────────────
// Builder-vs-live render mode — the fix for "fake SAMPLE scores show on
// a LIVE board" (audit P1, 2026-06-13).
//
// THE TRAP these helpers close: a sport widget's only signal used to be
// "is there a live snapshot?" (`useGameState()?.snapshot` non-null, or a
// CTS `edu:cts-game-state` event having arrived). When that was false the
// widget fell back to a *fabricated sample* ("HOME 24", "7:42", "Q3") —
// which is CORRECT in the template builder / gallery thumbnail (the
// operator is laying out a board), but WRONG on a live player surface
// that simply has no data yet (provider mounted but snapshot null, or a
// board bound to no/!live game). A water-polo crowd would see a fake
// score on the big screen, indistinguishable from a real one save an
// 8px grey dot.
//
// The reliable distinction already exists in the codebase:
//   • GameStateContext widgets: `useGameState()` returns NON-null ONLY
//     inside a <GameStateProvider> — i.e. the live /board route. The
//     template builder + gallery thumbnail render OUTSIDE the provider,
//     so it returns null. Provider-present ⇒ LIVE surface.
//   • CTS CustomEvent widgets (CtsScoreboard / CtsRibbonWidgets): the
//     WidgetRenderer threads a `live` prop (false in the builder /
//     thumbnail, true when the player is actually running).
//
// So: BUILDER (no provider / live===false) → keep the sample so the tile
// is alive and the operator can position it. LIVE (provider present /
// live===true) with no data → render a NEUTRAL state ("—" / "—:—"),
// NEVER a fabricated number.
// ────────────────────────────────────────────────────────────────────

/** A neutral, obviously-not-a-real-value glyph for a live surface that
 *  has no data yet. `kind` lets a clock read "—:—" while a score reads
 *  "—". Pure string — Chromium-83 / Taurus safe (no DOM, no CSS). */
export function liveNeutral(kind: 'clock' | 'value' = 'value'): string {
  return kind === 'clock' ? '—:—' : '—';
}

/**
 * Choose what a single-value sport widget displays when its live value
 * is absent (`resolved == null`).
 *
 * @param isLiveSurface  true when the widget is rendering on a LIVE
 *                       player surface (provider present, or `live`
 *                       prop true). false in the builder / thumbnail.
 * @param resolved       the resolved live value, or null when absent.
 * @param placeholder    the operator's sample text (builder only).
 * @param neutralKind    glyph shape for the live-no-data case.
 *
 * Returns the live value if present; otherwise the sample in the
 * builder, or the neutral glyph on a live surface — so a live board with
 * no feed shows "—", never a fabricated score.
 */
export function displayOrNeutral(
  isLiveSurface: boolean,
  resolved: string | null | undefined,
  placeholder: string | null | undefined,
  neutralKind: 'clock' | 'value' = 'value',
): string {
  if (resolved != null && resolved !== '') return resolved;
  if (isLiveSurface) return liveNeutral(neutralKind);
  // Builder / thumbnail — sample text so the operator can lay out the
  // board. Fall back to the neutral glyph if no placeholder is set.
  return placeholder != null && placeholder !== '' ? placeholder : liveNeutral(neutralKind);
}
