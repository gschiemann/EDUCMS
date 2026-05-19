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

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import {
  findSport,
  defaultRibbonPresets,
  ribbonSpeedMultiplier,
  ribbonScoreRepeatCount,
} from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

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
}

// 750ms — sub-second sync, kept in step with the board + scorebug.
const POLL_MS = 750;
// 250ms — a smooth score-zone clock tick between polls.
const TICK_MS = 250;
const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

/** This is the ribbon surface — it plays RIBBON- and ALL-targeted
 *  cues (and legacy untargeted ones); a scoreboard-only cue is
 *  skipped, so a cue fired "to the scoreboard" never hits the ribbon. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'BOARD';
}

// ── helpers ────────────────────────────────────────────────────

function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
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

function liveClockMs(data: BoardData, def: SportDefinition): number {
  if (!data.clockRunning || def.clock.type === 'none') return data.clockMs;
  const skew = data.serverTime - Date.now();
  const elapsed = Date.now() + skew - new Date(data.clockUpdatedAt).getTime();
  if (def.clock.type === 'countup') return data.clockMs + elapsed;
  return Math.max(0, data.clockMs - elapsed);
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
  const [vp, setVp] = useState({ w: 1920, h: 240 });
  // installer override for the score-anchor count — ?score=N (0 = auto)
  const [scoreOverride, setScoreOverride] = useState(0);
  // a re-render tick so the score-zone clock counts smoothly between polls
  const [, setTick] = useState(0);
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
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 240 });
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

  // smooth clock tick — the score zone derives the clock from the
  // anchor each render; this just forces re-renders between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => (n + 1) % 1_000_000), TICK_MS);
    return () => clearInterval(t);
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
            <ScoreZone data={data} def={def} left={segLeft} w={scoreZoneW} h={vp.h} />
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
        <RibbonCueOverlay cue={activeCue} h={vp.h} segCount={segCount} segWf={segWf} />
      )}
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
}: {
  data: BoardData;
  def: SportDefinition;
  left: number;
  w: number;
  h: number;
}) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const live = data.status === 'LIVE';
  const seg = segmentLabel(def, data);
  const hasClock = def.clock.type !== 'none';
  const clk = fmtClock(liveClockMs(data, def));
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
            color: homeColor,
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
            color: awayColor,
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
  const unit =
    look.kind === 'slide'
      ? w
      : look.kind === 'player' || look.kind === 'situational'
        ? Math.min(w, h * 6)
        : Math.min(w, h * 4.4); // prompt / final / pregame
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
        <LookUnit key={i} look={look} h={h} data={data} def={def} />
      ))}
    </div>
  );
}

/** A single instance of a look — sized off the ribbon height. */
function LookUnit({
  look,
  h,
  data,
  def,
}: {
  look: Look;
  h: number;
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
    return (
      <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#fbbf24', fontSize: cu * 0.34, fontWeight: 900, marginRight: cu * 0.14 }}>
          ‹
        </span>
        <span style={{ fontSize: cu * 0.42, fontWeight: 900, letterSpacing: 4, color: '#fff' }}>
          {look.text}
        </span>
        <span style={{ color: '#fbbf24', fontSize: cu * 0.34, fontWeight: 900, marginLeft: cu * 0.14 }}>
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
function RibbonCueOverlay({
  cue,
  h,
  segCount,
  segWf,
}: {
  cue: Cue;
  h: number;
  segCount: number;
  segWf: number;
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
