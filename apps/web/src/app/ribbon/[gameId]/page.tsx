'use client';

/**
 * VenueOS Sports — Sprint 13. The stadium ribbon / fascia board.
 *
 * A ribbon board is a long, short LED strip wrapping a stadium
 * (≈1000mm tall × 40+ feet wide). This page renders a PUBLIC ribbon
 * surface off the same /sports/board/:id endpoint the scoreboard uses.
 *
 * Presentation model (researched against real arena ribbon practice —
 * Daktronics / ScoreVision / ANC / Nevco / Watchfire):
 *
 *   A ribbon is NOT one nonstop scroll of everything. That looks
 *   amateur — the score drifts off-edge so fans can never glance it,
 *   and constant motion reads as noise. Real ribbons are TWO layers:
 *
 *     • a SCORE ZONE — score, clock, segment. It never moves; the
 *       digits just update in place.
 *     • a CONTENT ZONE that runs a rotating playlist of held-static
 *       "looks" (sponsor, crowd prompt, player, stat) — each holds
 *       6–8s, then a fast crossfade to the next. Looks tile across
 *       the ribbon's extreme width so every seat sees them.
 *
 *   On a continuous full-bowl wrap — a coliseum ribbon ringing the
 *   whole seating bowl — the [score | content] unit RECURS around the
 *   strip so the scorebug is glanceable from every seat, not just from
 *   one end. The anchor count auto-derives from the ribbon's aspect
 *   ratio; an installer can pin it with ?score=N on the kiosk URL. A
 *   normal straight ribbon resolves to one anchor and renders exactly
 *   as before.
 *
 *   A fired celebration cue takes the whole ribbon over for its hold,
 *   tiled once per score anchor so the burst reaches every seat too.
 *
 * Chromium-83 safe (NovaStar Taurus): long-hand top/right/bottom/left
 * (no `inset`), per-child margin (no flex `gap`), animation is
 * transform/opacity only, plain CSS opacity transitions.
 */

import {
  Component as ReactComponent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  type SyntheticEvent,
  type CSSProperties,
} from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
// Trust wave Domain B (2026-08-06) — shared hardened poll engine
// (self-chaining, ETag/304 revalidation, jittered backoff) + the
// "CONNECTION LOST" staleness chip shown when the feed goes quiet.
import { startBoardPoll, STALE_FEED_AFTER_MS } from '@/lib/board-poll';
import { ConnectionLostPill } from '@/components/sports/ConnectionLostPill';
import { applyCtsOverlay } from '@/lib/cts-merge';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
// Sprint 13 — when Game.ribbonTemplateId is set, hand off the entire
// ribbon render to the same custom-template renderer the /board route
// uses; the template's canvas size differentiates ribbon from
// scoreboard (operator picks 11520×192 or similar for the ribbon).
import { CustomScoreboardScene } from '../../board/[gameId]/CustomScoreboardScene';
// 2026-06-15 sports-pro polish — shared crowd-surface motion + vector marks.
// SCORE-POP: the pinned scores pop on change (the instant the bowl looks up).
// Vector marks replace emoji-as-iconography (consumer-grade tell at distance).
import {
  SCORE_MOTION_KEYFRAMES,
  SCORE_POP_ANIM,
  useScoreFlip,
} from '@/components/sports/score-motion';
import { SportMark, PossessionGlyph, ServeGlyph } from '@/components/sports/SportGlyph';
import {
  findSport,
  defaultRibbonPresets,
  ribbonSpeedMultiplier,
  ribbonScoreRepeatCount,
  formatScore,
} from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import {
  readResults,
  readPlayerFouls,
  readPlayerExclusions,
} from '@/components/widgets/v2/_shared/sports-situational';
// 2026-05-26 — replace the procedural CueBurst on the legacy ribbon
// path with the cinematic CEL_* library. Operator (2026-05-26):
// "should my cues trigger? the goal was to just replace all the
// dumb old cues with our redesigned ones". Same buttons, new scene.
import {
  CelSoccerGoalWidget, CelSoccerHatTrickWidget, CelSoccerGolazoWidget,
  CelSoccerRedCardWidget, CelSoccerFreeKickWidget,
} from '@/components/widgets/v2/CelebrationsSoccerWidgets';
import {
  CelHockeyGoalWidget, CelHockeyHatTrickWidget, CelHockeyPowerPlayWidget,
  CelHockeyShortyWidget, CelHockeyBigSaveWidget, CelHockeyEmptyNetWidget,
} from '@/components/widgets/v2/CelebrationsHockeyWidgets';
import {
  CelFootballTouchdownWidget, CelFootballFieldGoalWidget, CelFootballPickSixWidget,
  CelFootballSackWidget, CelFootballInterceptionWidget, CelFootballSafetyWidget,
} from '@/components/widgets/v2/CelebrationsFootballWidgets';
import {
  CelBasketballThreeWidget, CelBasketballDunkWidget, CelBasketballBuzzerWidget,
  CelBasketballBlockWidget, CelBasketballStealWidget,
} from '@/components/widgets/v2/CelebrationsBasketballWidgets';
import {
  CelBaseballHomeRunWidget, CelBaseballStrikeoutWidget, CelBaseballGrandSlamWidget,
  CelBaseballWalkOffWidget, CelBaseballStolenBaseWidget,
} from '@/components/widgets/v2/CelebrationsBaseballWidgets';
import { LxGoalWidget, TnAceWidget } from '@/components/widgets/v2/CelebrationsOtherSportsWidgets';
// 2026-05-26 — the DESIGN-DAY cinematics from scratch/design/, ported
// to React Canvas2D. These are the "crazy animated cues we spent half
// a day on" — not the simpler CSS widgets in v2/Celebrations*. Operator
// (2026-05-26): "the cueus we made were all those crazy animated
// cueues and you laoded some other gay templates not the shit we
// spent a half a day on making". Use this for water polo first;
// remaining design-day cinematics (volleyball-kill, hockey-goal-v1,
// soccer-goal-v1, etc) port next.
import { CelebrationWaterPoloGoal } from '@/components/widgets/sports/celebrations/CelebrationWaterPoloGoal';
// 2026-05-26 — the shared deck engine + 28-cue registry ported from
// venueos-celebration-deck.html. Every operator-fired cue that isn't
// the per-sport "marquee goal" routes through this deck for the
// proper natatorium/gym/ice/court/turf/mat/plate scene with proper
// burst + motif + projectile + lower-third.
import { CelebrationDeckScene } from '@/components/widgets/sports/celebrations/CelebrationDeckScene';
import { pickDeckCue } from '@/components/widgets/sports/celebrations/celebrationDeckCues';
import { RibbonCelebrationStrip } from '@/components/widgets/sports/celebrations/RibbonCelebrationStrip';
import { celebrationSrc, celebrationLiveDataFromCue } from '@/lib/celebration-assets';
import type { ComponentType } from 'react';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  // T2-9: frequency cap enforcement + mid-game flight-window re-check.
  frequencyCapPerHour?: number | null;
  flightEndAt?: string | null;
}
interface Player {
  id: string;
  team: string;
  name: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  stats: Record<string, string>;
}
/** A fired celebration cue — the ribbon plays the ones targeted at it. */
interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  // Custom cue-deck fields — a full-ribbon takeover of uploaded art.
  custom?: boolean;
  mediaUrl?: string | null;
  color?: string | null;
  durationMs?: number;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
  /**
   * T2-6 — When true, the ribbon uses a tight 2.5s text-crawl strip
   * (RibbonCelebrationStrip) instead of the full 4500ms cinematic
   * takeover. Auto-set by the server when target === 'RIBBON' or when
   * the operator fires from the inline cue bar's "Ribbon" chip.
   * Backwards compatible: cues without this field keep the 4500ms
   * behaviour.
   */
  ribbonStrip?: boolean;
  // Audio URL — server emits this for video-board use; ribbon boards
  // have no speakers so audioUrl is carried for type-completeness only
  // and is intentionally never played here.
  audioUrl?: string | null;
  // Co-branded celebration attribution — when set, "BROUGHT TO YOU BY"
  // attribution renders in the overlay (tasteful, energy-color accent).
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  // 2026-05-26 — scoring team for cinematic team-color routing. The
  // existing fireCue service includes this on the server payload
  // (Lane-8 P1 in sports.service.ts); the interface just needed to
  // surface it so pickCinematic can pull the right home/away cue.
  team?: 'home' | 'away' | null;
  // The score frozen at cue-fire time, captured server-side.
  snapshot?: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeColor?: string | null;
    awayColor?: string | null;
    segmentLabel?: string;
    clockText?: string;
  };
}
interface BoardData {
  id: string;
  sport: string;
  status: string;
  segment: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeColor: string | null;
  awayColor: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown>;
  sponsors?: Sponsor[];
  roster?: Player[];
  /** 2026-05-27 — Operator-set broadcast spotlight (the same featured-
   *  player object the scoreboard shows). When `visible && title`, the
   *  ribbon prepends a hero card to the rotation. Operator no longer
   *  needs to choose between board and ribbon — one button hits both. */
  spotlight?: {
    visible?: boolean;
    title?: string;
    photoUrl?: string | null;
    subtitle?: string;
    lines?: { label: string; value: string }[];
  } | null;
  ribbonMessages?: string[];
  /** Which content presets ride the reel — resolved server-side
   *  (stored config, or the sport's full default-on set). */
  ribbonPresets?: string[];
  /** Operator-set rotation speed — slow / normal / fast / veryfast. */
  ribbonSpeed?: string;
  /** How many times the score anchor repeats around the ribbon —
   *  'auto' | '1'..'4'. 'auto' = derive the count from the width. */
  ribbonScoreRepeat?: string;
  /** Full-bleed image slides the operator uploaded — image URLs. */
  ribbonSlides?: string[];
  /** Recent celebration cues — the board feed's 20s cue window. */
  cues?: Cue[];
  serverTime: number;
  // Sprint 13 — operator-picked custom layouts. NULL → hardcoded
  // ribbon scene below; non-NULL → CustomScoreboardScene rendered
  // here. The same custom-template renderer works for any surface;
  // the operator differentiates by picking a template at the correct
  // aspect ratio (e.g. 11520×192 for a panel-chained ribbon).
  scoreboardTemplateId?: string | null;
  ribbonTemplateId?: string | null;
  scorebugTemplateId?: string | null;
}

// 750ms — sub-second sync, kept in step with the board + scorebug.
const POLL_MS = 750;
// 2026-06-15 — neutral athletic defaults for the LED ribbon (was an app-UI
// indigo/red). A board with no team colors should read like a venue scorebug,
// not a SaaS dashboard: deep navy + crimson.
const DEFAULT_HOME = '#1e3a5f';
const DEFAULT_AWAY = '#9b1c2e';

/** This is the ribbon surface — it plays RIBBON- and ALL-targeted
 *  cues (and legacy untargeted ones); a scoreboard-only cue is
 *  skipped, so a cue fired "to the scoreboard" never hits the ribbon. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'BOARD';
}

// ── celebration error boundary ─────────────────────────────────
//
// 2026-05-27 — a cinematic that throws (null deref, canvas API quirk
// on Chromium-83, math edge case) MUST NOT take down the whole
// ribbon mid-game. Live water polo install operator reported:
// "kick off the others it crashes the entire screen and i get a
// try again and home button…this would take down the entire show".
//
// This boundary catches the throw, logs it, and renders a graceful
// "celebration unavailable" fallback (a minimal animated burst over
// the ribbon's near-black bg) instead of letting React unmount the
// page. The ribbon's normal score/sponsor/slide rotation resumes
// once the cue's TTL expires.
class CelebrationErrorBoundary extends ReactComponent<
  { fallback: ReactNode; children: ReactNode; cueKey?: string },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ribbon] cinematic crashed:', this.props.cueKey, err.message, info.componentStack);
  }
  render() {
    if (this.state.err) return this.props.fallback;
    return this.props.children;
  }
}

// ── helpers ────────────────────────────────────────────────────

function fmtClock(ms: number, showTenths = false): string {
  const safe = Math.max(0, ms);
  // Final minute of a countdown — tenths of a second, the broadcast
  // standard. Games come down to the last fraction.
  if (showTenths && safe < 60_000) {
    const s = Math.floor(safe / 1000);
    const tenths = Math.floor((safe % 1000) / 100);
    return `${s}.${tenths}`;
  }
  const m = Math.floor(safe / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The team nickname for ribbon display — the LAST word of the team
 *  name ("Cleveland Browns" → "BROWNS", "Las Vegas Raiders" →
 *  "RAIDERS", single-word "Raiders" → "RAIDERS"). The ribbon shows the
 *  short nickname; the full name (with city) stays on the scoreboard. */
function teamNick(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (words[words.length - 1] || '—').toUpperCase().slice(0, 14);
}

/** A hex color (#rgb / #rrggbb) as an rgba() string at the given
 *  alpha. Falls back to broadcast gold if the input isn't clean hex,
 *  so a malformed team color can never break a celebration render. */
function hexA(color: string | null | undefined, alpha: number): string {
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return `rgba(251,191,36,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** A team color made readable as TEXT on the dark ribbon. A dark team
 *  color (Raiders black, a deep navy) is invisible on the near-black
 *  ribbon, so anything below a luminance floor is lightened toward
 *  white until it reads. Light colors pass through unchanged. */
function readableInk(color: string | null | undefined): string {
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return '#e2e8f0';
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum >= 0.55) return `#${hex}`;
  const mix = 0.62;
  r = Math.round(r + (255 - r) * mix);
  g = Math.round(g + (255 - g) * mix);
  b = Math.round(b + (255 - b) * mix);
  return `rgb(${r}, ${g}, ${b})`;
}

function segmentLabel(def: SportDefinition, data: BoardData): string {
  const n = data.segment;
  // Inning sports (baseball/softball) NEVER read "OT" past regulation — extra
  // innings are still innings. Render the ordinal regardless of count.
  if (def.segment.name === 'Inning') return `${ordinal(n)} INN`;
  if (n > def.segment.count) {
    // Period/Quarter/Half sports with overtime → "OT"/"2OT". Hole-based and
    // other non-overtime segment sports (golf, meet events) clamp to the last
    // segment label instead of mislabeling it overtime.
    if (def.segment.overtime) {
      const ot = n - def.segment.count;
      return ot > 1 ? `OT${ot}` : 'OT';
    }
    return `${def.segment.name.toUpperCase()} ${def.segment.count}`;
  }
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  // Cross-surface abbreviation parity (audit P2): the board + scorebug
  // render the compact "H1 / R1 / RD1" broadcast form; abbreviate the
  // ribbon's regulation Half / Rotation / Round here too so the three
  // surfaces never disagree. (OT/inning/hole overflow handled above.)
  if (def.segment.name === 'Half') return `H${n}`;
  if (def.segment.name === 'Rotation') return `R${n}`;
  if (def.segment.name === 'Round') return `RD${n}`;
  return `${def.segment.name.toUpperCase()} ${n}`;
}
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * The live game clock — projected from the stored anchor with a STABLE
 * skew captured ONCE per poll, then advanced by a 100ms interval. The
 * old pure `liveClockMs` recomputed skew on every call, which cancelled
 * `Date.now()` out and froze the clock between the 750ms polls — the
 * ribbon clock visibly stuttered. This ticks it exact, every 100ms.
 */
function useLiveClock(data: BoardData | null, def: SportDefinition | undefined): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!data || !def) return;
    const skew = data.serverTime - Date.now();
    const anchorAt = new Date(data.clockUpdatedAt).getTime();
    const project = () => {
      if (!data.clockRunning || def.clock.type === 'none') {
        setMs(data.clockMs);
        return;
      }
      const elapsed = Date.now() + skew - anchorAt;
      if (def.clock.type === 'countup') setMs(data.clockMs + elapsed);
      else setMs(Math.max(0, data.clockMs - elapsed));
    };
    project();
    if (!data.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [data?.clockMs, data?.clockRunning, data?.clockUpdatedAt, data?.serverTime, def]);
  return ms;
}

/**
 * A single punchy line of the sport's LIVE game situation, sized for
 * the ribbon — down & distance, the baseball count, the serve, the
 * basketball bonus. Returns null when nothing is live to show (no
 * down set yet, no server picked) so the situational look is skipped.
 * Reads the SAME Game.stats keys the scoreboard's situational strip
 * uses, so the two surfaces never disagree.
 */
/**
 * T2-8: Merge Game.possession (first-class column) into the stats object
 * so ribbonSituational reads the correct value when the column is set.
 * Falls back to stats.possession for backward compat.
 */
function effectiveStatsWithPossession(
  stats: Record<string, unknown>,
  gamePossession: string | null | undefined,
): Record<string, unknown> {
  if (typeof gamePossession === 'string' && gamePossession) {
    return { ...stats, possession: gamePossession };
  }
  return stats;
}

/**
 * A compact one-line meet result for the ribbon, built from the latest
 * event on the structured stats.results contract. Shows the winner +
 * runner-up of the most-recent event:
 *   "100M FREE — 1 RIVERA 50.21 · 2 OKAFOR 50.88"
 * (For gymnastics/cheer the "event" is the apparatus and the mark is the
 * decimal score.) Returns null when no results exist, so the ribbon falls
 * back to the live now-showing line instead of inventing a result row.
 */
function ribbonResultsLine(stats: Record<string, unknown>): string | null {
  const events = readResults(stats);
  if (events.length === 0) return null;
  const current = events.reduce((best, e) => {
    const bo = best.order ?? -Infinity;
    const eo = e.order ?? -Infinity;
    return eo >= bo ? e : best;
  }, events[events.length - 1]);
  const top = current.entries.slice(0, 2);
  if (top.length === 0) return null;
  const body = top
    .map((r) => {
      const place = r.place > 0 ? `${r.place} ` : '';
      const who = r.name ? r.name.toUpperCase() : '';
      const mark = r.mark ? ` ${r.mark}` : '';
      return `${place}${who}${mark}`.trim();
    })
    .filter(Boolean)
    .join('  ·  ');
  return body ? `${current.event.toUpperCase()} — ${body}` : null;
}

function ribbonSituational(def: SportDefinition, stats: Record<string, unknown>): string | null {
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const side = (v: unknown): 'home' | 'away' | null => {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'home' || s === 'h') return 'home';
    if (s === 'away' || s === 'a') return 'away';
    return null;
  };
  const SEP = '  ·  ';

  // Baseball / softball — the live count + base runners.
  if (def.segment.name === 'Inning') {
    const parts: string[] = [];
    const half = String(stats.half || '').trim();
    if (half) parts.push(half.toUpperCase());
    parts.push(`${num(stats.balls)}-${num(stats.strikes)}`);
    parts.push(`${num(stats.outs)} OUT`);
    const bases: string[] = [];
    if (num(stats.on1B) > 0) bases.push('1ST');
    if (num(stats.on2B) > 0) bases.push('2ND');
    if (num(stats.on3B) > 0) bases.push('3RD');
    parts.push(
      bases.length === 3
        ? '◆ BASES LOADED'
        : bases.length
          ? `◆ ${bases.join(' & ')}`
          : '◇ BASES EMPTY',
    );
    return parts.join(SEP);
  }

  // Football — possession + down & distance + ball-on.
  if (def.key === 'football') {
    const down = num(stats.down);
    const poss = side(stats.possession);
    const ballOn = stats.ballOn;
    const hasBallOn = ballOn !== undefined && ballOn !== null && ballOn !== '';
    if (down <= 0 && !poss && !hasBallOn) return null;
    const parts: string[] = [];
    if (poss) parts.push(`${poss.toUpperCase()} BALL`);
    if (down > 0) {
      const dist = num(stats.distance);
      parts.push(`${ordinal(down)} & ${dist === 0 ? 'GOAL' : dist}`);
    }
    if (hasBallOn) parts.push(`BALL ON ${String(ballOn)}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Basketball — team bonus + possession arrow + foul-trouble (players
  // at 4+ personal fouls, the broadcast "FOUL TROUBLE: #23 (4)" line).
  if (def.key === 'basketball') {
    const bonus = (f: number) => (f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null);
    const parts: string[] = [];
    const hb = bonus(num(stats.homeFouls));
    const ab = bonus(num(stats.awayFouls));
    if (hb) parts.push(`HOME ${hb}`);
    if (ab) parts.push(`AWAY ${ab}`);
    const poss = side(stats.possession);
    if (poss) parts.push(`POSS ${poss.toUpperCase()}`);
    // Foul-trouble — players one away from fouling out (HS 5-foul limit).
    const trouble = readPlayerFouls(stats)
      .filter((p) => p.fouls >= 4)
      .sort((a, b) => b.fouls - a.fouls)
      .slice(0, 3)
      .map((p) => `#${p.jersey}${p.name ? ' ' + p.name.toUpperCase().slice(0, 14) : ''} (${p.fouls})`);
    if (trouble.length) parts.push(`FOUL TROUBLE: ${trouble.join(', ')}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Rally sports — the serve.
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    const serving = String(stats.serving || '').trim();
    return serving ? `SERVING — ${serving.toUpperCase()}` : null;
  }

  // Wrestling — ride-time advantage (the net of the two ride clocks),
  // weight class + period, instead of dumping raw "HOME RIDE TIME (S) 42".
  if (def.key === 'wrestling') {
    const parts: string[] = [];
    const weight = String(stats.weightClass || '').trim();
    if (weight) parts.push(`${weight} LBS`);
    const homeRT = num(stats.homeRideTime);
    const awayRT = num(stats.awayRideTime);
    const adv = homeRT - awayRT; // positive → home advantage
    const fmt = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    };
    if (adv !== 0) {
      parts.push(`RIDE TIME ${fmt(Math.abs(adv))} ADV ${adv > 0 ? 'HOME' : 'AWAY'}`);
    }
    return parts.length ? parts.join(SEP) : null;
  }

  // ── Invasion sports — a tuned line per sport instead of a raw chip
  //    dump. Each composes the broadcast-standard stats fans expect:
  //    soccer shots + stoppage/added time, hockey shots + active power
  //    play, lacrosse shots + ground balls, field hockey shots +
  //    penalty corners. Cards / power-play state read from the same
  //    Game.stats the console writes. ──
  if (def.key === 'soccer') {
    const parts: string[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const added = num(stats.addedTime);
    if (added > 0) parts.push(`+${added}' ADDED`);
    // Cards only when at least one team has one — a 0-0 card line is noise.
    const hCards = num(stats.homeRedCards) * 2 + num(stats.homeYellowCards);
    const aCards = num(stats.awayRedCards) * 2 + num(stats.awayYellowCards);
    if (num(stats.homeRedCards) || num(stats.awayRedCards)) {
      parts.push(`RED ${num(stats.homeRedCards)}-${num(stats.awayRedCards)}`);
    } else if (hCards || aCards) {
      parts.push(`YC ${num(stats.homeYellowCards)}-${num(stats.awayYellowCards)}`);
    }
    return parts.length ? parts.join(SEP) : null;
  }

  if (def.key === 'hockey') {
    const parts: string[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ON GOAL ${hs}-${as}`);
    // A team with active penalties → the other team is on the power play.
    const hp = num(stats.homePenalties);
    const ap = num(stats.awayPenalties);
    if (hp > ap) parts.push('AWAY POWER PLAY');
    else if (ap > hp) parts.push('HOME POWER PLAY');
    else if (hp && ap) parts.push('4-ON-4');
    return parts.length ? parts.join(SEP) : null;
  }

  if (def.key === 'lacrosse') {
    const parts: string[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const hg = num(stats.homeGroundBalls);
    const ag = num(stats.awayGroundBalls);
    if (hg || ag) parts.push(`GB ${hg}-${ag}`);
    return parts.length ? parts.join(SEP) : null;
  }

  if (def.key === 'field_hockey') {
    const parts: string[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const hc = num(stats.homeCorners);
    const ac = num(stats.awayCorners);
    if (hc || ac) parts.push(`CORNERS ${hc}-${ac}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Water polo — shots + per-player exclusion ("X of 3"; 3 = ejected),
  // the broadcast standard. Reads the structured stats.playerExclusions
  // contract; null when nothing is live.
  if (def.key === 'water_polo') {
    const parts: string[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const excl = readPlayerExclusions(stats)
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((p) => `#${p.jersey}${p.name ? ' ' + p.name.toUpperCase().slice(0, 14) : ''} ${p.count} OF 3`);
    if (excl.length) parts.push(`EXCLUSIONS: ${excl.join(', ')}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // ── Meet sports (LEADERBOARD) — real meet content, not a stat dump.
  //    "NOW · {event}" for timed/judged meets; XC lead-runner + finisher
  //    count; golf hole + vs-par. Uses the existing operator-entered live
  //    stats (currentEvent / currentApparatus / leadRunner / currentHole
  //    / homePar / awayPar) PLUS, when the operator has recorded finish /
  //    per-apparatus results (the stats.results contract), a compact
  //    just-completed result line ("100M FREE — 1 RIVERA 50.21 · 2 …").
  //    The result line leads; the now-showing line follows. ──
  if (def.mode === 'LEADERBOARD') {
    const parts: string[] = [];
    const results = ribbonResultsLine(stats);
    if (results) parts.push(results);
    if (def.key === 'golf') {
      const hole = num(stats.currentHole);
      if (hole > 0) parts.push(`HOLE ${hole}`);
      const hPar = String(stats.homePar || '').trim();
      const aPar = String(stats.awayPar || '').trim();
      if (hPar || aPar) {
        parts.push(`HOME ${hPar || 'E'} / AWAY ${aPar || 'E'}`);
      }
    } else if (def.key === 'cross_country') {
      const lead = String(stats.leadRunner || '').trim();
      if (lead) parts.push(`${lead.toUpperCase()} LEADING`);
      const fin = num(stats.finishers);
      if (fin > 0) parts.push(`${fin} FINISHED`);
    } else if (def.key === 'gymnastics') {
      // Gymnastics rotates apparatus (Vault / Bars / Beam / Floor) rather
      // than running named events. `currentApparatus` is the apparatus name.
      const app = String(stats.currentApparatus || '').trim();
      if (app) parts.push(`ON ${app.toUpperCase()}`);
    } else if (def.key === 'competitive_cheer') {
      const div = String(stats.division || '').trim();
      if (div) parts.push(`DIVISION ${div.toUpperCase()}`);
    } else if (def.key === 'diving') {
      // Diving (2026-07-01 split) — judged, no lanes/clock/splits. Show
      // the current diver + dive code/DD, not a "currentEvent" chip
      // (diving never sets that stat key).
      const diver = String(stats.currentDiver || '').trim();
      const code = String(stats.diveCode || '').trim();
      if (diver) parts.push(`NOW DIVING · ${diver.toUpperCase()}${code ? ` (${code.toUpperCase()})` : ''}`);
    } else {
      // Track & field / swimming (+ the deprecated legacy swimming_diving
      // key) — the currently-contested event.
      const ev = String(stats.currentEvent || '').trim();
      if (ev) parts.push(`NOW · ${ev.toUpperCase()}`);
    }
    return parts.length ? parts.join(SEP) : null;
  }

  // Everything else — the SportDefinition stat chips that have a value.
  const chips = def.stats
    .map((s) => {
      const raw = stats[s.key];
      if (raw === undefined || raw === null || raw === '') return null;
      return `${s.label.toUpperCase()} ${String(raw)}`;
    })
    .filter((x): x is string => x !== null)
    .slice(0, 4);
  return chips.length ? chips.join(SEP) : null;
}

/**
 * 2026-06-15 — the vector glyph that LEADS the situational look, replacing
 * emoji-as-iconography on this surface (consumer-grade at distance / on a
 * livestream). Rally sports (volleyball / pickleball) get a serve dot, sports
 * with a live possession side get a directional chevron, everything else gets
 * the sport's drawn mark (which itself falls back to the sport emoji when we
 * have no vector). Returns null when there's no live situation to mark, so the
 * look stays text-only rather than showing a dangling icon.
 */
function ribbonSituationalGlyph(
  def: SportDefinition,
  stats: Record<string, unknown>,
  size: number,
  color: string,
): ReactNode {
  const side = (v: unknown): 'home' | 'away' | null => {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'home' || s === 'h') return 'home';
    if (s === 'away' || s === 'a') return 'away';
    return null;
  };
  // Rally sports — serve dot.
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    return String(stats.serving || '').trim()
      ? <ServeGlyph size={size} color={color} title="Serving" />
      : null;
  }
  // Possession sports — directional chevron toward the team with the ball.
  if (def.key === 'football' || def.key === 'basketball') {
    const poss = side(stats.possession);
    return poss ? <PossessionGlyph dir={poss} size={size} color={color} title="Possession" /> : null;
  }
  // Everyone else — the drawn sport mark (vector, emoji fallback baked in).
  return <SportMark sport={def.key} fallbackEmoji={def.emoji} size={size} color={color} />;
}

// ── content looks ──────────────────────────────────────────────

/**
 * A "look" is one held-static graphic the content zone rotates
 * through. The score / clock are NOT looks — they live in the fixed
 * score zone. Each look carries a dwell time; the operator's ribbon
 * speed scales it (faster speed → shorter dwell).
 */
type Look =
  | { kind: 'situational'; id: string; dwellMs: number }
  | { kind: 'slide'; id: string; url: string; dwellMs: number }
  | { kind: 'sponsor'; id: string; sponsor: Sponsor; dwellMs: number }
  | { kind: 'player'; id: string; player: Player; dwellMs: number }
  | {
      // 2026-05-27 — operator-set broadcast spotlight (same object the
      // scoreboard shows). Distinct from `player` because it has the
      // operator's fully-curated stat lines + a hero-card look, and is
      // ALWAYS shown when active regardless of presets (the operator
      // didn't set it to have it ignored).
      kind: 'spotlight';
      id: string;
      title: string;
      subtitle?: string;
      photoUrl?: string | null;
      lines?: { label: string; value: string }[];
      dwellMs: number;
    }
  | { kind: 'prompt'; id: string; text: string; dwellMs: number }
  | { kind: 'final'; id: string; dwellMs: number }
  | { kind: 'pregame'; id: string; dwellMs: number };

/**
 * Build the content-zone playlist from the operator's presets. Each
 * preset is a content type the operator toggled on; `ribbonPresets`
 * is the resolved list (server falls back to every applicable preset
 * when the reel was never configured). Buckets are round-robined so
 * the rotation always mixes types — never three sponsors in a row.
 */
function buildLooks(data: BoardData, def: SportDefinition): Look[] {
  const homeCode = teamNick(data.homeTeam);
  const enabled = new Set<string>(
    Array.isArray(data.ribbonPresets) ? data.ribbonPresets : defaultRibbonPresets(def),
  );

  const situational: Look[] = [];
  if (enabled.has('situation')) {
    const sit = ribbonSituational(def, effectiveStatsWithPossession((data.stats || {}) as Record<string, unknown>, (data as any).possession));
    if (sit) situational.push({ kind: 'situational', id: 'situational', dwellMs: 8000 });
  }
  // item F (2026-06-21) — the operator controls how long each image holds on
  // the ribbon (was a hardcoded 8.5s). Read the per-game setting from stats,
  // clamped to a sane 2–60s; fall back to 8.5s when unset.
  const slideDwellMs = (() => {
    const v = Number((data.stats as Record<string, unknown> | undefined)?.ribbonSlideDwellMs);
    return Number.isFinite(v) && v >= 2000 && v <= 60000 ? v : 8500;
  })();
  const slides: Look[] = enabled.has('slides')
    ? (data.ribbonSlides || []).map((url) => ({
        kind: 'slide' as const,
        id: `slide:${url}`,
        url,
        dwellMs: slideDwellMs,
      }))
    : [];
  const sponsors: Look[] = enabled.has('sponsors')
    ? (data.sponsors || []).map((sp) => ({
        kind: 'sponsor' as const,
        id: `sponsor:${sp.id}`,
        sponsor: sp,
        dwellMs: 7000,
      }))
    : [];
  const players: Look[] = enabled.has('roster')
    ? (data.roster || []).map((p) => ({
        kind: 'player' as const,
        id: `player:${p.id}`,
        player: p,
        dwellMs: 7500,
      }))
    : [];
  let prompts: Look[] = [];
  if (enabled.has('prompts')) {
    const custom = (data.ribbonMessages || []).map((m) => m.trim()).filter(Boolean);
    const list = custom.length
      ? custom
      : ['LET’S GO!', `GO ${homeCode}!`, 'MAKE SOME NOISE', 'DEFENSE!', `${homeCode} PRIDE`];
    prompts = list.map((text, i) => ({
      kind: 'prompt' as const,
      id: `prompt:${i}:${text}`,
      text,
      dwellMs: 6000,
    }));
  }

  const buckets = [situational, slides, sponsors, players, prompts].filter((b) => b.length);
  const looks: Look[] = [];
  for (let round = 0; ; round++) {
    let added = false;
    for (const b of buckets) {
      if (round < b.length) {
        looks.push(b[round]);
        added = true;
      }
    }
    if (!added) break;
  }

  // A ribbon is never blank — fall back to a single crowd prompt.
  if (looks.length === 0) {
    looks.push({ kind: 'prompt', id: 'prompt:fallback', text: `GO ${homeCode}!`, dwellMs: 6000 });
  }

  // Game-state-specific looks — prepended so they lead the rotation.
  // Only ONE state-specific look is injected per game state, and only
  // for FINAL and PRE_GAME/SCHEDULED. LIVE and HALFTIME are left as-is
  // (the regular rotation is appropriate — fans are watching the action).
  if (data.status === 'FINAL') {
    looks.unshift({ kind: 'final', id: 'state:final', dwellMs: 10000 });
  } else if (data.status === 'PRE_GAME' || data.status === 'SCHEDULED') {
    looks.unshift({ kind: 'pregame', id: 'state:pregame', dwellMs: 9000 });
  }

  // 2026-05-27 — Spotlight goes ABOVE the state-specific look so that
  // when the operator features a player, that's the FIRST thing the
  // crowd sees as the rotation cycles. Visible-and-title gate matches
  // the board page's same predicate. Hides itself the moment the
  // operator clears the spotlight on the next /sports/board poll.
  const sp = data.spotlight;
  if (sp && sp.visible && sp.title && sp.title.trim()) {
    looks.unshift({
      kind: 'spotlight',
      id: `spotlight:${sp.title}`,
      title: sp.title,
      subtitle: sp.subtitle,
      photoUrl: sp.photoUrl ?? null,
      lines: Array.isArray(sp.lines) ? sp.lines : [],
      dwellMs: 9000,
    });
  }

  return looks;
}

// ── page ───────────────────────────────────────────────────────

export default function RibbonPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  const [data, setData] = useState<BoardData | null>(null);
  // Actual window pixels. The LOGICAL ribbon canvas `vp` is derived from
  // this — or from a ?canvas=WxH demo override (below).
  const [winSize, setWinSize] = useState({ w: 1920, h: 240 });
  // ?canvas=WIDTHxHEIGHT — demo/preview override. Renders the ribbon at a
  // FIXED pixel canvas (e.g. a real 3077×256 / 1000mm-high LED) scaled to
  // fit THIS screen, letterboxed — so an operator can show a customer the
  // true wide-short ribbon shape on any display (even a portrait demo
  // panel). Null = render at the native window size (normal behavior).
  const [fixedCanvas, setFixedCanvas] = useState<{ w: number; h: number } | null>(null);
  const vp = fixedCanvas || winSize;
  // installer override for the score-anchor count — ?score=N (0 = auto)
  const [scoreOverride, setScoreOverride] = useState(0);
  // which content look is showing
  const [lookIdx, setLookIdx] = useState(0);

  // cue playback — celebrations the operator fired at the ribbon (or ALL)
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const seenCues = useRef<Set<string>>(new Set());
  const cueQueue = useRef<Cue[]>([]);
  const firstLoad = useRef(true);
  const playing = useRef(false);
  // 2026-06-05 (v2) — coalesce duplicate celebration cues from ONE scoring
  // moment. The auto-celebrate always carries `team`; a manual player fire
  // usually has `team:null`, so the v1 `key|team` sig never matched and both
  // played. Match on KEY with a team-WILDCARD (empty matches any) within a
  // window wide enough to cover the scorer-pick delay; a genuine
  // home-then-away of the same key still plays twice.
  const lastCueSig = useRef<{ key: string; team: string; t: number }>({ key: '', team: '', t: 0 });
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    // A custom cue holds for its own duration; a sport celebration
    // matches the 3.9s celebration animation.
    // 2026-05-26 — bumped from 3900 to 4500ms so the design-day
    // CelebrationWaterPoloGoal Canvas2D cinematic (full duration
    // 4300ms — fadeIn + flight + impact + hold + fadeOut) plays to
    // completion + an extra beat. Custom-uploaded media still
    // honors its own durationMs.
    //
    // T2-6 — ribbonStrip cues use 2500ms: the RibbonCelebrationStrip
    // is a tight text-crawl, NOT the full cinematic, so there is no
    // reason to hold the ribbon for 4.5s. 2500ms gives the animated
    // stripe + entrance one full cycle and reads cleanly at 8-foot
    // viewing distance before the rotation resumes.
    // Also auto-applies when target === 'RIBBON' (server already sets
    // ribbonStrip: true in that case, but guard here too for older
    // events that predate the field).
    const isRibbonStrip = next.ribbonStrip === true || next.target === 'RIBBON';
    const holdMs =
      next.mediaUrl && next.durationMs && next.durationMs > 0
        ? next.durationMs
        : isRibbonStrip
          ? 2500
          : 4500;
    cueTimer.current = setTimeout(() => {
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, holdMs);
  };

  // Cancel a pending cue timer on unmount (kiosk route reloads).
  useEffect(() => () => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
  }, []);

  // viewport measure
  useEffect(() => {
    const measure = () =>
      setWinSize({ w: window.innerWidth || 1920, h: window.innerHeight || 240 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Read the ?score=N installer override once on mount — pins the
  // score-anchor count for a commissioned full-bowl wrap. Uses
  // window.location (not useSearchParams) so the page needs no
  // Suspense boundary and the Next production build stays clean.
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get('score'));
    if (Number.isFinite(n) && n >= 1 && n <= 6) setScoreOverride(Math.round(n));
  }, []);

  // Read the ?canvas=WIDTHxHEIGHT demo override once on mount (e.g.
  // ?canvas=3077x256 mirrors a 1000mm-high / 3.9mm-pitch 40ft ribbon).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('canvas');
    const m = raw && raw.match(/^(\d{2,5})x(\d{2,5})$/i);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 16 && h >= 16) setFixedCanvas({ w, h });
    }
  }, []);

  // Poll health → staleness chip. onStatus fires every ~750ms; the chip
  // decision changes rarely, so the health sample lands in a ref and a 1s
  // ticker below derives the boolean (re-rendering only when it flips).
  //
  // Refuter fix B2 (2026-08-09): navigator.onLine === false must NEVER set
  // the chip by itself — Android WebViews on wired-ethernet transports (our
  // LED controllers) are documented to misreport onLine=false while a
  // healthy 750ms poll stream keeps updating the strip, which showed
  // CONNECTION LOST permanently over a live ribbon. Poll health is the
  // only authority: a misreported offline may only ACCELERATE the verdict
  // (2s threshold instead of 8s) when polls really have stopped landing.
  const pollHealth = useRef({ lastGoodAt: Date.now() });
  const [feedStale, setFeedStale] = useState(false);
  useEffect(() => {
    const evalStale = () => {
      const sinceGood = Date.now() - pollHealth.current.lastGoodAt;
      const threshold = navigator.onLine === false ? 2000 : STALE_FEED_AFTER_MS;
      setFeedStale(sinceGood > threshold);
    };
    const t = setInterval(evalStale, 1000);
    return () => clearInterval(t);
  }, []);

  // poll the public board endpoint — through the shared hardened engine
  // (self-chaining so slow responses never overlap, If-None-Match/304
  // revalidation when the API offers an ETag, jittered 1.5/3/5s backoff
  // while it's unreachable; see lib/board-poll.ts). Cue-dedup semantics
  // below are unchanged from the old inline load().
  useEffect(() => {
    if (!gameId) return;
    // Cold-boot: instant paint from the last cached frame so a
    // power-cycle / Wi-Fi blip never blanks the ribbon.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) setData(cached);
    return startBoardPoll({
      url: `${API_URL}/sports/board/${gameId}`,
      intervalMs: POLL_MS,
      onPayload: (payload) => {
        const json = payload as BoardData;
        setData(json);
        writeBoardCache(gameId, json);
        // Queue new celebration cues targeted at the ribbon. The first
        // poll's cues already happened before the ribbon opened —
        // record them as seen but don't replay.
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          if (firstLoad.current || !cuePlaysHere(c.target)) continue;
          // Drop the auto+manual duplicate of one scoring moment (see the
          // lastCueSig comment above): same KEY, team-wildcard, 6s window.
          const ck = String(c.key || '');
          const ctm = String(c.team || '');
          const nowMs = Date.now();
          const lc = lastCueSig.current;
          const isDup =
            ck !== '' &&
            lc.key === ck &&
            (!lc.team || !ctm || lc.team === ctm) &&
            nowMs - lc.t < 6000;
          if (isDup) continue;
          lastCueSig.current = { key: ck, team: ctm, t: nowMs };
          cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
      },
      // 304 — content unchanged; refresh only the skew anchor so the
      // projected clock stays honest without touching cue-dedup state.
      onServerTime: (n) =>
        setData((prev) => (prev ? { ...prev, serverTime: n } : prev)),
      onStatus: (s) => {
        pollHealth.current = { lastGoodAt: s.lastGoodAt };
        // The chip must clear the INSTANT a good poll lands (200 or 304),
        // UNCONDITIONALLY — a healthy poll stream always means NO chip,
        // even when navigator.onLine misreports false (refuter fix B2).
        // The 1s ticker above only handles the (slow) appear side.
        if (s.online) setFeedStale(false);
      },
    });
  }, [gameId]);

  // 2026-06-15 — DOUBLE-FIRE FIX (ribbon surface). RibbonCueOverlay is the
  // single celebration authority here; an embedded CtsCelebration/Orchestrator
  // widget on a custom ribbon template must NOT also auto-fire the same cue.
  // See the matching flag on the board route.
  useEffect(() => {
    const w = window as Window & { __VENUEOS_SURFACE_HANDLES_CUES?: boolean };
    w.__VENUEOS_SURFACE_HANDLES_CUES = true;
    return () => { w.__VENUEOS_SURFACE_HANDLES_CUES = false; };
  }, []);

  const def = useMemo(() => (data ? findSport(data.sport) : undefined), [data]);

  // Sprint 13 — CTS source-of-truth merge. When the CTS console is
  // broadcasting fresh data (Game.stats.cts.lastUpdateAt within 5 s of
  // serverTime) clock / score / segment come from CTS. Stale or absent
  // → operator inputs win. Same helper used by the board route so both
  // surfaces render identical numbers. Apply ONCE here and substitute
  // for `data` in every downstream read (live-clock projector, looks
  // builder, sponsor banner, etc.).
  const viewData = useMemo(
    () => (data ? applyCtsOverlay(data) : data),
    [data],
  );

  // Live clock, projected smoothly between polls (see useLiveClock).
  const clockMs = useLiveClock(viewData, def);

  // A stable key over every input buildLooks reads. `looks` is rebuilt
  // ONLY when this changes — so a clock-tick / score-change re-render
  // keeps the same `looks` array identity and never resets the
  // rotation timer mid-dwell.
  // looksKey + buildLooks read from `viewData` so a CTS-overlay
  // change to `stats.shotClock` (only relevant for sports whose
  // `ribbonSituational` consumes the shotClock anchor) is reflected.
  // For every other field the helper preserves by reference, so this
  // is identical to reading off `data`.
  const looksKey = useMemo(() => {
    const src = viewData ?? data;
    if (!src || !def) return '';
    const sit = !!ribbonSituational(def, effectiveStatsWithPossession((src.stats || {}) as Record<string, unknown>, (src as any).possession));
    return JSON.stringify({
      presets: src.ribbonPresets ?? null,
      sponsors: (src.sponsors || []).map((s) => s.id),
      roster: (src.roster || []).map((p) => p.id),
      messages: src.ribbonMessages ?? null,
      slides: src.ribbonSlides ?? null,
      sport: src.sport,
      home: src.homeTeam,
      sit,
    });
  }, [viewData, data, def]);

  // T2-9: track when each sponsor was shown (sliding 60-min window) for
  // frequency-cap enforcement. Lives here in RibbonPage so it persists
  // across looksKey rebuilds.
  const shownTimestampsRibbon = useRef<Map<string, number[]>>(new Map());

  const looks = useMemo(
    () => {
      const src = viewData ?? data;
      if (!src || !def) return [];
      // Pre-filter sponsors for flight-window + frequency-cap before buildLooks.
      const now = Date.now();
      const oneHourAgo = now - 3_600_000;
      const filtered: BoardData = {
        ...src,
        sponsors: (src.sponsors || []).filter((sp) => {
          if (sp.flightEndAt && new Date(sp.flightEndAt).getTime() <= now) return false;
          if (sp.frequencyCapPerHour !== null && sp.frequencyCapPerHour !== undefined) {
            const recent = (shownTimestampsRibbon.current.get(sp.id) || []).filter(
              (t) => t > oneHourAgo,
            );
            shownTimestampsRibbon.current.set(sp.id, recent);
            if (recent.length >= sp.frequencyCapPerHour) return false;
          }
          return true;
        }),
      };
      return buildLooks(filtered, def);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [looksKey],
  );

  // keep the rotation index in range when the playlist shrinks
  useEffect(() => {
    if (looks.length > 0 && lookIdx >= looks.length) setLookIdx(0);
  }, [looks, lookIdx]);

  // rotation engine — hold each look for its dwell, then advance.
  // Pauses while a celebration cue is taking the ribbon over.
  useEffect(() => {
    if (looks.length <= 1 || activeCue) return;
    const look = looks[lookIdx] || looks[0];
    const speed = ribbonSpeedMultiplier(data?.ribbonSpeed) || 1;
    const dwell = Math.max(3200, (look?.dwellMs ?? 7000) / speed);
    const t = setTimeout(() => setLookIdx((i) => (i + 1) % looks.length), dwell);
    return () => clearTimeout(t);
  }, [looks, lookIdx, activeCue, data?.ribbonSpeed]);

  // T2-9: impression ping when a sponsor look enters view.
  const lastPingedRibbonSponsor = useRef<string | null>(null);
  useEffect(() => {
    const look = looks[lookIdx % Math.max(looks.length, 1)];
    if (!look || look.kind !== 'sponsor') {
      lastPingedRibbonSponsor.current = null;
      return;
    }
    const sp = look.sponsor;
    if (lastPingedRibbonSponsor.current === sp.id) return;
    lastPingedRibbonSponsor.current = sp.id;
    // Record locally for cap enforcement.
    const prev = shownTimestampsRibbon.current.get(sp.id) || [];
    prev.push(Date.now());
    shownTimestampsRibbon.current.set(sp.id, prev);
    // Fire-and-forget POST.
    if (gameId) {
      fetch(`${API_URL}/sports/sponsors/${sp.id}/impression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, surfaceKind: 'ribbon' }),
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookIdx, looks, gameId]);

  if (!data || !def) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: '#05070d',
        }}
      />
    );
  }

  // 2026-05-27 — Render off the CTS-merged view. `viewData` is `data`
  // with score / clock / segment / stats.shotClock overlaid from
  // `Game.stats.cts` when fresh; identical to `data` when stale or
  // absent. Every field NOT in that overlay (sponsors, ribbon presets,
  // roster, cues, spotlight, template ids) is preserved by reference —
  // so substituting `viewData` for `data` below is safe and produces
  // an identical render in the non-CTS path.
  const view = viewData ?? data;

  // Sprint 13 — operator picked a custom ribbon template. Hand off to
  // CustomScoreboardScene (same renderer; the template's canvas size
  // is what differentiates a scoreboard layout from a ribbon layout —
  // an operator picks a long-and-thin template, e.g. 11520×192, when
  // configuring a perimeter ribbon panel chain).
  if (data.ribbonTemplateId) {
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: '#05070d' }}>
        <CustomScoreboardScene
          templateId={data.ribbonTemplateId}
          gameId={gameId}
          initial={view}
          // 2026-05-26 — pass the already-resolved template from
          // /sports/board so the public ribbon page doesn't 401 on
          // /templates/:id (admin-auth-required).
          embedded={(data as { ribbonTemplate?: any }).ribbonTemplate ?? null}
        />
        {feedStale && <ConnectionLostPill pulseName="rbnStalePulse" defineKeyframe variant="ribbon" stripHeight={vp.h} />}
      </div>
    );
  }

  // 2026-05-20 — operator's "drop in a ribbon-sized file" path. When the
  // operator has uploaded ribbon media (images / videos already cut to
  // the ribbon height), render it FULL-HEIGHT and scrolling at native
  // pixels — never squished into a tiny look-zone — with the score
  // pinned ONCE (their hardware repeater replicates the frame along the
  // physical run, so software never multiplies the anchor). This is the
  // simple "everything scrolls, only the score is pinned" model the
  // operator asked for; it bypasses the rotating-"looks" model below.
  //
  // 2026-05-27 — Operator: "i have a lot of settings i can enable for
  // the ribbon screen but seems none of them work, just the score and
  // the ribbon media play nothing else". Root cause: this early-return
  // ABSORBED every game into media-scroll mode the moment ANY slide
  // OR sponsor existed — silently dropping crowd messages, roster
  // cards, and the per-sport situational look the operator had toggled
  // ON in `Ribbon content`. Two corrections below:
  //   1. The presence test now honors the `slides`/`sponsors` toggles
  //      from the Ribbon content panel (toggling them OFF removes them
  //      from the marquee, matching the operator's expectation).
  //   2. We only take this short-circuit when none of the other
  //      engagement presets (prompts / roster / situation) have content
  //      to show — otherwise we fall through to the looks-rotation path
  //      below, which already mixes slides+sponsors WITH messages,
  //      roster cards, and the live game situation.
  // The enabled set + content presence flags pre-compute once here so
  // both this gate and the inner RibbonMediaScroll honor the same
  // toggles consistently.
  const ribbonEnabled = new Set<string>(
    Array.isArray(data.ribbonPresets) ? data.ribbonPresets : defaultRibbonPresets(def),
  );
  const slidesOn = ribbonEnabled.has('slides');
  const sponsorsOn = ribbonEnabled.has('sponsors');
  const promptsOn = ribbonEnabled.has('prompts');
  const rosterOn = ribbonEnabled.has('roster');
  const situationOn = ribbonEnabled.has('situation');
  const hasSlides = slidesOn && (data.ribbonSlides || []).filter(Boolean).length > 0;
  const hasSponsors = sponsorsOn && (data.sponsors || []).length > 0;
  const hasMessages =
    promptsOn && (data.ribbonMessages || []).map((m) => m.trim()).filter(Boolean).length > 0;
  const hasRoster = rosterOn && (data.roster || []).length > 0;
  const hasSituation =
    situationOn && !!ribbonSituational(def, effectiveStatsWithPossession((data.stats || {}) as Record<string, unknown>, (data as any).possession));
  // Take the marquee-only path when there IS media/sponsor content AND
  // no other engagement-look has content. Operator-typed crowd messages
  // count as engagement content too — so a custom message like
  // "GO LIONS!" reliably shows up even when sponsors are uploaded.
  if (
    def &&
    (hasSlides || hasSponsors) &&
    !hasMessages &&
    !hasRoster &&
    !hasSituation
  ) {
    const ribbonBody = (
      <>
        {/* 2026-05-27 — merged: Agent 1's content-toggle gates + Agent 2's
            CTS overlay. `view` is the operator's game data with CTS
            snapshots layered on top when fresh; the toggle gates drop
            slides/sponsors/segment/clock from the marquee per the
            operator's Ribbon-content choices. Both fixes alive. */}
        <RibbonMediaScroll
          data={view}
          def={def}
          vp={vp}
          clockMs={clockMs}
          slidesOn={slidesOn}
          sponsorsOn={sponsorsOn}
          segmentOn={ribbonEnabled.has('segment')}
          clockOn={ribbonEnabled.has('clock')}
        />
        {/* Celebrations must still take over the ribbon in media mode.
            The old looks path rendered this; the early return above
            dropped it (operator: "triggered celebrations and nothing
            triggered on the ribbon"). One full-width burst — the
            operator's hardware repeater replicates it down the run. */}
        {activeCue && (
          <RibbonCueOverlay
            cue={activeCue}
            h={vp.h}
            segCount={1}
            segWf={vp.w}
            sport={data?.sport}
            // 2026-05-28 — celebration pack now defaults to 'v2' (the
            // operator's preferred sophisticated FINA water polo canvas
            // engine from commit 87da542). v2 already falls back to v1
            // art for sports without v2 cues, so this is a strict upgrade.
            pack={
              // 2026-06-15 — default to v1 (ribbon-native strip, no squish);
              // v2 only when explicitly opted in. See board route for why.
              // 2026-06-16 — basketball defaults to v2: its hoop cinematic
              // (cues-basketball.js) renders ribbon-native, replacing the flat
              // text strip every basketball cue used to get.
              ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v2'
                || data?.sport === 'basketball' || data?.sport === 'water_polo' || data?.sport === 'water-polo'
                ? 'v2'
                : 'v1') as 'v1' | 'v2'
            }
          />
        )}
        {/* 2026-05-27 — Spotlight ALSO has to layer over media-scroll
            mode. Operator pushes a player to spotlight (single button
            press, same as scoreboard) → board shows hero card → ribbon
            should ALSO show the player. Earlier the spotlight was only
            wired into the looks-rotation path, but a tenant with any
            uploaded ribbon slide skips looks entirely → the spotlight
            never rendered on the ribbon in production. Render an
            always-on overlay on top of the marquee while spotlight is
            visible; clears the moment the operator clears it. */}
        {data.spotlight && data.spotlight.visible && data.spotlight.title && data.spotlight.title.trim() ? (
          <SpotlightOverlay spotlight={data.spotlight} h={vp.h} w={vp.w} homeColor={data.homeColor || DEFAULT_HOME} />
        ) : null}
        {feedStale && <ConnectionLostPill pulseName="rbnStalePulse" defineKeyframe variant="ribbon" stripHeight={vp.h} />}
      </>
    );
    // ?canvas=WxH demo: scale the fixed ribbon canvas to fit the screen,
    // centered + letterboxed, so the true wide-short shape shows on any
    // display (e.g. a portrait demo panel during a customer walkthrough).
    if (fixedCanvas) {
      const scale = Math.min(winSize.w / fixedCanvas.w, winSize.h / fixedCanvas.h) || 1;
      return (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: '#000', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: fixedCanvas.w,
              height: fixedCanvas.h,
              transform: `translate(-50%, -50%) scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            {ribbonBody}
          </div>
        </div>
      );
    }
    return ribbonBody;
  }

  // ── score-anchor recurrence ──────────────────────────────────
  // On a continuous full-bowl wrap the ribbon is one very long strip;
  // a single scorebug at one end is unreadable from the bowl's far
  // side. So the [score | content] unit RECURS around the ribbon and
  // the scorebug stays glanceable from every seat. The count
  // auto-derives from the ribbon's aspect ratio; an installer can pin
  // it with ?score=N on the kiosk URL.
  const aspect = vp.w / Math.max(1, vp.h);
  const autoAnchors = Math.max(1, Math.min(6, Math.round(aspect / 9)));
  // Never subdivide so far a segment can't hold a scorebug — each
  // anchor needs ≥ ~700px of ribbon width to read.
  const maxAnchors = Math.max(1, Math.floor(vp.w / 700));
  // Precedence: ?score=N installer override → the operator's saved
  // config (Ribbon content → Score in the console) → auto from the
  // ribbon's aspect ratio.
  const configuredAnchors = ribbonScoreRepeatCount(data.ribbonScoreRepeat);
  const segCount = Math.min(scoreOverride || configuredAnchors || autoAnchors, maxAnchors);
  const segWf = vp.w / segCount;
  // Per-anchor score-zone width — the legacy single-anchor formula,
  // scoped to one segment, so a straight ribbon (segCount === 1)
  // renders byte-identically to before.
  const scoreZoneW = Math.round(Math.max(360, Math.min(segWf * 0.4, vp.h * 4.4)));
  // One uniform content-zone width across every anchor so the sponsor
  // marquees stay in lock-step; sub-pixel seam slop is absorbed by the
  // near-black ribbon background and the root overflow clip.
  const contentW = Math.max(0, Math.round(segWf) - scoreZoneW);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: '#05070d',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`
@keyframes rbnPulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes rbnFade{from{opacity:0}to{opacity:1}}
@keyframes rbnScrim{0%{opacity:0}10%{opacity:1}90%{opacity:1}100%{opacity:0}}
@keyframes rbnGlow{0%{opacity:0;transform:scale(0.4)}18%{opacity:1;transform:scale(1)}86%{opacity:0.9;transform:scale(1.06)}100%{opacity:0;transform:scale(1.12)}}
@keyframes rbnRing{0%{opacity:0;transform:scale(0.2)}9%{opacity:0.9}52%{opacity:0}100%{opacity:0;transform:scale(3.6)}}
@keyframes rbnSweep{0%{opacity:0;transform:translateX(-1600px) skewX(-14deg)}5%{opacity:0.85}24%{opacity:0.85}34%{opacity:0;transform:translateX(1600px) skewX(-14deg)}100%{opacity:0;transform:translateX(1600px) skewX(-14deg)}}
@keyframes rbnSlam{0%{opacity:0;transform:scale(1.5)}10%{opacity:1;transform:scale(0.93)}16%{transform:scale(1.05)}22%{transform:scale(1)}90%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.03)}}
@keyframes rbnMarquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
${SCORE_MOTION_KEYFRAMES}
      `}</style>

      {/* [score | content] units, recurring around the ribbon so a
          continuous full-bowl wrap is glanceable from every seat. A
          straight ribbon resolves to one unit and renders as before. */}
      {Array.from({ length: segCount }, (_, s) => {
        const segLeft = Math.round(s * segWf);
        return (
          <div key={s}>
            {/* score / clock anchor — never moves; digits update in place.
                2026-05-27 — reads CTS-merged values when the bridge is
                fresh; clock/segment toggles in Ribbon content hide those
                fields from the anchor status line when the operator turns
                them off. */}
            <ScoreZone
              data={view}
              def={def}
              left={segLeft}
              w={scoreZoneW}
              h={vp.h}
              clockMs={clockMs}
              segmentOn={ribbonEnabled.has('segment')}
              clockOn={ribbonEnabled.has('clock')}
            />
            {/* rotating content zone — held-static looks, fast crossfades.
                Every anchor shares one rotation index, so the whole
                bowl crossfades in lock-step. */}
            <ContentZone
              looks={looks}
              idx={Math.min(lookIdx, Math.max(0, looks.length - 1))}
              left={segLeft + scoreZoneW}
              w={contentW}
              h={vp.h}
              data={view}
              def={def}
            />
          </div>
        );
      })}

      {/* celebration cue overlay — a fired cue TAKES OVER the whole ribbon.
          2026-06-06 (THE double-fire) — this used segCount/segWf, which tiled
          the celebration ONCE PER SCORE ANCHOR. On any ribbon with >1 score
          anchor (the common bowl-wrap config), one fired cue therefore painted
          the SAME celebration 2+ times across the strip — which the operator
          on the console ribbon-preview saw as the celebration "firing twice."
          The takeover is ONE moment: render a SINGLE full-width burst (segWf =
          full viewport), exactly like the media-mode path above. On a real
          wrapped bowl the hardware repeater replicates the frame down the run,
          so per-anchor software tiling is both wrong here and double-renders
          the cinematic. The persistent SCORE still repeats per anchor (that's
          the `segCount` loop above); only the celebration is de-tiled. */}
      {activeCue && (
        <RibbonCueOverlay
          cue={activeCue}
          h={vp.h}
          segCount={1}
          segWf={vp.w}
          sport={data?.sport}
          pack={
            // 2026-06-15 — default to v1 (ribbon-native strip, no squish).
            // 2026-06-16 — basketball defaults to v2 (ribbon-native hoop cinematic).
            ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v2'
              || data?.sport === 'basketball' || data?.sport === 'water_polo' || data?.sport === 'water-polo'
              ? 'v2'
              : 'v1') as 'v1' | 'v2'
          }
        />
      )}
      {feedStale && <ConnectionLostPill pulseName="rbnStalePulse" defineKeyframe variant="ribbon" stripHeight={vp.h} />}
    </div>
  );
}

// ── ribbon media scroll ────────────────────────────────────────
// The operator's "give you a file and it just scrolls" path.

/** Is this ribbon-media URL a video (vs an image)? Extension sniff. */
function isRibbonVideo(u: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(u || '');
}

/**
 * Full-height scrolling ribbon media. The operator uploads media already
 * cut to the ribbon HEIGHT (e.g. 1280×256 for a 1000mm / 3.9mm-pitch
 * ribbon) and it renders at NATIVE height — filling the ribbon
 * vertically — looped across the width and scrolling. NEVER squished to
 * fit one tiny zone (the bug in the rotating-"looks" model). The score
 * stays pinned in ONE anchor; the operator's hardware repeater
 * replicates the rendered frame along the physical run, so software
 * never multiplies the score.
 *
 * A SINGLE video is special-cased: it's already a scroll clip, so we
 * play it full-height + tiled to fill WITHOUT a marquee — stacking a
 * marquee on a baked-in scroll would double the motion. Images, or
 * multiple items, ride the seamless marquee so "everything scrolls."
 *
 * Chromium-83 / NovaStar-Taurus safe: long-hand sides (no `inset`),
 * transform-only animation, no flex `gap`.
 */
function RibbonMediaScroll({
  data,
  def,
  vp,
  clockMs,
  slidesOn,
  sponsorsOn,
  segmentOn = true,
  clockOn = true,
}: {
  data: BoardData;
  def: SportDefinition;
  vp: { w: number; h: number };
  clockMs: number;
  /** Operator toggles in `Ribbon content` — when false the corresponding
   *  items drop out of the marquee even if uploaded. */
  slidesOn: boolean;
  sponsorsOn: boolean;
  /** Honored by the pinned ScoreZone anchor — flipping clock/segment
   *  off in setup hides those fields from the badge. */
  segmentOn?: boolean;
  clockOn?: boolean;
}) {
  // 2026-05-27 — Respect the Ribbon content panel toggles so flipping
  // "Image slides" off in setup actually removes the slides from the
  // marquee (previously this component pulled both arrays directly,
  // ignoring the toggles).
  const slides = slidesOn ? (data.ribbonSlides || []).filter(Boolean) : [];
  const sponsors = sponsorsOn
    ? (data.sponsors || []).filter((sp) => sp && (sp.logoUrl || sp.name))
    : [];
  // The scroll lane carries BOTH the operator's uploaded ribbon media
  // AND the tenant's sponsor logos — everything rides one seamless
  // marquee at native ribbon height (operator: "make sure it works for
  // uploaded images AND the sponsor images"). Uploaded media renders
  // full-bleed at native aspect; a sponsor renders as a full-height
  // logo + name card.
  const items: Array<{ t: 'media'; url: string } | { t: 'sponsor'; sp: Sponsor }> = [
    ...slides.map((url) => ({ t: 'media' as const, url })),
    ...sponsors.map((sp) => ({ t: 'sponsor' as const, sp })),
  ];
  // Media fills the FULL width and scrolls BEHIND a pinned score badge —
  // "everything scrolls, only the score is pinned" (the operator's
  // original, better model). The badge sits over the left of the run;
  // the hardware repeater replicates this whole frame so the score
  // recurs along the physical ribbon without software multiplying it.
  const scoreZoneW = Math.round(Math.max(360, Math.min(vp.w * 0.34, vp.h * 4.4)));
  const speedMult = ribbonSpeedMultiplier(data.ribbonSpeed) || 1;
  // Only the pure single-clip case (one video, nothing else) skips the
  // marquee — that clip is already animated, so we tile + play it.
  const singleVideo = items.length === 1 && slides.length === 1 && isRibbonVideo(slides[0]);

  // Each item: full ribbon height, native aspect width (no squish).
  const mediaStyle: CSSProperties = {
    height: '100%',
    width: 'auto',
    display: 'block',
    flexShrink: 0,
  };
  const renderMedia = (url: string, key: string) =>
    isRibbonVideo(url) ? (
      <video key={key} src={url} autoPlay loop muted playsInline style={mediaStyle} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={key} src={url} alt="" style={mediaStyle} />
    );

  // A sponsor renders as a full-height card — logo (native aspect) above
  // its name. Capped logo height + max width so a huge asset can't
  // 2026-05-26 — operator screenshot showed sponsor zone filling
  // ~30% of the ribbon height while the scoreboard area filled 100%.
  // Root cause was sLogoH = vp.h * 0.5 — half the ribbon was just
  // empty padding. Bumped logo to 0.88 of zone height and name to
  // 0.30 so the sponsor zone reads as big and confident as the
  // scoreboard does. Padding tightened from 0.45 → 0.12 so logos
  // sit closer together (a wide-aspect logo can still breathe via
  // its own intrinsic ratio).
  const sLogoH = Math.round(vp.h * 0.88);
  const sNameSize = Math.max(18, Math.round(vp.h * 0.30));
  const sPad = Math.round(vp.h * 0.12);
  const renderSponsor = (sp: Sponsor, key: string) => (
    <div
      key={key}
      style={{
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${sPad}px`,
      }}
    >
      {sp.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sp.logoUrl}
          alt=""
          style={{
            // Set BOTH height AND a generous max-width so an
            // intrinsically narrow logo (square / portrait) renders
            // big AND a wide logo doesn't blow past the ribbon. The
            // old `height: sLogoH` alone left short-and-wide logos
            // looking small.
            height: sLogoH,
            maxHeight: '100%',
            width: 'auto',
            maxWidth: vp.h * 5,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : null}
      {sp.name && !sp.logoUrl ? (
        // Only show the text when there's NO logo — when there IS a
        // logo, the name underneath duplicates the brand and steals
        // vertical space from the logo itself.
        <span
          style={{
            fontSize: sNameSize,
            fontWeight: 900,
            color: '#fff',
            whiteSpace: 'nowrap',
            letterSpacing: 1,
            lineHeight: 1,
          }}
        >
          {sp.name}
        </span>
      ) : null}
    </div>
  );
  const renderItem = (
    it: { t: 'media'; url: string } | { t: 'sponsor'; sp: Sponsor },
    key: string,
  ) => (it.t === 'media' ? renderMedia(it.url, key) : renderSponsor(it.sp, key));

  // Seamless scroll needs the strip to ALWAYS cover the ribbon AND to
  // translate by EXACTLY one sequence width so the loop never jumps.
  // Item widths are intrinsic (images / videos load async), so we MEASURE
  // one rendered sequence, lay enough copies to overhang the ribbon, and
  // bake the measured distance straight into the keyframe. The earlier
  // 2-copy / translateX(-50%) version exposed black as it scrolled
  // whenever the content was narrower than the ribbon — operator: "shows
  // the image then goes to black chunk by chunk." px-literal keyframe (no
  // CSS-var-in-keyframe) keeps it Chromium-83 / NovaStar-Taurus safe.
  const seqRef = useRef<HTMLDivElement>(null);
  const [seqW, setSeqW] = useState(0);
  useEffect(() => {
    const el = seqRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setSeqW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    measure();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } catch {
      /* very old WebView — fall back to the load listeners below */
    }
    const media = Array.from(el.querySelectorAll('img,video')) as HTMLElement[];
    media.forEach((m) => {
      m.addEventListener('load', measure);
      m.addEventListener('loadedmetadata', measure);
    });
    return () => {
      ro?.disconnect();
      media.forEach((m) => {
        m.removeEventListener('load', measure);
        m.removeEventListener('loadedmetadata', measure);
      });
    };
  }, [items.length, vp.h, vp.w]);

  // Enough copies that the strip overhangs the ribbon by ≥ one sequence,
  // so translating -1 sequence never exposes an edge. Capped so a very
  // narrow item on a very wide ribbon can't spawn hundreds of nodes.
  const copies = seqW > 0 ? Math.min(16, Math.max(2, Math.ceil(vp.w / seqW) + 2)) : 6;
  // 2026-05-27 — viewport-relative scroll rate so visual speed feels
  // identical across a small preview window (e.g. 800px) and a wide
  // deployed ribbon (3000px) at the same speed setting.
  //
  // Old: pxPerSec = 60 * speedMult — FIXED 60 px/s base. At Very-fast
  // (2.8×) = 168 px/s. On a 3000px ribbon that's ~18s to cross the
  // visible width; on an 800px preview that's ~4.8s. Same number,
  // wildly different visual feel. Operator: "very fast is still slow
  // on the test screen…match the sample on the screen".
  //
  // New: calibrate to TIME the content takes to cross the viewport.
  // At Normal (1×) the ribbon's full width crosses in ~7s. At
  // Very-fast (2.8×) that becomes ~2.5s — fast enough to read but
  // brisk. At Slow (0.45×) it's ~15.5s — calm. Both preview and
  // deployed ribbon now feel the same at the same speed setting.
  const NORMAL_CROSS_SEC = 7;
  const pxPerSec = (vp.w / NORMAL_CROSS_SEC) * speedMult;
  const marqueeSecs = Math.max(4, (seqW || vp.w) / pxPerSec);
  const animName = 'rbnMq';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: '#05070d',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`@keyframes ${animName}{from{transform:translateX(0)}to{transform:translateX(-${Math.round(seqW)}px)}}`}</style>

      {/* full-width media lane — scrolls across the WHOLE ribbon */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: vp.w,
          overflow: 'hidden',
        }}
      >
        {/* The strip = `copies` identical sequences laid end-to-end.
            singleVideo: NO translate — the clip is already animated, the
            tiled copies just fill the width. Everything else: marquee by
            exactly ONE measured sequence width, so the loop is seamless
            and the strip always overhangs the ribbon (no black gap). */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            // 2026-05-27 — strip + sequence MUST have definite height so
            // the img's `height: 100%` resolves. Without `height: 100%`,
            // `alignItems: 'center'` makes the sequence content-height,
            // and the img at `height: 100%` falls back to its natural
            // height (e.g. 98px on a 3840×98 banner) instead of filling
            // the 400px ribbon zone. Operator saw 4 tiny stacked banners
            // instead of one full-height marquee.
            height: '100%',
            width: 'max-content',
            display: 'flex',
            alignItems: 'stretch',
            animation:
              !singleVideo && seqW > 0
                ? `${animName} ${marqueeSecs.toFixed(1)}s linear infinite`
                : undefined,
          }}
        >
          {Array.from({ length: copies }, (_, c) => (
            <div
              key={c}
              ref={c === 0 ? seqRef : undefined}
              style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, height: '100%' }}
            >
              {items.map((it, i) => renderItem(it, `${c}-${i}`))}
            </div>
          ))}
        </div>
      </div>

      {/* pinned score badge — overlays the left of the run on TOP of the
          scrolling media; never scrolls, digits update in place. Its
          solid background occludes the media behind it so it stays
          readable over a busy scroll. 2026-05-27 — segment/clock toggles
          pass through from the Ribbon content panel. */}
      <ScoreZone
        data={data}
        def={def}
        left={0}
        w={scoreZoneW}
        h={vp.h}
        clockMs={clockMs}
        segmentOn={segmentOn}
        clockOn={clockOn}
      />
    </div>
  );
}

// ── score zone ─────────────────────────────────────────────────

/**
 * 2026-06-15 — the pinned-anchor shot clock. Shot-clock sports (basketball,
 * water polo, lacrosse, …) carry `def.shotClock`; the live value rides
 * `stats.shotClock = { ms, running, len?, at }`, populated by
 * applyCtsOverlay's CTS derivation (cts-merge.ts). The board's plain
 * fmtShotClock reads the snapshot int; here we project it FORWARD between the
 * 750ms polls so the digit counts down smoothly, the way a venue board does.
 *
 * Returns null for sports with no shot clock OR when it's parked/empty (so the
 * ribbon never shows a dead ":00" badge). `secs` drives the ≤5s red treatment.
 * Format: a sub-60 shot clock reads as bare seconds ("24", or "4.5" under 5s) —
 * the venue convention; we keep MM:SS only as a guard for an oversized `len`.
 */
function useRibbonShotClock(
  def: SportDefinition,
  data: BoardData,
): { text: string; secs: number } | null {
  const sc =
    def.shotClock && data.stats && typeof data.stats === 'object'
      ? ((data.stats as Record<string, unknown>).shotClock as
          | { ms?: number; running?: boolean; len?: number; at?: string }
          | undefined)
      : undefined;
  const anchorMs = sc ? Math.max(0, Number(sc.ms) || 0) : 0;
  const running = !!sc?.running;
  const at = sc?.at;
  const [ms, setMs] = useState(anchorMs);

  useEffect(() => {
    if (!sc) {
      setMs(0);
      return;
    }
    if (!running) {
      setMs(anchorMs);
      return;
    }
    const skew = data.serverTime - Date.now();
    const anchorAt = at ? new Date(at).getTime() : Date.now() + skew;
    const project = () => setMs(Math.max(0, anchorMs - (Date.now() + skew - anchorAt)));
    project();
    const t = setInterval(project, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc, running, anchorMs, at, data.serverTime]);

  if (!sc) return null;
  // Falls back to def.shotClock.full when `len` is missing (per the brief) —
  // lets us suppress a board that's only ever shown a 0-length parked clock.
  const len = Number(sc.len) || def.shotClock?.full || 0;
  if (len <= 0 && anchorMs <= 0) return null;
  const secs = ms / 1000;
  let text: string;
  if (ms >= 60000) {
    // Guard for an unusually long configured length — MM:SS.
    const total = Math.ceil(ms / 1000);
    text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  } else if (ms <= 0) {
    text = '0';
  } else if (ms <= 5000) {
    text = secs.toFixed(1); // sub-5s: tenths, like a real shot clock
  } else {
    text = String(Math.ceil(secs));
  }
  return { text, secs };
}

/**
 * The persistent scorebug — score, segment, clock — pinned to one end
 * of the ribbon. It never participates in the content rotation; the
 * digits just update in place as the game runs.
 */
function ScoreZone({
  data,
  def,
  left,
  w,
  h,
  clockMs,
  segmentOn = true,
  clockOn = true,
}: {
  data: BoardData;
  def: SportDefinition;
  left: number;
  w: number;
  h: number;
  clockMs: number;
  /** Operator toggles in `Ribbon content`. When false the segment/clock
   *  is suppressed from the score-anchor status line. Default true to
   *  keep every existing call site unchanged. */
  segmentOn?: boolean;
  clockOn?: boolean;
}) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  // Team-color text must stay legible on the near-black ribbon.
  const homeInk = readableInk(homeColor);
  const awayInk = readableInk(awayColor);
  const live = data.status === 'LIVE';
  // 2026-06-15 SCORE-POP — pop the digit on change (the bowl's "look up"
  // instant). First paint never pops (dir = null). Transform-only → Taurus-safe.
  const homeFlip = useScoreFlip(data.homeScore);
  const awayFlip = useScoreFlip(data.awayScore);
  // 2026-06-15 — shot clock in the pinned anchor (was rendered NOWHERE on the
  // ribbon). stats.shotClock is populated by applyCtsOverlay's CTS derivation.
  // We project it forward when running so it counts down between 750ms polls.
  const shotClock = useRibbonShotClock(def, data);
  const seg = segmentLabel(def, data);
  // 2026-05-27 — `clock` and `segment` are toggleable presets in
  // `Ribbon content`. We honor them here so flipping them OFF actually
  // removes the segment / clock from the ribbon's status line. Score
  // itself is non-negotiable (the ribbon must never go blank) so it
  // stays rendered regardless.
  const hasClock = def.clock.type !== 'none' && clockOn;
  const clk = fmtClock(clockMs, def.clock.type === 'countdown');
  let statusText: string;
  if (live) {
    if (segmentOn && hasClock) statusText = `${seg} · ${clk}`;
    else if (segmentOn) statusText = seg;
    else if (hasClock) statusText = clk;
    else statusText = '';
  } else if (data.status === 'FINAL') statusText = 'FINAL';
  else if (data.status === 'HALFTIME') statusText = 'HALFTIME';
  else if (data.status === 'PRE_GAME') statusText = 'PRE-GAME';
  else statusText = (data.status || 'SCHEDULED').replace(/_/g, ' ');

  // The score is the hero — size it off the zone HEIGHT, with a width
  // cap that widens with the score's digit count so a 3-digit
  // basketball score never overflows the zone. For judged sports the
  // DISPLAYED total carries decimals (gymnastics "195.825"), so size
  // off the formatted strings — not the raw scaled int.
  const homeScoreText = formatScore(def, data.homeScore);
  const awayScoreText = formatScore(def, data.awayScore);
  const digits = Math.max(1, homeScoreText.length, awayScoreText.length);
  const u = Math.min(h * 1.35, w / (1.02 + 0.51 * digits));
  const score = Math.round(u * 0.4);
  const logo = Math.round(u * 0.28);
  const dash = Math.round(u * 0.24);
  const gap = Math.round(u * 0.1);

  // The status line (team nicknames + segment / clock) is sized
  // SEPARATELY: `su` shrinks it to fit the zone width so a long
  // nickname never clips — rather than forcing the score smaller.
  const homeNick = teamNick(data.homeTeam);
  const awayNick = teamNick(data.awayTeam);
  const statusNeedU =
    (homeNick.length + awayNick.length) * 0.092 + statusText.length * 0.095 + 0.7;
  const su = Math.min(u, (w * 0.93) / statusNeedU);
  const code = Math.round(su * 0.14);
  const status = Math.round(su * 0.16);
  const dot = Math.round(su * 0.1);

  const mark = (url: string | null, color: string) =>
    url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={{ height: logo, width: logo, objectFit: 'contain' }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : (
      <span
        style={{
          width: Math.round(logo * 0.34),
          height: logo,
          background: color,
          borderRadius: 5,
          display: 'inline-block',
        }}
      />
    );

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: 0,
        bottom: 0,
        width: w,
        background: 'linear-gradient(180deg, #0c1322 0%, #070b14 100%)',
        borderRight: '2px solid rgba(255,255,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* score line */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {mark(data.homeLogoUrl, homeColor)}
        <span
          key={homeFlip.flipKey}
          style={{
            display: 'inline-block',
            fontSize: score,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(u * 0.06)}px 0 ${Math.round(u * 0.1)}px`,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            animation: homeFlip.dir ? SCORE_POP_ANIM : undefined,
          }}
        >
          {homeScoreText}
        </span>
        <span style={{ fontSize: dash, fontWeight: 800, color: '#475569' }}>–</span>
        <span
          key={awayFlip.flipKey}
          style={{
            display: 'inline-block',
            fontSize: score,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(u * 0.1)}px 0 ${Math.round(u * 0.06)}px`,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            animation: awayFlip.dir ? SCORE_POP_ANIM : undefined,
          }}
        >
          {awayScoreText}
        </span>
        {mark(data.awayLogoUrl, awayColor)}
      </div>

      {/* status line — team nicknames flank the segment / clock */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginTop: gap,
        }}
      >
        <span
          style={{
            fontSize: code,
            fontWeight: 900,
            letterSpacing: 1,
            color: homeInk,
            whiteSpace: 'nowrap',
          }}
        >
          {homeNick}
        </span>
        {live && (
          <span
            style={{
              width: dot,
              height: dot,
              borderRadius: 999,
              background: '#ef4444',
              margin: `0 ${Math.round(su * 0.07)}px`,
              display: 'inline-block',
              animation: 'rbnPulse 1.6s ease-in-out infinite',
            }}
          />
        )}
        <span
          style={{
            fontSize: status,
            fontWeight: 800,
            letterSpacing: 1,
            color: '#fbbf24',
            margin: `0 ${Math.round(su * (live ? 0.1 : 0.16))}px`,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {statusText}
        </span>
        {/* 2026-06-15 — pinned shot clock (shot-clock sports only, live only).
            Compact pill: an orange "SC" tag + the count; turns red ≤5s. */}
        {live && shotClock && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginRight: Math.round(su * (live ? 0.1 : 0.16)),
              padding: `${Math.round(status * 0.18)}px ${Math.round(status * 0.4)}px`,
              borderRadius: Math.round(status * 0.4),
              background: shotClock.secs <= 5 ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${
                shotClock.secs <= 5 ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.16)'
              }`,
              lineHeight: 1,
            }}
          >
            <span
              style={{
                fontSize: Math.round(status * 0.66),
                fontWeight: 900,
                letterSpacing: 1,
                color: shotClock.secs <= 5 ? '#fca5a5' : '#94a3b8',
                marginRight: Math.round(status * 0.28),
              }}
            >
              SC
            </span>
            <span
              style={{
                fontSize: status,
                fontWeight: 900,
                color: shotClock.secs <= 5 ? '#ef4444' : '#fff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {shotClock.text}
            </span>
          </span>
        )}
        <span
          style={{
            fontSize: code,
            fontWeight: 900,
            letterSpacing: 1,
            color: awayInk,
            whiteSpace: 'nowrap',
          }}
        >
          {awayNick}
        </span>
      </div>
    </div>
  );
}

// ── content zone ───────────────────────────────────────────────

/**
 * The rotating playlist host. Every look is rendered, stacked; only
 * the active index is opaque. Advancing the index crossfades — a
 * fast, clean transition, never a slow constant scroll.
 */
function ContentZone({
  looks,
  idx,
  left,
  w,
  h,
  data,
  def,
}: {
  looks: Look[];
  idx: number;
  left: number;
  w: number;
  h: number;
  data: BoardData;
  def: SportDefinition;
}) {
  return (
    <div style={{ position: 'absolute', left, top: 0, bottom: 0, width: w, overflow: 'hidden' }}>
      {looks.map((look, i) => (
        <div
          key={look.id}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: i === idx ? 1 : 0,
            transition: 'opacity 420ms ease-in-out',
          }}
        >
          <LookView look={look} w={w} h={h} data={data} def={def} />
        </div>
      ))}
    </div>
  );
}

/**
 * One look, rendered in the content zone.
 *
 * Most looks tile across the ribbon width so fans at every seat see
 * them (Daktronics "tile the content" model). The SPONSOR look is the
 * one exception: it scrolls as a seamless horizontal marquee — sponsor
 * logo + name repeated and translateX-animated 0 → -50% so the loop
 * has no seam. All other looks remain held-static.
 */
function LookView({
  look,
  w,
  h,
  data,
  def,
}: {
  look: Look;
  w: number;
  h: number;
  data: BoardData;
  def: SportDefinition;
}) {
  // ── Sponsor look — seamless horizontal marquee ────────────────
  // Duplicate the strip so the second copy begins exactly where the
  // first ends; animating the wrapper -50% produces a perfect loop.
  if (look.kind === 'sponsor') {
    const sp = look.sponsor;
    const color = sp.color || '#6366f1';
    const cu = Math.min(h * 0.9, 540);
    // One sponsor card: logo + name + tagline — same visuals as the
    // static version but wider so it reads as a scrolling banner.
    const cardW = Math.round(cu * 3.2);
    const SponsorCard = () => (
      <div
        style={{
          width: cardW,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {sp.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sp.logoUrl}
            alt=""
            style={{
              height: cu * 0.66,
              width: cu * 1.7,
              objectFit: 'contain',
              marginRight: cu * 0.22,
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: cu * 0.15, fontWeight: 800, letterSpacing: 3, color }}>
            PROUD SPONSOR
          </span>
          <span style={{ fontSize: cu * 0.34, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap' }}>
            {sp.name}
          </span>
          {sp.tagline ? (
            <span
              style={{ fontSize: cu * 0.16, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}
            >
              {sp.tagline}
            </span>
          ) : null}
        </div>
      </div>
    );
    // Fill the strip with copies to cover 2× the content width. The
    // count MUST be even — the loop translates the strip exactly -50%
    // (= copies/2 cards), so an odd count lands the loop point mid-card
    // and the marquee visibly jumps every cycle. Round up to even.
    const rawCopies = Math.max(2, Math.ceil((w * 2) / Math.max(1, cardW)));
    const copies = rawCopies % 2 === 0 ? rawCopies : rawCopies + 1;
    // item E1 (2026-06-16) — the operator's Slow/Normal/Fast/Very-fast control
    // (data.ribbonSpeed) was IGNORED here: scrollSecs used a hardcoded /120, so
    // the sponsor-marquee crawl never changed speed (the main ticker already
    // honored it). Scale the whole duration by 1/speedMult so a higher speed →
    // shorter duration → faster crawl, and the floor scales too. Geometry
    // (copies / -50% loop point) is untouched, so the seamless loop is intact.
    const speedMult = ribbonSpeedMultiplier(data.ribbonSpeed) || 1;
    const scrollSecs = Math.max(8, (cardW * copies) / 120) / speedMult;
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          overflow: 'hidden',
        }}
      >
        {/* the scrolling strip: 2× wide, translateX loops 0→-50% */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: cardW * copies,
            display: 'flex',
            alignItems: 'center',
            animation: `rbnMarquee ${scrollSecs.toFixed(1)}s linear infinite`,
          }}
        >
          {Array.from({ length: copies }, (_, i) => (
            <SponsorCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ── All other looks — static tiled copies ─────────────────────
  // A prompt is the operator's headline — ONE copy, scaled to fill
  // the ribbon (sized in LookUnit), never tiled small.
  const unit =
    look.kind === 'slide' || look.kind === 'prompt'
      ? w
      : look.kind === 'spotlight'
        ? // 2026-05-27 — spotlight is wider than a roster player so the
          // optional stat-lines cluster has room to breathe. Wider
          // unit + fewer copies = one prominent featured-player card.
          Math.min(w, h * 8)
        : look.kind === 'player' || look.kind === 'situational'
          ? Math.min(w, h * 6)
          : Math.min(w, h * 4.4); // final / pregame
  const copies = Math.max(1, Math.round(w / Math.max(1, unit)));

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
      }}
    >
      {Array.from({ length: copies }, (_, i) => (
        <LookUnit key={i} look={look} h={h} w={w} data={data} def={def} />
      ))}
    </div>
  );
}

/** A single instance of a look — sized off the ribbon height. */
function LookUnit({
  look,
  h,
  w,
  data,
  def,
}: {
  look: Look;
  h: number;
  w: number;
  data: BoardData;
  def: SportDefinition;
}) {
  // a capped design height so text stays sane on a tall test window
  const cu = Math.min(h * 0.9, 540);
  const onImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    (e.currentTarget as HTMLImageElement).style.display = 'none';
  };

  if (look.kind === 'slide') {
    // A full-bleed image. 2026-05-26 — same bug as the sponsor render
    // had: `max-width/max-height` only CAPS the image, doesn't scale
    // small intrinsic uploads UP to fill. Operator uploads a 400×100
    // banner; previously rendered at 400×100 in a 1920×250 ribbon
    // zone leaving most of the zone empty. Fix: `width:100%;
    // height:100%; objectFit:contain` so the IMG element fills the
    // ribbon AND the image inside scales to fit while preserving
    // aspect ratio. Small banners now go big, wide banners breathe
    // the full zone width, never distorted.
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={look.url}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
          onError={onImgError}
        />
      </div>
    );
  }

  if (look.kind === 'prompt') {
    // Scale the headline to FILL the ribbon — as large as fits the
    // height and the content width, so a short message ("DEFENSE!")
    // goes huge and a long one still reads end-to-end without clipping.
    const len = Math.max(1, look.text.length);
    const f = Math.min(h, (w * 0.94) / (1.08 + 0.66 * len));
    return (
      <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span
          style={{
            color: '#fbbf24',
            fontSize: f * 0.78,
            fontWeight: 900,
            lineHeight: 1,
            marginRight: f * 0.14,
          }}
        >
          ‹
        </span>
        <span
          style={{
            fontSize: f,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: f * 0.04,
            color: '#fff',
          }}
        >
          {look.text}
        </span>
        <span
          style={{
            color: '#fbbf24',
            fontSize: f * 0.78,
            fontWeight: 900,
            lineHeight: 1,
            marginLeft: f * 0.14,
          }}
        >
          ›
        </span>
      </div>
    );
  }

  if (look.kind === 'situational') {
    // Split on digit runs so NUMBERS render in a bright accent and pop
    // out of the label text (e.g. "HOME SHOTS 12" — the 12 reads as a
    // distinct figure).
    const effStats = effectiveStatsWithPossession((data.stats || {}) as Record<string, unknown>, (data as any).possession);
    const sit = ribbonSituational(def, effStats) || '';
    const parts = sit.split(/(\d+)/);
    // 2026-06-15 — lead with a vector glyph (serve/possession/sport mark)
    // tinted to the situational accent, replacing emoji iconography.
    const glyph = ribbonSituationalGlyph(def, effStats, cu * 0.42, '#38bdf8');
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          fontSize: cu * 0.34,
          fontWeight: 900,
          letterSpacing: 2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {glyph ? <span style={{ display: 'inline-flex', marginRight: cu * 0.16 }}>{glyph}</span> : null}
        <span>
          {parts.map((part, i) => (
            <span key={i} style={{ color: /^\d+$/.test(part) ? '#fde047' : '#38bdf8' }}>
              {part}
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (look.kind === 'player') {
    const p = look.player;
    const homeColor = data.homeColor || DEFAULT_HOME;
    const awayColor = data.awayColor || DEFAULT_AWAY;
    const color = p.team === 'away' ? awayColor : homeColor;
    const statKeys = Object.keys(p.stats || {});
    const topStat = statKeys[0] ? `${statKeys[0]} ${p.stats[statKeys[0]]}` : null;
    const initials = p.name
      .trim()
      .split(/\s+/)
      .map((x) => x[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    const eyebrow =
      [p.number ? `#${p.number}` : null, p.position].filter(Boolean).join(' · ').toUpperCase() ||
      'PLAYER';
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.photoUrl}
            alt=""
            style={{
              height: cu * 0.74,
              width: cu * 0.74,
              borderRadius: 999,
              objectFit: 'cover',
              border: `${Math.max(2, Math.round(cu * 0.03))}px solid ${color}`,
              marginRight: cu * 0.2,
            }}
            onError={onImgError}
          />
        ) : (
          <div
            style={{
              height: cu * 0.74,
              width: cu * 0.74,
              borderRadius: 999,
              background: color,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: cu * 0.3,
              fontWeight: 900,
              marginRight: cu * 0.2,
            }}
          >
            {initials || '—'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: cu * 0.15, fontWeight: 800, letterSpacing: 3, color }}>
            {eyebrow}
          </span>
          <span
            style={{ fontSize: cu * 0.34, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap' }}
          >
            {p.name}
          </span>
          {topStat ? (
            <span
              style={{
                fontSize: cu * 0.17,
                fontWeight: 700,
                color: '#94a3b8',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {topStat}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // 2026-05-27 — SPOTLIGHT look. Same operator-curated featured-player
  // object the scoreboard's <SpotlightBand> renders, ported to ribbon
  // proportions. Hero photo on the left at ~ribbon-height, title +
  // subtitle stack to its right, optional stat lines (operator-set
  // label/value pairs) as a horizontal cluster. Always shows when
  // visible, regardless of `roster` preset toggle — the operator
  // pressed Spotlight, so it shows.
  if (look.kind === 'spotlight') {
    const homeColor = data.homeColor || DEFAULT_HOME;
    const initials = (look.title || '')
      .trim()
      .split(/\s+/)
      .map((x) => x[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {look.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={look.photoUrl}
            alt=""
            style={{
              height: cu * 0.86,
              width: cu * 0.86,
              borderRadius: 999,
              objectFit: 'cover',
              border: `${Math.max(3, Math.round(cu * 0.04))}px solid #fbbf24`,
              marginRight: cu * 0.22,
              boxShadow: '0 0 0 3px rgba(251, 191, 36, 0.25)',
            }}
            onError={onImgError}
          />
        ) : (
          <div
            style={{
              height: cu * 0.86,
              width: cu * 0.86,
              borderRadius: 999,
              background: homeColor,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: cu * 0.34,
              fontWeight: 900,
              marginRight: cu * 0.22,
              border: `${Math.max(3, Math.round(cu * 0.04))}px solid #fbbf24`,
            }}
          >
            {initials || '★'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* 2026-05-27 — Dropped the "SPOTLIGHT" eyebrow label per
              operator: "dont say the work spotlight when we spotlight
              someone". The player's photo + name speak for themselves. */}
          <span
            style={{
              fontSize: cu * 0.38,
              fontWeight: 900,
              color: '#fff',
              whiteSpace: 'nowrap',
              lineHeight: 1.05,
            }}
          >
            {look.title}
          </span>
          {look.subtitle ? (
            <span
              style={{
                fontSize: cu * 0.17,
                fontWeight: 700,
                color: '#cbd5e1',
                whiteSpace: 'nowrap',
              }}
            >
              {look.subtitle}
            </span>
          ) : null}
          {look.lines && look.lines.length ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginTop: cu * 0.04,
                whiteSpace: 'nowrap',
              }}
            >
              {look.lines.slice(0, 4).map((ln, i) => (
                <span
                  key={i}
                  style={{
                    marginRight: i < look.lines!.length - 1 ? cu * 0.22 : 0,
                    fontSize: cu * 0.15,
                    fontWeight: 700,
                    color: '#94a3b8',
                    letterSpacing: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span style={{ color: '#94a3b8', marginRight: cu * 0.06 }}>{ln.label}</span>
                  <span style={{ color: '#fff', fontWeight: 900, fontSize: cu * 0.2 }}>
                    {ln.value}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // FINAL look — emphasis: "FINAL" word + the two scores so fans know
  // the result at a glance from anywhere in the venue. Style follows the
  // prompt/situational look: same font weight, ribbon-height sizing,
  // accent gold on the result label, team colors on the scores.
  if (look.kind === 'final') {
    const homeColor = data.homeColor || DEFAULT_HOME;
    const awayColor = data.awayColor || DEFAULT_AWAY;
    const homeWon = data.homeScore > data.awayScore;
    const awayWon = data.awayScore > data.homeScore;
    return (
      <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontSize: cu * 0.28,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#fbbf24',
            marginRight: cu * 0.18,
          }}
        >
          FINAL
        </span>
        <span
          style={{
            fontSize: cu * 0.42,
            fontWeight: 900,
            color: homeWon ? homeColor : '#fff',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {teamNick(data.homeTeam)}
        </span>
        <span
          style={{
            fontSize: cu * 0.42,
            fontWeight: 900,
            color: homeWon ? homeColor : '#cbd5e1',
            fontVariantNumeric: 'tabular-nums',
            marginLeft: cu * 0.12,
          }}
        >
          {formatScore(def, data.homeScore)}
        </span>
        <span
          style={{
            fontSize: cu * 0.28,
            fontWeight: 800,
            color: '#475569',
            marginLeft: cu * 0.1,
            marginRight: cu * 0.1,
          }}
        >
          –
        </span>
        <span
          style={{
            fontSize: cu * 0.42,
            fontWeight: 900,
            color: awayWon ? awayColor : '#cbd5e1',
            fontVariantNumeric: 'tabular-nums',
            marginRight: cu * 0.12,
          }}
        >
          {formatScore(def, data.awayScore)}
        </span>
        <span
          style={{
            fontSize: cu * 0.42,
            fontWeight: 900,
            color: awayWon ? awayColor : '#fff',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {teamNick(data.awayTeam)}
        </span>
      </div>
    );
  }

  // PRE_GAME / SCHEDULED look — matchup framing: "HOME vs AWAY" +
  // "WELCOME" eyebrow. Style: same font scale as prompt; accent gold
  // eyebrow, white team names, team colors on the team codes.
  if (look.kind === 'pregame') {
    const homeColor = data.homeColor || DEFAULT_HOME;
    const awayColor = data.awayColor || DEFAULT_AWAY;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontSize: cu * 0.18,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#fbbf24',
            marginBottom: cu * 0.06,
          }}
        >
          WELCOME
        </span>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              fontSize: cu * 0.38,
              fontWeight: 900,
              color: homeColor,
              letterSpacing: 2,
            }}
          >
            {teamNick(data.homeTeam)}
          </span>
          <span
            style={{
              fontSize: cu * 0.22,
              fontWeight: 800,
              color: '#475569',
              marginLeft: cu * 0.12,
              marginRight: cu * 0.12,
            }}
          >
            VS
          </span>
          <span
            style={{
              fontSize: cu * 0.38,
              fontWeight: 900,
              color: awayColor,
              letterSpacing: 2,
            }}
          >
            {teamNick(data.awayTeam)}
          </span>
        </div>
      </div>
    );
  }

  // sponsor
  const sp = look.sponsor;
  const color = sp.color || '#6366f1';
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {sp.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        // FIXED-size box, objectFit:contain, no backdrop — a logo
        // shows full and uncropped on the dark ribbon.
        <img
          src={sp.logoUrl}
          alt=""
          style={{
            height: cu * 0.66,
            width: cu * 1.7,
            objectFit: 'contain',
            marginRight: cu * 0.22,
          }}
          onError={onImgError}
        />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: cu * 0.15, fontWeight: 800, letterSpacing: 3, color }}>
          PROUD SPONSOR
        </span>
        <span style={{ fontSize: cu * 0.34, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap' }}>
          {sp.name}
        </span>
        {sp.tagline ? (
          <span
            style={{ fontSize: cu * 0.16, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}
          >
            {sp.tagline}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── celebration cue overlay ────────────────────────────────────

/**
 * A fired cue takes over the whole ribbon for its hold window. On a
 * continuous full-bowl wrap the celebration is tiled once per score
 * anchor — a single burst centred on a 45-ft ribbon would be invisible
 * from the bowl's far seats. The dark scrim is one full-ribbon layer;
 * the burst (glow / rings / sweep / label) repeats per anchor, in
 * lock-step.
 *
 * Chromium-83 safe (NovaStar Taurus): long-hand insets, per-child
 * margin (no flex `gap`), animation is transform / opacity only.
 */
// 2026-05-27 — Map a fired cue + sport context to a ribbon-native
// celebration-strip config. The strip is a horizontal layout designed
// for the 7.5:1 ribbon shape (left motif | center title + scorer |
// right scoreline) — see RibbonCelebrationStrip.tsx for the why.
//
// Returns null only if the cue is so empty it's not worth showing
// anything (the caller falls back to CueBurst in that case).
function buildRibbonStripConfig(
  cue: Cue,
  sport: string | undefined,
): import('@/components/widgets/sports/celebrations/RibbonCelebrationStrip').RibbonCelebrationStripConfig | null {
  const key = (cue.key || '').toLowerCase();
  const snap = cue.snapshot;
  // Normalize the sport key the same way pickCinematic does so
  // water_polo / water-polo / water polo all hit the same branch.
  const sportNorm = (sport || '').toLowerCase().replace(/[-_\s]/g, '');
  const scorerName = ((cue as any)?.scorerName as string | undefined)?.trim() || undefined;
  const scorerNumber = ((cue as any)?.scorerNumber as string | undefined)?.trim() || undefined;
  const accent = cue.color || snap?.homeColor || '#21e6ff';

  // Per-cue title + subtitle defaults — fallback to cue.label when
  // we don't have a sport-specific mapping. Title is uppercase; the
  // strip uppercases anyway but explicit caps keeps the source
  // readable.
  let title = (cue.label || cue.key || 'Cue').toUpperCase();
  let subtitle: string | undefined;

  if (key === 'goal') {
    title = sportNorm === 'waterpolo' ? 'GOAL!' :
            sportNorm === 'hockey'    ? 'GOAL!' :
            sportNorm === 'lacrosse'  ? 'GOAL!' :
                                        'GOOOOAL!';
  } else if (key === 'save') {
    title = 'SAVE!';
    if (!scorerName) subtitle = 'NO GOAL';
  } else if (key === 'exclusion' || key === 'penalty') {
    title = key === 'penalty' ? 'PENALTY' : 'EXCLUSION';
    if (!scorerName) subtitle = '20-SECOND PENALTY';
  } else if (key === 'powerplay' || key === 'power-play' || key === 'power_play') {
    title = 'POWER PLAY';
    if (!scorerName) subtitle = 'MAN ADVANTAGE';
  } else if (key === 'touchdown' || key === 'td') {
    title = 'TOUCHDOWN!';
    if (!scorerName) subtitle = '+7';
  } else if (key === 'fieldgoal' || key === 'field-goal' || key === 'fg') {
    title = 'FIELD GOAL';
    if (!scorerName) subtitle = '+3';
  } else if (key === 'threepointer' || key === 'three-pointer' || key === 'three') {
    title = 'THREE!';
  } else if (key === 'dunk') {
    title = 'DUNK!';
  } else if (key === 'homerun' || key === 'home-run' || key === 'hr') {
    title = 'HOME RUN!';
  } else if (key === 'ace') {
    title = 'ACE!';
  } else if (key === 'kill') {
    title = 'KILL!';
  } else if (key === 'pin') {
    title = 'PIN!';
  } else if (key === 'status:halftime') {
    title = 'HALFTIME';
    subtitle = 'BREAK · REST UP';
  } else if (key === 'status:final-home') {
    title = 'FINAL';
    subtitle = `${snap?.homeTeam ?? 'HOME'} WINS`;
  } else if (key === 'status:final-away') {
    title = 'FINAL';
    subtitle = `${snap?.awayTeam ?? 'AWAY'} WINS`;
  } else if (key === 'status:final-tie') {
    title = 'FINAL';
    subtitle = 'TIED · GAME OVER';
  } else if (key === 'horn') {
    // segmentLabel lives at top-level of the CUE payload (not in snapshot)
    // because the horn fires at clock-expiry before the segment rolls.
    const hornLabel = ((cue as any)?.segmentLabel as string | undefined)?.trim().toUpperCase() ?? '';
    const segEnd    = hornLabel ? (hornLabel.endsWith('END') ? hornLabel : `${hornLabel} END`) : 'PERIOD OVER';
    title    = 'HORN';
    subtitle = segEnd;
  }

  return {
    title,
    subtitle,
    accent,
    scorerName,
    scorerNumber,
    homeName: snap?.homeTeam,
    awayName: snap?.awayTeam,
    homeScore: snap?.homeScore,
    awayScore: snap?.awayScore,
    segmentLabel: snap?.segmentLabel,
    clockText: snap?.clockText,
    team: cue.team ?? null,
  };
}

// 2026-05-26 — sport-celebration key → cinematic CEL_* component
// mapping. Replaces the procedural <CueBurst> (emoji + slammed label
// + glow rings) with a real cinematic scene from the celebrations
// library so the operator's existing GOAL / Save / Exclusion / Power
// Play buttons fire the new look on every ribbon, no template-picker
// dance required.
//
// 2026-05-27 — DEPRECATED for ribbon use. The ribbon page now routes
// every cue through buildRibbonStripConfig() + RibbonCelebrationStrip
// (above) — 16:9 cinematics didn't fit 7.5:1 slices and were clipping
// the top of the goal frame. pickCinematic stays in the source for
// (a) reference, (b) the /board/[gameId] route which IS 16:9 and
// keeps using the cinematics. If no one references it after the
// next ship, delete it.
//
// `sport` from the BoardData tells us which sport's celebrations
// pool to draw from when a key like 'goal' is ambiguous (soccer
// goal vs hockey goal vs lacrosse goal — all visually distinct).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function pickCinematic(
  cue: Cue,
  sport: string | undefined,
): { Component: ComponentType<any>; defaults: Record<string, unknown> } | null {
  const key = (cue.key || '').toLowerCase();
  const snap = cue.snapshot;
  const homeScore = snap?.homeScore ?? 0;
  const awayScore = snap?.awayScore ?? 0;
  const score = `${homeScore}-${awayScore}`;
  const team = cue.team || null;

  // Common props every cinematic accepts. The Cel*Widget shapes vary
  // (scorer / player / pitcher / kicker etc.) but every one of them
  // tolerates extra fields gracefully — pass them all, the widget
  // reads what it needs.
  const common: Record<string, unknown> = {
    score,
    team,
    homeColor: cue.color || '#3b82f6',
    awayColor: '#ef4444',
    sponsorName: cue.sponsorName ?? undefined,
    sponsorLogoUrl: cue.sponsorLogoUrl ?? undefined,
  };

  // 2026-05-27 — normalize the sport key. Canonical is `water_polo`
  // (UNDERSCORE — confirmed via packages/api-types/src/sports.ts) but
  // earlier code only matched hyphens. Bug found by querying the live
  // DB: operator's game.sport was `water_polo`, my goal handler
  // checked `water-polo`, fell through to the soccer GOOOOAL widget.
  // Same pattern for field_hockey / track_and_field / swimming_diving
  // / cross_country / competitive_cheer. The normalizer collapses
  // every separator so the check works on any form the operator
  // (or any API caller) might use.
  const sportNorm = (sport || '').toLowerCase().replace(/[-_\s]/g, '');

  // ─── Goal-class keys → dedicated marquee v1 cinematics ─────────
  // The "goal" cue is the hero event for every sport, so each gets
  // its own bespoke Canvas2D scene (waterpolo: floating FINA goal +
  // yellow ball + splash + ripples + shockwave). Currently only
  // water polo is ported; others use the deck or v2 CSS fallbacks
  // until their v1 marquee scenes get the same React port.
  if (key === 'goal') {
    // 2026-05-27 — scorer attribution off the cue payload. Operator's
    // Run-mode console attaches this from the currently-spotlit
    // player when firing the cue, so the cinematic can show "SCORED
    // BY #12 SMITH" as a hero line.
    const wScorerName = ((cue as any)?.scorerName as string | undefined)?.trim();
    const wScorerNumber = ((cue as any)?.scorerNumber as string | undefined)?.trim();
    if (sportNorm === 'waterpolo') {
      return {
        Component: CelebrationWaterPoloGoal as any,
        defaults: {
          team: cue.color || '#21e6ff',
          homeName: snap?.homeTeam || 'HOME',
          awayName: snap?.awayTeam || 'AWAY',
          homeScore,
          awayScore,
          segmentLabel: snap?.segmentLabel || '',
          scorerName: wScorerName,
          scorerNumber: wScorerNumber,
        },
      };
    }
    if (sportNorm === 'hockey')   return { Component: CelHockeyGoalWidget,  defaults: { ...common, scorer: 'GOAL', assists: [] } };
    if (sportNorm === 'lacrosse') return { Component: LxGoalWidget,         defaults: { ...common, scorer: 'GOAL', number: '' } };
    // Soccer / field hockey / handball — soccer GOOOOAL scene.
    return { Component: CelSoccerGoalWidget, defaults: { ...common, scorer: 'GOAL', minute: '' } };
  }

  // ─── Deck cue lookup — 28 registered cues across every sport ───
  // SAVE / EXCLUSION / POWER PLAY / SACK / DUNK / PIN / etc. all
  // route through the shared CelebrationDeckScene engine using the
  // celebrationDeckCues registry. The pickDeckCue helper does sport-
  // aware resolution: 'save' + sport='water-polo' → waterpolo-save.
  // Live game state (team name, score) injects into the cue's
  // sub1/sub2 lower-third copy so the scene shows REAL scores.
  const liveSub1 = (() => {
    if (snap?.homeTeam && snap?.awayTeam) {
      return `${snap.homeTeam.toUpperCase()}  ${homeScore}  —  ${awayScore}  ${snap.awayTeam.toUpperCase()}`;
    }
    return undefined;
  })();
  // 2026-05-27 — Operator-attributed scorer overrides sub2 so the
  // cinematic shows "SCORED BY #12 SMITH" instead of the generic
  // sport-segment text. Read off the cue payload (the operator's
  // Run console attaches these from the currently-spotlit player).
  const scorerName = ((cue as any)?.scorerName as string | undefined)?.trim();
  const scorerNumber = ((cue as any)?.scorerNumber as string | undefined)?.trim();
  const scorerLine = scorerName
    ? `SCORED BY  ${scorerNumber ? `#${scorerNumber}  ` : ''}${scorerName.toUpperCase()}`
    : undefined;
  const overrides: Record<string, unknown> = {};
  if (liveSub1) overrides.sub1 = liveSub1;
  if (scorerLine) overrides.sub2 = scorerLine;
  const deckCue = pickDeckCue(key, sport, Object.keys(overrides).length ? overrides : undefined);
  if (deckCue) {
    return {
      Component: CelebrationDeckScene as any,
      defaults: { cfg: deckCue, team: cue.color || '#21e6ff' },
    };
  }
  if (key === 'hattrick' || key === 'hat-trick') {
    if (sport === 'hockey') return { Component: CelHockeyHatTrickWidget, defaults: { ...common, player: 'HAT TRICK' } };
    return { Component: CelSoccerHatTrickWidget, defaults: { ...common, player: 'HAT TRICK', goals: [] } };
  }
  if (key === 'golazo')      return { Component: CelSoccerGolazoWidget,    defaults: { ...common, player: 'GOLAZO', kind: '' } };
  if (key === 'freekick' || key === 'free-kick') return { Component: CelSoccerFreeKickWidget, defaults: { ...common, player: 'FREE KICK', distance: '' } };
  if (key === 'powerplay' || key === 'power-play') return { Component: CelHockeyPowerPlayWidget, defaults: { ...common, scorer: 'POWER PLAY', strength: team === 'home' ? '6-on-5' : '5-on-6' } };
  if (key === 'shorty' || key === 'shorthanded') return { Component: CelHockeyShortyWidget, defaults: { ...common, scorer: 'SHORTHANDED', strength: '4-on-5' } };
  if (key === 'emptynet' || key === 'empty-net') return { Component: CelHockeyEmptyNetWidget, defaults: { ...common, scorer: 'EMPTY NET', finalScore: score } };
  if (key === 'save') return { Component: CelHockeyBigSaveWidget, defaults: { ...common, goalie: 'SAVE', saves: 0 } };
  if (key === 'exclusion' || key === 'redcard' || key === 'red-card') return { Component: CelSoccerRedCardWidget, defaults: { ...common, player: 'EXCLUSION', number: '', reason: '' } };

  // ─── Football ──────────────────────────────────────────────────
  if (key === 'touchdown')   return { Component: CelFootballTouchdownWidget,  defaults: { ...common, player: 'TOUCHDOWN', distance: '' } };
  if (key === 'fieldgoal' || key === 'field-goal') return { Component: CelFootballFieldGoalWidget, defaults: { ...common, kicker: 'FIELD GOAL', distance: '' } };
  if (key === 'picksix' || key === 'pick-six') return { Component: CelFootballPickSixWidget, defaults: { ...common, player: 'PICK SIX', distance: '' } };
  if (key === 'sack')        return { Component: CelFootballSackWidget,       defaults: { ...common, player: 'SACK', sacks: 0 } };
  if (key === 'interception' || key === 'int') return { Component: CelFootballInterceptionWidget, defaults: { ...common, player: 'INTERCEPTION', count: 0 } };
  if (key === 'safety')      return { Component: CelFootballSafetyWidget,     defaults: { ...common } };

  // ─── Basketball ────────────────────────────────────────────────
  if (key === 'threepointer' || key === 'three-pointer' || key === 'three') return { Component: CelBasketballThreeWidget, defaults: { ...common, player: 'THREE', threesTonight: 1 } };
  if (key === 'dunk')        return { Component: CelBasketballDunkWidget,    defaults: { ...common, player: 'SLAM', kind: 'DUNK' } };
  if (key === 'buzzerbeater' || key === 'buzzer-beater' || key === 'buzzer') return { Component: CelBasketballBuzzerWidget, defaults: { ...common, player: 'BUZZER BEATER', clock: '0.0', kind: 'GAME WINNER' } };
  if (key === 'block')       return { Component: CelBasketballBlockWidget,   defaults: { ...common, player: 'BLOCK', blocksTonight: 1 } };
  if (key === 'steal')       return { Component: CelBasketballStealWidget,   defaults: { ...common, player: 'STEAL', stealsTonight: 1 } };

  // ─── Baseball / softball ───────────────────────────────────────
  if (key === 'homerun' || key === 'home-run' || key === 'hr') return { Component: CelBaseballHomeRunWidget, defaults: { ...common, player: 'HOME RUN', distance: '', exitVelo: '' } };
  if (key === 'grandslam' || key === 'grand-slam') return { Component: CelBaseballGrandSlamWidget, defaults: { ...common, player: 'GRAND SLAM' } };
  if (key === 'strikeout' || key === 'k')         return { Component: CelBaseballStrikeoutWidget,  defaults: { ...common, pitcher: 'STRIKEOUT', kCount: 1 } };
  if (key === 'walkoff' || key === 'walk-off')    return { Component: CelBaseballWalkOffWidget,    defaults: { ...common, teamName: '', hero: '', finalScore: score, innings: 9 } };
  if (key === 'stolenbase' || key === 'stolen-base' || key === 'sb') return { Component: CelBaseballStolenBaseWidget, defaults: { ...common, runner: 'STOLEN BASE', base: '2ND', seasonSb: 1 } };

  // ─── Tennis / pickleball ───────────────────────────────────────
  if (key === 'ace')         return { Component: TnAceWidget, defaults: { ...common, player: 'ACE', speed: '', aces: 1 } };

  // No mapping — let the caller fall back to the procedural CueBurst
  // so unknown / custom keys still SHOW something instead of going
  // blank. (Audit-log entry is still written either way.)
  return null;
}

// ── spotlight overlay ──────────────────────────────────────────
//
// 2026-05-27 — Operator pushes a featured player to Game.spotlight
// (same single button that lights the scoreboard's SpotlightBand);
// this layer renders the same featured-player card on the ribbon
// as an always-on overlay above the marquee. Sits BELOW the cue
// overlay (z-index 50 vs cue's 60) so a celebration takes
// precedence; reappears when the cue ends. Auto-hides the moment
// the operator clears the spotlight on the next 750ms poll.
function SpotlightOverlay({
  spotlight,
  h,
  w,
  homeColor,
}: {
  spotlight: {
    title?: string;
    subtitle?: string;
    photoUrl?: string | null;
    lines?: { label: string; value: string }[];
  };
  h: number;
  w: number;
  homeColor: string;
}) {
  // Card sits in the right ~70% of the ribbon, leaving the pinned
  // scorebug visible on the left. Same proportions as the looks
  // rendering — hero photo + name + subtitle + stat lines.
  const cardH = h;
  const padL = Math.round(Math.min(w * 0.34, h * 4.4));
  const cu = Math.min(cardH * 0.9, 540);
  const initials = (spotlight.title || '')
    .trim()
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: padL,
        overflow: 'hidden',
        zIndex: 50,
        background: 'rgba(5,7,13,0.92)',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${Math.round(cardH * 0.2)}px`,
        animation: 'rbnFade 0.4s ease-out',
      }}
    >
      {spotlight.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spotlight.photoUrl}
          alt=""
          style={{
            height: cu * 0.86,
            width: cu * 0.86,
            borderRadius: 999,
            objectFit: 'cover',
            border: `${Math.max(3, Math.round(cu * 0.04))}px solid #fbbf24`,
            marginRight: cu * 0.22,
            boxShadow: '0 0 0 3px rgba(251, 191, 36, 0.25)',
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          style={{
            height: cu * 0.86,
            width: cu * 0.86,
            borderRadius: 999,
            background: homeColor,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: cu * 0.34,
            fontWeight: 900,
            marginRight: cu * 0.22,
            border: `${Math.max(3, Math.round(cu * 0.04))}px solid #fbbf24`,
            flexShrink: 0,
          }}
        >
          {initials || '★'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        {/* 2026-05-27 — Dropped the "SPOTLIGHT" eyebrow label. Operator:
            "dont say the work spotlight when we spotlight someone".
            The player's photo + name + subtitle + stat lines speak
            for themselves; no need to caption it. */}
        <span
          style={{
            fontSize: cu * 0.38,
            fontWeight: 900,
            color: '#fff',
            whiteSpace: 'nowrap',
            lineHeight: 1.05,
          }}
        >
          {spotlight.title}
        </span>
        {spotlight.subtitle ? (
          <span
            style={{
              fontSize: cu * 0.17,
              fontWeight: 700,
              color: '#cbd5e1',
              whiteSpace: 'nowrap',
            }}
          >
            {spotlight.subtitle}
          </span>
        ) : null}
        {spotlight.lines && spotlight.lines.length ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: cu * 0.04,
              whiteSpace: 'nowrap',
            }}
          >
            {spotlight.lines.slice(0, 4).map((ln, i) => (
              <span
                key={i}
                style={{
                  marginRight: i < spotlight.lines!.length - 1 ? cu * 0.22 : 0,
                  fontSize: cu * 0.15,
                  fontWeight: 700,
                  color: '#94a3b8',
                  letterSpacing: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ color: '#94a3b8', marginRight: cu * 0.06 }}>{ln.label}</span>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: cu * 0.2 }}>
                  {ln.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RibbonCueOverlay({
  cue,
  h,
  segCount,
  segWf,
  sport,
  pack,
}: {
  cue: Cue;
  h: number;
  segCount: number;
  segWf: number;
  sport?: string;
  // 2026-05-27 — operator-selected celebration pack (Setup → "celebration
  // pack" picker). 'v2' routes water polo cues through the new combined-
  // engine launcher (full canvas, scoreboard + ribbon support in one
  // file); default 'v1' keeps the existing horizontal strip that's been
  // running. We still tile each pack per ribbon segment so they wrap
  // the bowl the same way.
  pack?: 'v1' | 'v2';
}) {
  // Edges of each score segment, rounded so the tiles never sub-pixel gap.
  const segs = Array.from({ length: segCount }, (_, s) => {
    const left = Math.round(s * segWf);
    return { left, width: Math.round((s + 1) * segWf) - left };
  });

  // Custom cue — the operator's uploaded art, tiled once per anchor.
  const media = cue.mediaUrl;
  if (media) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: cue.color || '#05070d',
          zIndex: 60,
          animation: 'rbnFade 0.4s ease-out',
        }}
      >
        {segs.map((seg, s) => (
          <div
            key={s}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: seg.left,
              width: seg.width,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        ))}
      </div>
    );
  }

  // 2026-05-27 — V2 cue pack opt-in. The new combined-engine pack ships
  // both scoreboard + ribbon renderers in one file (engine.js +
  // cues-waterpolo.js), so the same cue key plays the same brand-
  // consistent animation on the board AND ribbon. We tile it per
  // segment exactly like the strip so the bowl wrap still works.
  if (pack === 'v2') {
    const teamHex = cue.color || cue.snapshot?.homeColor || null;
    // Inject the frozen live score + operator-attributed scorer so the v2
    // ribbon cinematic shows the REAL game, not the cue file's placeholders.
    const v2Url = celebrationSrc(
      sport,
      cue.key,
      teamHex,
      'v2',
      'ribbon',
      celebrationLiveDataFromCue(cue as Parameters<typeof celebrationLiveDataFromCue>[0]),
    );
    // 2026-06-15 — THE SQUISH FIX. Only use the v2 iframe when there is a REAL
    // v2 launcher cue for this (sport, cueKey): that file sizes its canvas to a
    // true ribbon aspect (2400×256). When v2 has no art it falls back to the
    // 16:9 deck/marquee URL — stuffing THAT into a short ribbon segment is what
    // stretched/squished the celebration. In that case fall through to the
    // ribbon-native RibbonCelebrationStrip (DOM, fits any ribbon shape).
    if (v2Url && v2Url.includes('/v2/launcher.html')) {
      return (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            overflow: 'hidden',
            zIndex: 60,
            background: '#04060b',
            animation: 'rbnFade 0.4s ease-out',
          }}
        >
          {segs.map((seg, s) => (
            <div
              key={s}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: seg.left,
                width: seg.width,
                overflow: 'hidden',
              }}
            >
              <iframe
                src={v2Url}
                title="celebration v2"
                scrolling="no"
                // 2026-06-15 — allow the synthesized SFX to play on kiosks
                // (matches the board route).
                allow="autoplay"
                // Same sandbox model as the board route — static file
                // under /celebrations/v2/, scripts allowed, no
                // same-origin / cookies / storage.
                sandbox="allow-scripts"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 0,
                  display: 'block',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ))}
        </div>
      );
    }
    // No v2 art for this (sport, cueKey) → fall through to the strip.
  }

  // 2026-05-27 — Ribbon-native celebration (v1). The 16:9 cinematics
  // (still used on /board/ for video boards) don't fit 7.5:1 ribbon
  // slices — they clip the top of the goal frame or letterbox down to
  // a tiny floating square. Operator: "the celebrations are not fitting
  // in the ribbon resolution and the players name does not show up".
  //
  // RibbonCelebrationStrip is a horizontal-strip composition designed
  // for the ribbon shape: pulsing motif | big title + scorer | scoreline.
  // pickCinematic() still runs but we treat it as a probe — if it can
  // identify the cue + sport, we extract the title + accent + scorer
  // attribution and feed them to the strip. If it can't, the strip
  // still renders with sensible defaults (cue.label as title, cue.color
  // as accent).
  const stripConfig = buildRibbonStripConfig(cue, sport);
  if (stripConfig) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          overflow: 'hidden',
          zIndex: 60,
          animation: 'rbnFade 0.4s ease-out',
        }}
      >
        {/* Tile the strip once per ribbon segment so the celebration
            wraps the bowl. Per-segment error boundary so a single bad
            render can't crash the whole ribbon during a live game. */}
        {segs.map((seg, s) => (
          <div
            key={s}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: seg.left,
              width: seg.width,
              overflow: 'hidden',
            }}
          >
            <CelebrationErrorBoundary
              cueKey={cue.key}
              fallback={
                <CueBurst cue={cue} w={seg.width} h={h} sport={sport} />
              }
            >
              <RibbonCelebrationStrip
                config={stripConfig}
                height={h}
                live={true}
              />
            </CelebrationErrorBoundary>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        zIndex: 60,
      }}
    >
      {/* dark scrim — one full-ribbon layer */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: 'rgba(5,7,13,0.93)',
          animation: 'rbnScrim 3.9s ease-in-out forwards',
        }}
      />
      {/* the celebration burst, tiled once per score anchor */}
      {segs.map((seg, s) => (
        <div
          key={s}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: seg.left,
            width: seg.width,
            overflow: 'hidden',
          }}
        >
          <CueBurst cue={cue} w={seg.width} h={h} sport={sport} />
        </div>
      ))}
    </div>
  );
}

/**
 * One celebration burst — energy glow, shockwave rings, a light sweep,
 * an emoji + slammed label + the score frozen at fire time, plus
 * optional co-brand attribution — all centred in a band of width `w`.
 * RibbonCueOverlay renders one CueBurst per score anchor.
 *
 * Chromium-83 safe: long-hand insets, per-child margin (no flex
 * `gap`), animation is transform / opacity only.
 */
function CueBurst({
  cue,
  w,
  h,
  sport,
}: {
  cue: Cue;
  w: number;
  h: number;
  /** Sport key — lets the frozen score format with decimals for
   *  judged sports (gymnastics / competitive cheer). */
  sport?: string;
}) {
  const snap = cue.snapshot;
  const sportDef = findSport(sport);
  const energy = cue.color || '#fbbf24';
  const ch = Math.min(h * 0.86, 540);
  const glow = ch * 3.4;
  const ring = ch * 1.4;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
      }}
    >
      {/* energy radial glow */}
      <div
        style={{
          position: 'absolute',
          left: w / 2 - glow / 2,
          top: h / 2 - glow / 2,
          width: glow,
          height: glow,
          borderRadius: 999,
          background: `radial-gradient(circle, ${hexA(energy, 0.5)} 0%, ${hexA(
            energy,
            0.14,
          )} 42%, rgba(5,7,13,0) 66%)`,
          animation: 'rbnGlow 3.9s ease-in-out forwards',
        }}
      />
      {/* shockwave rings */}
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: w / 2 - ring / 2,
            top: h / 2 - ring / 2,
            width: ring,
            height: ring,
            borderRadius: 999,
            border: `${Math.max(4, Math.round(ch * 0.03))}px solid ${hexA(energy, 0.85)}`,
            animation: `rbnRing 3.9s ${(i * 0.2).toFixed(2)}s cubic-bezier(.15,.7,.3,1) forwards`,
          }}
        />
      ))}
      {/* diagonal light sweep */}
      <div
        style={{
          position: 'absolute',
          left: w / 2 - ch * 0.5,
          top: h / 2 - ch * 1.6,
          width: ch,
          height: ch * 3.2,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
          animation: 'rbnSweep 3.9s ease-out forwards',
        }}
      />
      {/* sport mark + slammed label + the frozen score.
          2026-06-15 — vector SportMark (tinted with the cue energy color)
          replaces the platform-dependent emoji; falls back to the cue's emoji
          when we have no vector for that sport, so it never reads worse. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'rbnSlam 3.9s cubic-bezier(.2,.9,.2,1) forwards',
        }}
      >
        <span
          style={{
            lineHeight: 1,
            marginRight: ch * 0.16,
            filter: `drop-shadow(0 ${ch * 0.04}px ${ch * 0.1}px ${hexA(energy, 0.7)})`,
          }}
        >
          <SportMark
            sport={sportDef?.key}
            fallbackEmoji={cue.emoji || '🎉'}
            size={ch * 0.5}
            color={energy}
          />
        </span>
        <span
          style={{
            fontSize: ch * 0.3,
            fontWeight: 900,
            letterSpacing: 4,
            color: '#fff',
            whiteSpace: 'nowrap',
            textShadow: `0 8px 36px rgba(0,0,0,0.9), 0 0 44px ${hexA(energy, 0.5)}`,
          }}
        >
          {(cue.label || cue.key || 'NICE!').toUpperCase()}
        </span>
        {snap && (
          <span
            style={{
              marginLeft: ch * 0.22,
              paddingLeft: ch * 0.22,
              borderLeft: `2px solid ${hexA(energy, 0.4)}`,
              fontSize: ch * 0.26,
              fontWeight: 900,
              color: '#fff',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ color: snap.homeColor || '#fff' }}>{teamNick(snap.homeTeam)}</span>
            <span style={{ margin: `0 ${ch * 0.08}px` }}>{formatScore(sportDef, snap.homeScore)}</span>
            <span style={{ color: '#475569' }}>–</span>
            <span style={{ margin: `0 ${ch * 0.08}px` }}>{formatScore(sportDef, snap.awayScore)}</span>
            <span style={{ color: snap.awayColor || '#fff' }}>{teamNick(snap.awayTeam)}</span>
          </span>
        )}
      </div>

      {/* Co-branded sponsor attribution — "BROUGHT TO YOU BY [logo] NAME".
          Only renders when the server emits sponsorName on the cue.
          Ribbon boards have no speakers; audioUrl is NOT played here. */}
      {cue.sponsorName && (
        <div
          style={{
            position: 'absolute',
            bottom: Math.round(ch * 0.08),
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'rbnSlam 3.9s cubic-bezier(.2,.9,.2,1) forwards',
          }}
        >
          <span
            style={{
              fontSize: Math.round(ch * 0.13),
              fontWeight: 700,
              letterSpacing: 3,
              color: hexA(energy, 0.75),
              whiteSpace: 'nowrap',
              marginRight: Math.round(ch * 0.1),
            }}
          >
            BROUGHT TO YOU BY
          </span>
          {cue.sponsorLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cue.sponsorLogoUrl}
              alt=""
              style={{
                height: Math.round(ch * 0.22),
                maxWidth: Math.round(ch * 0.9),
                objectFit: 'contain',
                marginRight: Math.round(ch * 0.1),
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span
            style={{
              fontSize: Math.round(ch * 0.18),
              fontWeight: 900,
              letterSpacing: 2,
              color: '#fff',
              whiteSpace: 'nowrap',
              textShadow: `0 4px 20px rgba(0,0,0,0.8), 0 0 28px ${hexA(energy, 0.4)}`,
            }}
          >
            {cue.sponsorName}
          </span>
        </div>
      )}
    </div>
  );
}
