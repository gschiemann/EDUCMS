'use client';

/**
 * VenueOS Sports — shared scorebug surface.
 *
 * ONE implementation of the broadcast score bug, consumed by BOTH:
 *   • /scorebug/[gameId]            — corner-docked bug pinned to the
 *     browser-source VIEWPORT edges (the original OBS overlay route).
 *   • /overlay/[gameId]?surface=stream — the same bug docked inside a
 *     fixed 1920×1080 broadcast canvas that transform:scales to the
 *     OBS / vMix / Hudl browser-source size, so the bug renders
 *     pixel-identically at 720p / 1080p / 4K output.
 *
 * Both surfaces subscribe to the SAME poll-cached `/sports/board/:id`
 * endpoint the in-venue board + ribbon use, so the big board and the
 * stream bug can NEVER disagree — there is no second source of truth,
 * no double entry.
 *
 * Cross-browser note: this renders in OBS/vMix's embedded CEF (modern
 * Chromium), so the NovaStar-Taurus Chromium-83 constraint does not
 * strictly apply here — but it's cheap insurance, so we keep the
 * long-hand top/right/bottom/left (never `inset`) and avoid flex `gap`
 * (the shared SituationalRow already does this) anyway.
 *
 * This file was extracted verbatim from scorebug/[gameId]/page.tsx —
 * the polling, cue-pump, live-clock, and CTS-merge logic are byte-for-
 * byte the same, just lifted into a hook + presentational component so
 * two routes can share them without copy-paste drift.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { applyCtsOverlay } from '@/lib/cts-merge';
// SEC-007 — signed proof-of-play beacon capability (see lib/sports-beacon.ts).
import { postBeacon } from '@/lib/sports-beacon';
import {
  SituationalRow,
  hasSituational,
} from '@/components/widgets/v2/_shared/sports-situational';
import {
  LiveOverlayRenderer,
  type LiveOverlayData,
} from '@/components/widgets/sports/overlays/LiveOverlayWidgets';
import {
  SCORE_MOTION_KEYFRAMES,
  SCORE_POP_ANIM,
  useScoreFlip,
} from '@/components/sports/score-motion';
import { SportMark } from '@/components/sports/SportGlyph';
import { API_URL } from '@/lib/api-url';
import { findSport, formatScore } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

// ── types ──────────────────────────────────────────────────────

export interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  // Scoring team ('home' | 'away') when the cue is a team celebration —
  // used by the auto+manual double-fire coalesce. Auto-celebrate always
  // sets it; a manual player fire may leave it null.
  team?: string | null;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
}

/** The scorebug is a scoreboard surface — it plays BOARD- and
 *  ALL-targeted cues (and legacy untargeted ones); a RIBBON-only
 *  cue is skipped. */
export function cuePlaysHere(target?: string): boolean {
  return target !== 'RIBBON';
}

/**
 * A sponsor look the board response carries (T2-9). The scorebug renders the
 * SAME frequency-capped rotation the in-venue board does — so an off-site
 * stream viewer counts as a real, logged sponsor impression. Mirrors the
 * `Sponsor` interface in app/board/[gameId]/page.tsx (one data model).
 */
export interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  weight?: number;
  // T2-9: frequency-cap enforcement + flight-window re-check at render time.
  frequencyCapPerHour?: number | null;
  flightEndAt?: string | null;
}

/**
 * The featured-player / promo spotlight the operator pushes (same `spotlight`
 * field the big board reads). On the stream it renders as an animated
 * broadcast lower-third. `visible` gates it exactly as on the board.
 */
export interface Spotlight {
  visible?: boolean;
  title?: string;
  photoUrl?: string | null;
  subtitle?: string;
  lines?: { label: string; value: string }[];
}

/**
 * Phase 1 (P1-C) — in-game stat leaders computed from the game's roster on the
 * server (NO new fetch, NO migration). Present only when the SPORTS_PLAYER_STATS
 * flag is on AND there's at least one non-empty leader; the key is omitted
 * entirely otherwise, so the overlay renders exactly as today when absent.
 * Mirrors the `getBoardFresh` payload delta in the stats-engine spec.
 */
export interface Leader {
  statKey: string;
  label: string;
  team: 'home' | 'away';
  playerName: string;
  playerNumber: string | null;
  photoUrl: string | null;
  value: string;
}

/**
 * Phase 1 (P1-C) — the auto Player-of-the-Game, a weighted top-performer over
 * the game's roster (server-computed). Same gate as `leaders` (flag-on +
 * non-empty); `null` / absent otherwise. On the stream it falls back into the
 * `SpotlightLowerThird` as a "PLAYER OF THE GAME" lower-third whenever there is
 * no manual spotlight visible — a manual operator spotlight always wins.
 */
export interface PlayerOfGame {
  name: string;
  number: string | null;
  team: 'home' | 'away';
  photoUrl: string | null;
  headline: string;
  lines: { label: string; value: string }[];
}

export interface BoardData {
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
  cues: Cue[];
  serverTime: number;
  // T2-9 — rotating, frequency-capped sponsor looks. Same payload the big
  // board rotates in its footer; the stream renders a slim sponsor strap.
  sponsors?: Sponsor[];
  sponsorSpotSeconds?: number;
  // Broadcast lower-third — featured player / promo (board parity).
  spotlight?: Spotlight | null;
  // Phase 1 (P1-C) — server-computed in-game stat leaders + auto
  // Player-of-the-Game, from the already-loaded roster (no new fetch). Present
  // only when the SPORTS_PLAYER_STATS flag is on + non-empty; omitted otherwise,
  // so the overlay is byte-identical to today when the flag is off.
  leaders?: Leader[];
  playerOfGame?: PlayerOfGame | null;
  // T2-5 — active live-game text overlay (penalty / review / timeout /
  // injury), null when none. Rendered as a broadcast strap. Same shape the
  // board's LiveOverlayRenderer consumes.
  liveOverlay?: LiveOverlayData | null;
  // Sprint 13 — operator-picked custom layouts.
  scoreboardTemplateId?: string | null;
  ribbonTemplateId?: string | null;
  scorebugTemplateId?: string | null;
}

export const DEFAULT_HOME = '#4f46e5';
export const DEFAULT_AWAY = '#dc2626';
// 750ms — sub-second sync, kept in step with the board + ribbon.
export const POLL_MS = 750;

export type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

export const POS: Record<
  CornerKey,
  { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string }
> = {
  tl: { v: 'top', h: 'left', origin: 'top left' },
  tr: { v: 'top', h: 'right', origin: 'top right' },
  bl: { v: 'bottom', h: 'left', origin: 'bottom left' },
  br: { v: 'bottom', h: 'right', origin: 'bottom right' },
};

// ── helpers ────────────────────────────────────────────────────

export function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe >= 60_000) {
    const m = Math.floor(safe / 60_000);
    const s = Math.floor((safe % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const s = Math.floor(safe / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${s}.${tenths}`;
}

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function segmentLabel(def: SportDefinition, data: BoardData): string {
  const n = data.segment;
  // Inning sports (baseball/softball) NEVER read "OT" past regulation — extra
  // innings are still innings. Resolve the ordinal (+ Top/Bottom half) first.
  if (def.segment.name === 'Inning') {
    const half = String((data.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  if (n > def.segment.count) {
    // Period/Quarter/Half overtime sports → "OT"/"2OT". Non-overtime segment
    // sports (golf holes, meet events) clamp instead of mislabeling overtime.
    if (def.segment.overtime) {
      const ot = n - def.segment.count;
      return ot > 1 ? `OT${ot}` : 'OT';
    }
    return `${def.segment.name.toUpperCase()} ${def.segment.count}`;
  }
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  // Soccer halves abbreviate to H1/H2 to match the big board (which
  // already shows H1/H2). The verbose "HALF 1" / "HALF 2" was the only
  // surface still out of parity. (audit P2)
  if (def.segment.name === 'Half') return `H${n}`;
  // Meet-sport segments abbreviate too, so the scorebug center column
  // matches the board/ribbon (R1 rotation, RD1 round) instead of a
  // verbose "ROTATION 1" / "ROUND 1".
  if (def.segment.name === 'Rotation') return `R${n}`;
  if (def.segment.name === 'Round') return `RD${n}`;
  return `${def.segment.name.toUpperCase()} ${n}`;
}

/**
 * The live meet context a LEADERBOARD sport surfaces below the segment
 * label on the scorebug — the currently-contested event / apparatus /
 * hole / division the operator has entered. Returns null when none is
 * set (or for clock-based sports), so the center column simply shows
 * the segment label as before. Reads ONLY existing operator-entered
 * stats — the full per-event finish-place results model is a separate
 * deferred feature.
 */
export function meetContextLabel(def: SportDefinition, data: BoardData): string | null {
  if (def.clock.type !== 'none') return null;
  const stats = data.stats || {};
  const str = (k: string) => String(stats[k] || '').trim();
  if (def.key === 'gymnastics') {
    const app = str('currentApparatus');
    return app ? app.toUpperCase() : null;
  }
  if (def.key === 'golf') {
    const hole = Number(stats.currentHole);
    return Number.isFinite(hole) && hole > 0 ? `HOLE ${hole}` : null;
  }
  if (def.key === 'cross_country') {
    const lead = str('leadRunner');
    return lead ? lead.toUpperCase() : null;
  }
  if (def.key === 'competitive_cheer') {
    const div = str('division');
    return div ? div.toUpperCase() : null;
  }
  if (def.key === 'diving') {
    const diver = str('currentDiver');
    const code = str('diveCode');
    if (!diver) return null;
    return code ? `${diver.toUpperCase()} · ${code.toUpperCase()}` : diver.toUpperCase();
  }
  // Track & field / swimming (+ the deprecated legacy swimming_diving key)
  // — the currently-contested event.
  const ev = str('currentEvent');
  return ev ? ev.toUpperCase() : null;
}

/** Team code: explicit override → else first word, upper, ≤11 chars. */
export function teamCode(name: string, override: string | null): string {
  if (override) return override.trim().toUpperCase().slice(0, 11);
  const first = String(name || '').trim().split(/\s+/)[0] || '—';
  return first.toUpperCase().slice(0, 11);
}

// ── query-param reader ─────────────────────────────────────────

/**
 * The display options a scorebug surface reads from its URL query.
 * Resolved client-side from `window.location` — NOT `useSearchParams`
 * — to match the deliberate pattern the sibling /ribbon page uses:
 * `useSearchParams` forces a CSR bailout that needs a Suspense
 * boundary and trips the Next production build; reading
 * window.location in an effect keeps these public surfaces clean.
 */
export interface ScorebugQuery {
  pos: { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string };
  scale: number;
  homeOverride: string | null;
  awayOverride: string | null;
  /** ?theme token (brand-shim hook) — reserved for a future accent pass. */
  theme: string | null;
  /**
   * Clean-feed switch. `?clean=1` (or `true`) hides the bug, sponsor strap,
   * and lower-thirds so a producer can cut to a clean program feed for a
   * replay / interview / sideline reporter — without taking the whole
   * browser-source OFF (which would kill the sponsor-impression story).
   * The surface animates the package out/in as this flips. Reconciles
   * live, so toggling the URL param in OBS updates within one poll.
   */
  clean: boolean;
}

/**
 * Read the scorebug display options from `window.location.search`.
 *
 * `defaultPos` differs per surface: the corner-bug route defaults to
 * lower-left ('bl'), the broadcast overlay to lower-right ('br', the
 * broadcast scorebug convention). The first paint (pre-effect) uses
 * the default; the effect reconciles to the URL on mount.
 */
/** `?clean=1` / `?clean=true` → clean feed (package hidden). Anything else
 *  (absent, `0`, `false`) keeps the package up. */
function parseClean(v: string | null): boolean {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function useScorebugQuery(defaultPos: CornerKey): ScorebugQuery {
  const [q, setQ] = useState<ScorebugQuery>(() => ({
    pos: POS[defaultPos],
    scale: 1,
    homeOverride: null,
    awayOverride: null,
    theme: null,
    clean: false,
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => {
      const sp = new URLSearchParams(window.location.search);
      const posKey = (sp.get('pos') || defaultPos) as CornerKey;
      const scaleRaw = parseFloat(String(sp.get('scale') || '1'));
      setQ({
        pos: POS[posKey] || POS[defaultPos],
        scale: Number.isFinite(scaleRaw) ? Math.min(4, Math.max(0.4, scaleRaw)) : 1,
        homeOverride: sp.get('home') || null,
        awayOverride: sp.get('away') || null,
        theme: sp.get('theme') || null,
        clean: parseClean(sp.get('clean')),
      });
    };
    read();
    // A producer flips ?clean= live in OBS (some browser-sources reload the
    // query without a full navigation); re-read on the events that fire and
    // poll as a cheap backstop so the cut to a clean feed lands within ~1s.
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    const t = setInterval(read, 1000);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
      clearInterval(t);
    };
  }, [defaultPos]);
  return q;
}

// ── live clock ─────────────────────────────────────────────────

export function useLiveClock(
  data: BoardData | null,
  def: SportDefinition | undefined,
): number {
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

// ── data hook ──────────────────────────────────────────────────

export interface ScorebugData {
  /** Raw board payload (un-merged) — `null` until first paint. */
  data: BoardData | null;
  /** Sport definition for the game's sport, or `undefined` if unknown. */
  def: SportDefinition | undefined;
  /** CTS-merged view (the render source-of-truth), or `null` pre-data. */
  view: BoardData | null;
  /** The live-projected clock in ms (ticks locally between polls). */
  liveMs: number;
  /** The currently-playing celebration cue, or `null`. */
  activeCue: Cue | null;
}

/**
 * The full scorebug data layer — poll the cached board endpoint, seed
 * from the last-frame cache for instant cold-boot, project the clock
 * locally, queue + pump celebration cues, and apply the CTS overlay.
 *
 * Lifted verbatim from scorebug/[gameId]/page.tsx so both the corner
 * bug and the broadcast-canvas overlay read identical live state.
 */
export function useScorebugData(gameId: string): ScorebugData {
  const [data, setData] = useState<BoardData | null>(null);

  // cue playback
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const seenCues = useRef<Set<string>>(new Set());
  const cueQueue = useRef<Cue[]>([]);
  const firstLoad = useRef(true);
  const playing = useRef(false);
  // 2026-06-05 — same auto+manual double-fire coalesce the board/ribbon use:
  // one goal can emit two celebration CUEs (auto carries `team`, the manual
  // player fire usually has `team:null`). Match on KEY with a team-wildcard
  // (empty matches any) within 6s so the overlay celebrates once.
  const lastCueSig = useRef<{ key: string; team: string; t: number }>({ key: '', team: '', t: 0 });
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    cueTimer.current = setTimeout(() => {
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, 3600);
  };

  // Cancel a pending cue timer on unmount.
  useEffect(
    () => () => {
      if (cueTimer.current) clearTimeout(cueTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    // Cold-boot: seed from the last cached frame so a power-cycle
    // mid-broadcast restores the overlay instantly.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) setData(cached);
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json: BoardData = await res.json();
        if (!alive) return;
        setData(json);
        writeBoardCache(gameId, json);
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          // Skip cues targeted only at the ribbon, and the first poll's
          // already-happened cues.
          if (firstLoad.current || !cuePlaysHere(c.target)) continue;
          // Coalesce the auto+manual double of one scoring moment: same KEY,
          // team-wildcard (empty matches any), 6s window.
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
      } catch {
        /* keep the last good frame on a transient network error */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const def = useMemo(() => (data ? findSport(data.sport) : undefined), [data]);

  // 2026-05-27 — CTS source-of-truth merge (apps/web/src/lib/cts-merge.ts).
  // When the CTS console is broadcasting fresh snapshots into the
  // game's stats.cts block, those overrule the operator-input columns
  // on the scorebug too. One helper, identical math on every public
  // sports surface.
  const view = useMemo(() => (data ? applyCtsOverlay(data) : data), [data]);
  const liveMs = useLiveClock(view, def);

  return { data, def, view, liveMs, activeCue };
}

// ── presentational bug ─────────────────────────────────────────

export interface ScorebugBugProps {
  view: BoardData;
  def: SportDefinition;
  liveMs: number;
  activeCue: Cue | null;
  /** Which corner the bug docks into (controls the cue-toast side +
   *  scale transform origin). */
  pos: { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string };
  /** Size multiplier on the bug. */
  scale: number;
  /** Optional team-code overrides. */
  homeOverride?: string | null;
  awayOverride?: string | null;
  /** Clean feed — animate the whole bug + situational strip out (producers
   *  cut to a clean program feed for replays / interviews). Defaults false. */
  clean?: boolean;
}

/**
 * Live shot-clock projection — a second countdown read from `stats.shotClock`
 * (the CTS-populated `{ len, ms, at, running }` anchor) and ticked locally the
 * same way the game clock is. Returns `{ ms, len }`; `len <= 0` means the sport
 * has no shot clock / it's off, so the bug hides it. Identical math to the big
 * board's shot-clock effect — single source of truth, no drift.
 */
function useShotClock(view: BoardData | null): { ms: number; len: number } {
  const [ms, setMs] = useState(0);
  const scRaw = (view?.stats as Record<string, unknown> | undefined)?.shotClock;
  const sc = scRaw && typeof scRaw === 'object' ? (scRaw as Record<string, unknown>) : null;
  const len = Number(sc?.len) || 0;
  const anchorMs = Math.max(0, Number(sc?.ms) || 0);
  const anchorAt = String(sc?.at || '');
  const running = !!sc?.running;
  const serverTime = view?.serverTime || Date.now();
  useEffect(() => {
    if (len <= 0) {
      setMs(0);
      return;
    }
    const skew = serverTime - Date.now();
    const at = new Date(anchorAt).getTime();
    const project = () => {
      if (!running || !Number.isFinite(at)) {
        setMs(anchorMs);
        return;
      }
      setMs(Math.max(0, anchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!running) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [anchorMs, anchorAt, running, len, serverTime]);
  return { ms, len };
}

// ── sponsor rotation (stream proof-of-play) ─────────────────────

type SponsorSlot = { kind: 'sponsor'; sponsor: Sponsor } | { kind: 'idle' };

/**
 * The rotating, frequency-capped sponsor look for the STREAM surface — the
 * SAME rotation + cap + flight-window logic the in-venue board footer uses
 * (app/board/[gameId]/page.tsx), and the SAME impression POST, just tagged
 * `surfaceKind:'stream'`. A logo on every off-site view = doubled sponsor
 * value + per-stream proof-of-play.
 *
 * Returns the active slot (a sponsor look or an `idle` gap so the strap can
 * fade fully out between looks — a stream bug shouldn't carry a permanent
 * sponsor band). Pauses while `clean` (clean feed) so we never log an
 * impression no viewer can see.
 */
function useStreamSponsorRotation(view: BoardData | null, clean: boolean): SponsorSlot {
  const sponsors = useMemo(() => view?.sponsors || [], [view?.sponsors]);
  const spotSeconds = Math.max(3, view?.sponsorSpotSeconds || 8);
  const gameId = view?.id || '';
  const sponsorKey = useMemo(() => JSON.stringify(sponsors), [sponsors]);

  // Frequency-cap bookkeeping — per sponsor, sliding 60-min window. Same as
  // the board's shownTimestamps map.
  const shownTimestamps = useRef<Map<string, number[]>>(new Map());

  // Build the weighted slot list (one slot per weight unit), plus an `idle`
  // gap between cycles. Re-derives only when the sponsor set changes.
  const slots = useMemo<SponsorSlot[]>(() => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const out: SponsorSlot[] = [];
    for (const sp of sponsors) {
      if (sp.flightEndAt && new Date(sp.flightEndAt).getTime() <= now) continue;
      if (sp.frequencyCapPerHour !== null && sp.frequencyCapPerHour !== undefined) {
        const recent = (shownTimestamps.current.get(sp.id) || []).filter((t) => t > oneHourAgo);
        shownTimestamps.current.set(sp.id, recent);
        if (recent.length >= sp.frequencyCapPerHour) continue;
      }
      const w = Math.max(1, Math.min(10, sp.weight || 1));
      for (let i = 0; i < w; i++) out.push({ kind: 'sponsor', sponsor: sp });
    }
    // A short idle gap so the strap breathes between sponsor looks.
    if (out.length > 0) out.push({ kind: 'idle' });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sponsorKey]);

  const [slotIdx, setSlotIdx] = useState(0);
  useEffect(() => {
    if (clean || slots.length <= 1) {
      setSlotIdx(0);
      return;
    }
    const t = setInterval(() => {
      setSlotIdx((i) => (i + 1) % slots.length);
    }, spotSeconds * 1000);
    return () => clearInterval(t);
  }, [slots.length, spotSeconds, clean]);

  const active: SponsorSlot =
    slots.length === 0 || clean ? { kind: 'idle' } : slots[slotIdx % slots.length] || { kind: 'idle' };

  // Impression: when a sponsor look becomes active, record it locally (cap
  // enforcement) and fire-and-forget the SAME endpoint the board uses,
  // tagged surfaceKind:'stream'. Throttled to once per look.
  const lastPingedRef = useRef<string | null>(null);
  useEffect(() => {
    if (active.kind !== 'sponsor') {
      lastPingedRef.current = null;
      return;
    }
    const sp = active.sponsor;
    if (lastPingedRef.current === sp.id) return;
    lastPingedRef.current = sp.id;
    const prev = shownTimestamps.current.get(sp.id) || [];
    prev.push(Date.now());
    shownTimestamps.current.set(sp.id, prev);
    if (gameId) {
      // SEC-007: this surface is usually an OBS browser source on a
      // producer's laptop, which has no device credential to offer — so it
      // will normally get an UNVERIFIED capability and the server will grade
      // its rows accordingly. That is the honest outcome, not a bug.
      void postBeacon({
        gameId,
        scope: 'impression',
        url: `${API_URL}/sports/sponsors/${sp.id}/impression`,
        body: { gameId, surfaceKind: 'stream' },
      });
    }
  }, [active, gameId]);

  return active;
}

/**
 * A paused-while-clean rotating index over `count` items, advancing every
 * `everyMs`. Resets to 0 when the list shrinks/grows or the feed goes clean, so
 * the LEADERS strap never lands on a stale index. No-op (stays 0) for ≤1 item.
 */
function useRotatingIndex(count: number, everyMs: number, paused: boolean): number {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (paused || count <= 1) {
      setIdx(0);
      return;
    }
    const t = setInterval(() => setIdx((i) => (i + 1) % count), everyMs);
    return () => clearInterval(t);
  }, [count, everyMs, paused]);
  return idx;
}

// ── stream extras: sponsor strap + lower-thirds ─────────────────

export interface ScorebugExtrasProps {
  view: BoardData;
  def: SportDefinition;
  /** Corner the score bug occupies — the sponsor strap docks the OPPOSITE
   *  bottom corner from the bug so the two never fight. */
  pos: { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string };
  scale: number;
  /** Clean feed — hide the sponsor strap + lower-thirds (animate out). */
  clean?: boolean;
}

/**
 * The broadcast PACKAGE that rides ALONGSIDE the score bug: a slim rotating
 * sponsor strap (opposite corner) + the spotlight lower-third + the T2-5
 * live-game overlay (penalty / review / timeout). All driven by the SAME
 * `/sports/board/:id` payload the bug already polls — no second fetch, no
 * new operator workflow. Hidden entirely on a clean feed.
 */
export function ScorebugExtras({ view, def, pos, scale, clean = false }: ScorebugExtrasProps) {
  const sponsorSlot = useStreamSponsorRotation(view, clean);
  // Sponsor strap docks the bottom corner OPPOSITE the bug's horizontal side
  // (bug bottom-left ⇒ strap bottom-right) so they never overlap. When the
  // bug is in a TOP corner, the strap still rides the bottom (broadcast
  // convention) on the same side as the bug for visual balance.
  const strapH = pos.v === 'bottom' ? (pos.h === 'left' ? 'right' : 'left') : pos.h;
  const showStrap = sponsorSlot.kind === 'sponsor';
  const spot = view.spotlight;
  const manualSpotlightUp = !!(spot && spot.visible && spot.title);
  // Lower-third source: a MANUAL operator spotlight ALWAYS wins. Only when none
  // is visible do we fall back to the auto Player-of-the-Game (P1-C) — rendered
  // through the same broadcast lower-third with a "PLAYER OF THE GAME" eyebrow.
  const potg = view.playerOfGame || null;
  const lowerThird: { spot: Spotlight; eyebrow: string } | null = manualSpotlightUp
    ? { spot: spot as Spotlight, eyebrow: 'SPOTLIGHT' }
    : potg && potg.name
      ? { spot: spotFromPotg(potg), eyebrow: 'PLAYER OF THE GAME' }
      : null;
  const overlay = view.liveOverlay || null;
  // Compact rotating LEADERS strap — a slim broadcast strip cycling the top
  // performer per stat (top scorer, etc.). Rides the SAME bottom corner as the
  // sponsor strap; only shown when the sponsor strap isn't (they share the slot
  // so neither crowds the bug). Hidden on a clean feed and when no leaders.
  const leaders = useMemo(
    () => (view.leaders || []).filter((l) => l && l.playerName && l.value),
    [view.leaders],
  );
  const leaderIdx = useRotatingIndex(leaders.length, 6000, clean);
  const activeLeader = leaders.length > 0 ? leaders[leaderIdx % leaders.length] : null;
  // Don't fight the sponsor strap for the corner: sponsor wins when it's up.
  const showLeaders = !clean && !showStrap && !!activeLeader;

  return (
    <>
      <style>{`
        @keyframes sbStrapIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sbLowerThirdIn {
          from { opacity: 0; transform: translateY(24px); }
          10%  { opacity: 1; transform: translateY(0); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* rotating sponsor strap — slim, opposite the bug, frequency-capped,
          impression-logged (surfaceKind:'stream'). Hidden on clean feed. */}
      {!clean && showStrap && sponsorSlot.kind === 'sponsor' && (
        <div
          key={sponsorSlot.sponsor.id}
          style={{
            position: 'absolute',
            bottom: 0,
            [strapH]: 0,
            margin: 32,
            transform: `scale(${scale})`,
            transformOrigin: pos.v === 'bottom' ? `bottom ${strapH}` : `top ${strapH}`,
            animation: 'sbStrapIn 0.45s ease-out forwards',
            willChange: 'transform, opacity',
            pointerEvents: 'none',
          }}
        >
          <SponsorStrap sponsor={sponsorSlot.sponsor} />
        </div>
      )}

      {/* compact rotating LEADERS strap (P1-C) — top performer per stat,
          cycling. Shares the sponsor corner; only shows when the sponsor strap
          isn't up so the two never crowd the bug. Hidden on clean feed. */}
      {showLeaders && activeLeader && (
        <div
          key={`${activeLeader.statKey}:${activeLeader.playerName}`}
          style={{
            position: 'absolute',
            bottom: 0,
            [strapH]: 0,
            margin: 32,
            transform: `scale(${scale})`,
            transformOrigin: pos.v === 'bottom' ? `bottom ${strapH}` : `top ${strapH}`,
            animation: 'sbStrapIn 0.45s ease-out forwards',
            willChange: 'transform, opacity',
            pointerEvents: 'none',
          }}
        >
          <LeadersStrap
            leader={activeLeader}
            accent={(activeLeader.team === 'home' ? view.homeColor : view.awayColor) || DEFAULT_HOME}
          />
        </div>
      )}

      {/* broadcast lower-third — manual spotlight (operator-pushed) OR the auto
          Player-of-the-Game fallback. Bottom-center, above any docked corner
          content. Manual spotlight always wins; hidden on a clean feed. */}
      {!clean && lowerThird && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 170,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <SpotlightLowerThird spot={lowerThird.spot} eyebrow={lowerThird.eyebrow} />
        </div>
      )}

      {/* T2-5 live-game overlay (penalty / review / timeout / injury) — the
          SAME dispatcher the board uses, driven by the SAME operator controls.
          It pins itself (lower-third / top-pill); hidden on a clean feed. */}
      {!clean && overlay ? <LiveOverlayRenderer overlay={overlay} /> : null}
    </>
  );
}

/**
 * Slim broadcast sponsor strap — logo + name on a dark pill. Compact so it
 * rides a stream corner without fighting the score bug. Logo on natural
 * aspect (width auto) so wide marks aren't crushed; color monogram fallback.
 */
function SponsorStrap({ sponsor }: { sponsor: Sponsor }) {
  const color = sponsor.color || '#4f46e5';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(11,15,26,0.94), rgba(5,7,13,0.94))',
        border: `1.5px solid ${color}66`,
        borderRadius: 12,
        padding: '8px 16px',
        boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
        fontFamily: 'Inter, system-ui, sans-serif',
        maxWidth: 420,
      }}
    >
      {sponsor.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sponsor.logoUrl}
          alt=""
          style={{
            height: 38,
            width: 'auto',
            maxWidth: 160,
            objectFit: 'contain',
            marginRight: 12,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          style={{
            height: 38,
            width: 38,
            borderRadius: 9,
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 900,
            color: '#fff',
            marginRight: 12,
          }}
        >
          {sponsor.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 3,
            color,
            lineHeight: 1,
            marginBottom: 3,
          }}
        >
          SPONSORED BY
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.05,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 240,
          }}
        >
          {sponsor.name}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact broadcast LEADERS strap (P1-C) — one cycling top-performer chip:
 * a small stat overline (e.g. "PTS LEADER"), the player's name + number, and
 * the value, on the same dark pill family as the sponsor strap. Team color
 * tints the rule + label. Slim by design so it rides the bug's corner without
 * fighting it. Taurus note doesn't strictly apply on the stream (OBS CEF), but
 * we keep flex `gap`-free + longhand sides as cheap insurance, matching the
 * rest of this file.
 */
function LeadersStrap({ leader, accent }: { leader: Leader; accent: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(11,15,26,0.94), rgba(5,7,13,0.94))',
        border: `1.5px solid ${accent}66`,
        borderRadius: 12,
        padding: '8px 16px',
        boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
        fontFamily: 'Inter, system-ui, sans-serif',
        maxWidth: 460,
      }}
    >
      {leader.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={leader.photoUrl}
          alt=""
          style={{
            width: 40,
            height: 40,
            objectFit: 'cover',
            borderRadius: 9,
            border: '2px solid #1e2638',
            background: '#05070d',
            marginRight: 12,
            flex: 'none',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div style={{ minWidth: 0, marginRight: 16 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 3,
            color: accent,
            lineHeight: 1,
            marginBottom: 3,
          }}
        >
          {(leader.label || 'LEADER').toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.05,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 280,
          }}
        >
          {leader.playerNumber ? (
            <span style={{ color: '#94a3b8', marginRight: 6 }}>#{leader.playerNumber}</span>
          ) : null}
          {leader.playerName}
        </div>
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 900,
          color: '#fff',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          flex: 'none',
          marginLeft: 'auto',
        }}
      >
        {leader.value}
      </div>
    </div>
  );
}

/**
 * Map the auto Player-of-the-Game (P1-C) into the `Spotlight` shape the
 * broadcast lower-third already renders, so the POTG fallback reuses one
 * presentational component (no second layout to drift). The number rides into
 * the subtitle line ("#23 — top performer"); the headline becomes the title's
 * supporting text and the weighted stat `lines[]` carry straight through.
 */
export function spotFromPotg(potg: PlayerOfGame): Spotlight {
  const numTag = potg.number ? `#${potg.number}` : '';
  const subtitle = [numTag, potg.headline].filter(Boolean).join('  ·  ');
  return {
    visible: true,
    title: potg.name,
    photoUrl: potg.photoUrl,
    subtitle: subtitle || undefined,
    lines: potg.lines,
  };
}

/**
 * The spotlight rendered as a broadcast lower-third — photo + name + up to
 * three stat columns. Animates up from below. Same `Spotlight` data the big
 * board's SpotlightBand reads; compact broadcast proportions here. The
 * `eyebrow` overline reads "SPOTLIGHT" for a manual push and
 * "PLAYER OF THE GAME" for the auto POTG fallback.
 */
function SpotlightLowerThird({ spot, eyebrow = 'SPOTLIGHT' }: { spot: Spotlight; eyebrow?: string }) {
  const lines = (spot.lines || []).filter((l) => l && (l.label || l.value)).slice(0, 3);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 92,
        minWidth: 520,
        maxWidth: 1280,
        background: 'linear-gradient(135deg, rgba(11,16,32,0.96), rgba(5,7,13,0.96))',
        borderLeft: '6px solid #6366f1',
        borderRadius: 10,
        padding: '0 26px 0 22px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: 'Inter, system-ui, sans-serif',
        animation: 'sbLowerThirdIn 0.5s cubic-bezier(.16,1,.3,1) forwards',
        willChange: 'transform, opacity',
      }}
    >
      {spot.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spot.photoUrl}
          alt=""
          style={{
            width: 64,
            height: 64,
            objectFit: 'cover',
            borderRadius: 10,
            border: '2px solid #1e2638',
            background: '#05070d',
            marginRight: 18,
            flex: 'none',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 3, color: '#818cf8' }}>
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spot.title}
        </div>
        {spot.subtitle ? (
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: '#94a3b8',
              lineHeight: 1.1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {spot.subtitle}
          </div>
        ) : null}
      </div>
      {lines.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', flex: 'none', marginLeft: 22 }}>
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: '0 18px',
                borderLeft: i > 0 ? '2px solid #1e2638' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  color: '#fff',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {l.value || '—'}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: '#64748b',
                  marginTop: 4,
                }}
              >
                {(l.label || '').toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The bug body — team blocks + clock/segment + situational strip + the
 * celebration toast. Pure presentational: it takes already-resolved,
 * already-CTS-merged data so the corner route and the broadcast canvas
 * render the exact same pixels.
 */
export function ScorebugBug({
  view,
  def,
  liveMs,
  activeCue,
  pos,
  scale,
  homeOverride = null,
  awayOverride = null,
  clean = false,
}: ScorebugBugProps) {
  const homeColor = view.homeColor || DEFAULT_HOME;
  const awayColor = view.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const cueAbove = pos.v === 'bottom';
  const sit = view.stats || {};
  const showSit = hasSituational(def, sit);
  // Meet sports (no clock) surface the live event/apparatus/hole context
  // in the center column under the segment label.
  const meetCtx = meetContextLabel(def, view);
  // Shot clock — read from the CTS-populated stats.shotClock anchor, length
  // falls back to the sport's configured full reset. Only shot-clock sports
  // (def.shotClock present) with an armed clock (len > 0) render it.
  const { ms: shotMs, len: shotLen } = useShotClock(view);
  const showShotClock = !!def.shotClock && shotLen > 0;
  // Score-pop — animate the digit on every change (board/ribbon parity).
  const homeFlip = useScoreFlip(view.homeScore);
  const awayFlip = useScoreFlip(view.awayScore);

  return (
    <>
      <style>{`
        ${SCORE_MOTION_KEYFRAMES}
        @keyframes sbCueIn {
          0% { opacity: 0; transform: translateY(${cueAbove ? '14px' : '-14px'}) scale(0.9); }
          12% { opacity: 1; transform: translateY(0) scale(1); }
          86% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(${cueAbove ? '-6px' : '6px'}) scale(1); }
        }
        @keyframes sbCleanOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes sbCleanIn  { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Clean-feed wrapper — fades the whole package OUT (opacity only, so it
          never fights the inner scale transform) when the producer cuts to a
          clean program feed (?clean=1) and back IN on resume. Scale lives on
          the inner div so a `?scale=` multiplier survives the animation. */}
      <div
        style={{
          opacity: clean ? 0 : 1,
          animation: clean
            ? 'sbCleanOut 0.4s ease-in-out forwards'
            : 'sbCleanIn 0.4s ease-in-out forwards',
          willChange: 'opacity',
          pointerEvents: 'none',
        }}
      >
       <div style={{ transform: `scale(${scale})`, transformOrigin: pos.origin }}>
        {/* celebration toast */}
        {activeCue && (
          <div
            style={{
              position: 'absolute',
              [cueAbove ? 'bottom' : 'top']: '100%',
              [pos.h]: 0,
              [cueAbove ? 'marginBottom' : 'marginTop']: 10,
              display: 'flex',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #1e2638, #0b0f1a)',
              border: '2px solid #fbbf24',
              borderRadius: 12,
              padding: '10px 18px',
              boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
              whiteSpace: 'nowrap',
              animation: 'sbCueIn 3.6s ease-in-out forwards',
            }}
          >
            {/* Vector sport mark (theme-tinted), emoji fallback — never raw
                emoji as the primary iconography (cross-platform tell). */}
            <span style={{ marginRight: 10, display: 'flex', alignItems: 'center' }}>
              <SportMark
                sport={def.key}
                fallbackEmoji={activeCue.emoji || '🎉'}
                size={30}
                color="#fbbf24"
                title={def.name}
              />
            </span>
            <span
              style={{
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: 2,
                color: '#fff',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              {(activeCue.label || activeCue.key || 'NICE!').toUpperCase()}
            </span>
          </div>
        )}

        {/* the bug */}
        <div
          style={{
            display: 'flex',
            height: 100,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <TeamBlock
            code={teamCode(view.homeTeam, homeOverride)}
            score={view.homeScore}
            scoreText={formatScore(def, view.homeScore)}
            color={homeColor}
            logoUrl={view.homeLogoUrl}
            side="home"
            flipKey={homeFlip.flipKey}
            popping={homeFlip.dir !== null}
          />

          {/* center — clock + segment */}
          <div
            style={{
              width: 150,
              background: '#070a12',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {hasClock && (
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 900,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: view.clockRunning ? '#fbbf24' : '#e2e8f0',
                }}
              >
                {fmtClock(liveMs)}
              </div>
            )}
            <div
              style={{
                // When a meet sport has live event context to show, the
                // segment label steps down so the event/apparatus line is
                // the prominent datum (the board does the same).
                fontSize: hasClock ? 14 : meetCtx ? 18 : 30,
                fontWeight: 800,
                letterSpacing: 2,
                color: hasClock ? '#64748b' : meetCtx ? '#94a3b8' : '#e2e8f0',
                marginTop: hasClock ? 4 : 0,
              }}
            >
              {segmentLabel(def, view)}
            </div>
            {/* Shot clock — broadcast convention: a small amber/red second
                countdown under the segment label for basketball / lacrosse /
                water polo. Reads stats.shotClock (CTS-populated). */}
            {showShotClock && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: 3,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 2,
                    color: '#64748b',
                    marginRight: 5,
                  }}
                >
                  SHOT
                </span>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    color: shotMs <= 5000 ? '#ef4444' : '#e2e8f0',
                  }}
                >
                  {shotMs <= 5000 ? (shotMs / 1000).toFixed(1) : Math.ceil(shotMs / 1000)}
                </span>
              </div>
            )}
            {meetCtx && (
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: 1,
                  color: '#fbbf24',
                  marginTop: 3,
                  maxWidth: 138,
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {meetCtx}
              </div>
            )}
          </div>

          <TeamBlock
            code={teamCode(view.awayTeam, awayOverride)}
            score={view.awayScore}
            scoreText={formatScore(def, view.awayScore)}
            color={awayColor}
            logoUrl={view.awayLogoUrl}
            side="away"
            flipKey={awayFlip.flipKey}
            popping={awayFlip.dir !== null}
          />
        </div>

        {/* situational strip — down & distance, base / ball / strike,
            timeout pips. Same shared renderer the in-venue board and
            the scoreboard widget use, in a compact pill below the bug
            so a broadcast viewer gets the full live game state. */}
        {showSit && (
          <div
            style={{
              marginTop: 6,
              background: 'linear-gradient(135deg, #1e2638, #0b0f1a)',
              border: '1.5px solid #2a3650',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
            }}
          >
            <SituationalRow
              def={def}
              stats={sit}
              h={230}
              accent="#fbbf24"
              ink="#ffffff"
              dim="#64748b"
              hairline="transparent"
            />
          </div>
        )}
       </div>
      </div>
    </>
  );
}

function TeamBlock({
  code,
  score,
  scoreText,
  color,
  logoUrl,
  side,
  flipKey = 0,
  popping = false,
}: {
  code: string;
  /** Raw scaled score — kept for parity; never rendered when
   *  `scoreText` is supplied. */
  score: number;
  /** Pre-formatted display string (decimals for judged sports). */
  scoreText?: string;
  color: string;
  logoUrl: string | null;
  side: 'home' | 'away';
  /** Incrementing key from useScoreFlip — remounts the digit so the CSS
   *  score-pop replays on every change. */
  flipKey?: number;
  /** Whether the score has changed at least once (suppresses the pop on the
   *  cold-boot first paint). */
  popping?: boolean;
}) {
  const name = (
    <div
      style={{
        width: 158,
        background: color,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          style={{
            width: 48,
            height: 48,
            objectFit: 'contain',
            marginBottom: 2,
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <span
        style={{
          fontSize: logoUrl ? 19 : 26,
          fontWeight: 900,
          letterSpacing: 1,
          color: '#fff',
          textShadow: '0 2px 6px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {code}
      </span>
    </div>
  );
  const scoreBox = (
    <div
      style={{
        width: 82,
        background: '#11161f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        key={flipKey}
        style={{
          fontSize: 46,
          fontWeight: 900,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          display: 'inline-block',
          animation: popping ? SCORE_POP_ANIM : undefined,
          willChange: 'transform',
        }}
      >
        {scoreText ?? score}
      </span>
    </div>
  );
  // Home: NAME | SCORE   ·   Away: SCORE | NAME (mirrored).
  return side === 'home' ? (
    <>
      {name}
      {scoreBox}
    </>
  ) : (
    <>
      {scoreBox}
      {name}
    </>
  );
}

// ── transparency CSS (shared by both routes) ────────────────────

/**
 * Clears the document background + hides the dashboard's decorative
 * top gradient so only the bug composites over the livestream video.
 * OBS also zeroes the body itself, so the bug composites cleanly.
 */
export const ScorebugTransparentCss = (
  <style>{`
    html, body { background: transparent !important; }
    main > [class~="-z-10"] { display: none !important; }
  `}</style>
);

// ── full broadcast-canvas overlay ───────────────────────────────

export interface BroadcastOverlayProps {
  gameId: string;
  /** Corner to dock the bug into within the 1920×1080 canvas. */
  pos: { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string };
  /** Size multiplier on the bug (applied on top of canvas scale). */
  scale: number;
  homeOverride?: string | null;
  awayOverride?: string | null;
  /** Optional accent override (brand-shim themeable). Falls back to
   *  the team colors baked into the bug when unset. Reserved for a
   *  future theme pass — currently only used to tint the canvas guide
   *  in dev. */
  accent?: string | null;
  /** Clean feed — hide the whole package (bug + sponsor + lower-thirds),
   *  animated, so a producer can cut to a clean program feed for replays /
   *  interviews WITHOUT taking the browser-source off (which would also kill
   *  the sponsor-impression story). Driven by the route's `?clean=1`. */
  clean?: boolean;
}

/**
 * The broadcast-overlay surface used by /overlay/[gameId].
 *
 * Unlike the corner bug (which docks to the live VIEWPORT edges and
 * therefore drifts as the OBS output resolution changes), this wraps
 * the bug in a fixed 1920×1080 canvas and transform:scales the whole
 * canvas to the browser-source size — so a producer who sets their
 * source to 1280×720 or 3840×2160 gets the bug in the same relative
 * spot at the same relative size as the 1080p reference. This is the
 * SAME transform:scale pattern the in-venue /board page uses.
 *
 * Returns nothing visible until live data arrives — an OBS overlay
 * must never flash a loading / error box onto a live broadcast.
 */
export function BroadcastOverlay({
  gameId,
  pos,
  scale,
  homeOverride = null,
  awayOverride = null,
  clean = false,
}: BroadcastOverlayProps) {
  const { data, def, view, liveMs, activeCue } = useScorebugData(gameId);
  const [vp, setVp] = useState({ w: 1920, h: 1080 });

  // Measure the browser-source viewport for fit-to-canvas scaling.
  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 1080 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const canvasScale = useMemo(() => Math.min(vp.w / 1920, vp.h / 1080), [vp]);

  // Pre-data / unknown sport → render only the transparency CSS. Never
  // paint a placeholder over a live stream.
  if (!data || !def || !view) return ScorebugTransparentCss;

  // The padding pulls the bug off the literal canvas edge — broadcast
  // "title safe" margin so it isn't clipped by an overscanning display.
  const padded: CSSProperties = {
    position: 'absolute',
    [pos.v]: 0,
    [pos.h]: 0,
    padding: 48,
    zIndex: 2147483000,
  };

  return (
    <>
      {ScorebugTransparentCss}
      {/* fixed broadcast canvas, scaled to the browser-source size */}
      <div
        style={{
          position: 'absolute',
          width: 1920,
          height: 1080,
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${canvasScale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* The PACKAGE that rides the canvas edges: rotating sponsor strap +
            spotlight lower-third + T2-5 live overlay. Same payload, no second
            fetch. Pins itself to the canvas, so it sits OUTSIDE the bug's
            corner-padded box. Hidden on a clean feed. */}
        <ScorebugExtras view={view} def={def} pos={pos} scale={scale} clean={clean} />
        <div style={padded}>
          <ScorebugBug
            view={view}
            def={def}
            liveMs={liveMs}
            activeCue={activeCue}
            pos={pos}
            scale={scale}
            homeOverride={homeOverride}
            awayOverride={awayOverride}
            clean={clean}
          />
        </div>
      </div>
    </>
  );
}
