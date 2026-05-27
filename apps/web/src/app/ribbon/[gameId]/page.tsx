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

import { useEffect, useMemo, useRef, useState, type SyntheticEvent, type CSSProperties } from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
// Sprint 13 — when Game.ribbonTemplateId is set, hand off the entire
// ribbon render to the same custom-template renderer the /board route
// uses; the template's canvas size differentiates ribbon from
// scoreboard (operator picks 11520×192 or similar for the ribbon).
import { CustomScoreboardScene } from '../../board/[gameId]/CustomScoreboardScene';
import {
  findSport,
  defaultRibbonPresets,
  ribbonSpeedMultiplier,
  ribbonScoreRepeatCount,
} from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
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
import type { ComponentType } from 'react';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
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
const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

/** This is the ribbon surface — it plays RIBBON- and ALL-targeted
 *  cues (and legacy untargeted ones); a scoreboard-only cue is
 *  skipped, so a cue fired "to the scoreboard" never hits the ribbon. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'BOARD';
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
  if (n > def.segment.count) return n - def.segment.count > 1 ? `OT${n - def.segment.count}` : 'OT';
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  if (def.segment.name === 'Inning') return `${ordinal(n)} INN`;
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

  // Basketball — team bonus + possession arrow.
  if (def.key === 'basketball') {
    const bonus = (f: number) => (f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null);
    const parts: string[] = [];
    const hb = bonus(num(stats.homeFouls));
    const ab = bonus(num(stats.awayFouls));
    if (hb) parts.push(`HOME ${hb}`);
    if (ab) parts.push(`AWAY ${ab}`);
    const poss = side(stats.possession);
    if (poss) parts.push(`POSS ${poss.toUpperCase()}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Rally sports — the serve.
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    const serving = String(stats.serving || '').trim();
    return serving ? `SERVING — ${serving.toUpperCase()}` : null;
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
    const sit = ribbonSituational(def, (data.stats || {}) as Record<string, unknown>);
    if (sit) situational.push({ kind: 'situational', id: 'situational', dwellMs: 8000 });
  }
  const slides: Look[] = enabled.has('slides')
    ? (data.ribbonSlides || []).map((url) => ({
        kind: 'slide' as const,
        id: `slide:${url}`,
        url,
        dwellMs: 8500,
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
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    // A custom cue holds for its own duration; a sport celebration
    // matches the 3.9s celebration animation.
    const holdMs =
      next.mediaUrl && next.durationMs && next.durationMs > 0 ? next.durationMs : 3900;
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

  // poll the public board endpoint
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    // Cold-boot: instant paint from the last cached frame so a
    // power-cycle / Wi-Fi blip never blanks the ribbon.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) setData(cached);
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json: BoardData = await res.json();
        if (!alive) return;
        setData(json);
        writeBoardCache(gameId, json);
        // Queue new celebration cues targeted at the ribbon. The first
        // poll's cues already happened before the ribbon opened —
        // record them as seen but don't replay.
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          if (!firstLoad.current && cuePlaysHere(c.target)) cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
      } catch {
        /* keep the last good frame */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [gameId]);

  const def = useMemo(() => (data ? findSport(data.sport) : undefined), [data]);

  // Live clock, projected smoothly between polls (see useLiveClock).
  const clockMs = useLiveClock(data, def);

  // A stable key over every input buildLooks reads. `looks` is rebuilt
  // ONLY when this changes — so a clock-tick / score-change re-render
  // keeps the same `looks` array identity and never resets the
  // rotation timer mid-dwell.
  const looksKey = useMemo(() => {
    if (!data || !def) return '';
    const sit = !!ribbonSituational(def, (data.stats || {}) as Record<string, unknown>);
    return JSON.stringify({
      presets: data.ribbonPresets ?? null,
      sponsors: (data.sponsors || []).map((s) => s.id),
      roster: (data.roster || []).map((p) => p.id),
      messages: data.ribbonMessages ?? null,
      slides: data.ribbonSlides ?? null,
      sport: data.sport,
      home: data.homeTeam,
      sit,
    });
  }, [data, def]);

  const looks = useMemo(
    () => (data && def ? buildLooks(data, def) : []),
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
          initial={data}
        />
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
  if (
    def &&
    ((data.ribbonSlides || []).filter(Boolean).length > 0 ||
      (data.sponsors || []).length > 0)
  ) {
    const ribbonBody = (
      <>
        <RibbonMediaScroll data={data} def={def} vp={vp} clockMs={clockMs} />
        {/* Celebrations must still take over the ribbon in media mode.
            The old looks path rendered this; the early return above
            dropped it (operator: "triggered celebrations and nothing
            triggered on the ribbon"). One full-width burst — the
            operator's hardware repeater replicates it down the run. */}
        {activeCue && (
          <RibbonCueOverlay cue={activeCue} h={vp.h} segCount={1} segWf={vp.w} sport={data?.sport} />
        )}
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
      `}</style>

      {/* [score | content] units, recurring around the ribbon so a
          continuous full-bowl wrap is glanceable from every seat. A
          straight ribbon resolves to one unit and renders as before. */}
      {Array.from({ length: segCount }, (_, s) => {
        const segLeft = Math.round(s * segWf);
        return (
          <div key={s}>
            {/* score / clock anchor — never moves; digits update in place */}
            <ScoreZone
              data={data}
              def={def}
              left={segLeft}
              w={scoreZoneW}
              h={vp.h}
              clockMs={clockMs}
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
              data={data}
              def={def}
            />
          </div>
        );
      })}

      {/* celebration cue overlay — a fired cue takes the ribbon over,
          tiled once per score anchor for the full-bowl wrap */}
      {activeCue && (
        <RibbonCueOverlay cue={activeCue} h={vp.h} segCount={segCount} segWf={segWf} sport={data?.sport} />
      )}
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
}: {
  data: BoardData;
  def: SportDefinition;
  vp: { w: number; h: number };
  clockMs: number;
}) {
  const slides = (data.ribbonSlides || []).filter(Boolean);
  const sponsors = (data.sponsors || []).filter((sp) => sp && (sp.logoUrl || sp.name));
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
  // px/sec scroll rate scaled by the operator's speed; duration = the
  // time to travel exactly one sequence width. 60 px/s @ Normal is a
  // calm ribbon scroll on a real wide run (a ~3000px ribbon takes ~50s
  // end-to-end); the Slow/Fast/Very-fast control scales it (0.45–2.8×).
  // NOTE: on a NARROW test screen the same px/s LOOKS much faster
  // because the content crosses the short width sooner.
  const pxPerSec = 60 * speedMult;
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
            width: 'max-content',
            display: 'flex',
            alignItems: 'center',
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
              style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
            >
              {items.map((it, i) => renderItem(it, `${c}-${i}`))}
            </div>
          ))}
        </div>
      </div>

      {/* pinned score badge — overlays the left of the run on TOP of the
          scrolling media; never scrolls, digits update in place. Its
          solid background occludes the media behind it so it stays
          readable over a busy scroll. */}
      <ScoreZone data={data} def={def} left={0} w={scoreZoneW} h={vp.h} clockMs={clockMs} />
    </div>
  );
}

// ── score zone ─────────────────────────────────────────────────

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
}: {
  data: BoardData;
  def: SportDefinition;
  left: number;
  w: number;
  h: number;
  clockMs: number;
}) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  // Team-color text must stay legible on the near-black ribbon.
  const homeInk = readableInk(homeColor);
  const awayInk = readableInk(awayColor);
  const live = data.status === 'LIVE';
  const seg = segmentLabel(def, data);
  const hasClock = def.clock.type !== 'none';
  const clk = fmtClock(clockMs, def.clock.type === 'countdown');
  const statusText = live
    ? hasClock
      ? `${seg} · ${clk}`
      : seg
    : data.status === 'FINAL'
      ? 'FINAL'
      : data.status === 'HALFTIME'
        ? 'HALFTIME'
        : data.status === 'PRE_GAME'
          ? 'PRE-GAME'
          : (data.status || 'SCHEDULED').replace(/_/g, ' ');

  // The score is the hero — size it off the zone HEIGHT, with a width
  // cap that widens with the score's digit count so a 3-digit
  // basketball score never overflows the zone.
  const digits = Math.max(1, String(Math.max(data.homeScore, data.awayScore, 0)).length);
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
          style={{
            fontSize: score,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(u * 0.06)}px 0 ${Math.round(u * 0.1)}px`,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {data.homeScore}
        </span>
        <span style={{ fontSize: dash, fontWeight: 800, color: '#475569' }}>–</span>
        <span
          style={{
            fontSize: score,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(u * 0.1)}px 0 ${Math.round(u * 0.06)}px`,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {data.awayScore}
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
    const scrollSecs = Math.max(8, (cardW * copies) / 120);
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
    // A full-bleed image — objectFit:contain so an uploaded logo is
    // never cropped top or bottom.
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
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
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
    const sit = ribbonSituational(def, (data.stats || {}) as Record<string, unknown>) || '';
    const parts = sit.split(/(\d+)/);
    return (
      <div
        style={{
          whiteSpace: 'nowrap',
          fontSize: cu * 0.34,
          fontWeight: 900,
          letterSpacing: 2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {parts.map((part, i) => (
          <span key={i} style={{ color: /^\d+$/.test(part) ? '#fde047' : '#38bdf8' }}>
            {part}
          </span>
        ))}
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
          {data.homeScore}
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
          {data.awayScore}
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
// 2026-05-26 — sport-celebration key → cinematic CEL_* component
// mapping. Replaces the procedural <CueBurst> (emoji + slammed label
// + glow rings) with a real cinematic scene from the celebrations
// library so the operator's existing GOAL / Save / Exclusion / Power
// Play buttons fire the new look on every ribbon, no template-picker
// dance required.
//
// `sport` from the BoardData tells us which sport's celebrations
// pool to draw from when a key like 'goal' is ambiguous (soccer
// goal vs hockey goal vs lacrosse goal — all visually distinct).
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

  // ─── Goal-class keys (universal "ball/puck in net") ────────────
  if (key === 'goal') {
    if (sport === 'hockey')   return { Component: CelHockeyGoalWidget,  defaults: { ...common, scorer: 'GOAL', assists: [] } };
    if (sport === 'lacrosse') return { Component: LxGoalWidget,         defaults: { ...common, scorer: 'GOAL', number: '' } };
    // Soccer / water polo / field hockey / handball — soccer GOAL
    // scene reads cleanly across all "ball in goal" sports.
    return { Component: CelSoccerGoalWidget, defaults: { ...common, scorer: 'GOAL', minute: '' } };
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

function RibbonCueOverlay({
  cue,
  h,
  segCount,
  segWf,
  sport,
}: {
  cue: Cue;
  h: number;
  segCount: number;
  segWf: number;
  sport?: string;
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

  // 2026-05-26 — try to route the cue to a cinematic CEL_*
  // component first; only fall back to the procedural CueBurst for
  // keys we haven't mapped yet (custom operator-defined cues, edge
  // sports without a CEL_* variant). Operator GOAL / Save /
  // Exclusion / Power Play buttons all hit the cinematic path now.
  const cinematic = pickCinematic(cue, sport);
  if (cinematic) {
    const Cinematic = cinematic.Component;
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
          background: '#000',
          animation: 'rbnFade 0.4s ease-out',
        }}
      >
        {/* Tile the cinematic once per score anchor — operator wraps
            the ribbon with score repeats (segCount=4 typical at 40ft)
            so each visible chunk gets its own playthrough. */}
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
            <Cinematic config={cinematic.defaults} live={true} height={h} />
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
          <CueBurst cue={cue} w={seg.width} h={h} />
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
function CueBurst({ cue, w, h }: { cue: Cue; w: number; h: number }) {
  const snap = cue.snapshot;
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
      {/* emoji + slammed label + the frozen score */}
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
            fontSize: ch * 0.5,
            lineHeight: 1,
            marginRight: ch * 0.16,
            filter: `drop-shadow(0 ${ch * 0.04}px ${ch * 0.1}px ${hexA(energy, 0.7)})`,
          }}
        >
          {cue.emoji || '🎉'}
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
            <span style={{ margin: `0 ${ch * 0.08}px` }}>{snap.homeScore}</span>
            <span style={{ color: '#475569' }}>–</span>
            <span style={{ margin: `0 ${ch * 0.08}px` }}>{snap.awayScore}</span>
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
