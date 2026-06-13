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
import {
  SituationalRow,
  hasSituational,
} from '@/components/widgets/v2/_shared/sports-situational';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
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
  return `${def.segment.name.toUpperCase()} ${n}`;
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
}

/**
 * Read the scorebug display options from `window.location.search`.
 *
 * `defaultPos` differs per surface: the corner-bug route defaults to
 * lower-left ('bl'), the broadcast overlay to lower-right ('br', the
 * broadcast scorebug convention). The first paint (pre-effect) uses
 * the default; the effect reconciles to the URL on mount.
 */
export function useScorebugQuery(defaultPos: CornerKey): ScorebugQuery {
  const [q, setQ] = useState<ScorebugQuery>(() => ({
    pos: POS[defaultPos],
    scale: 1,
    homeOverride: null,
    awayOverride: null,
    theme: null,
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const posKey = (sp.get('pos') || defaultPos) as CornerKey;
    const scaleRaw = parseFloat(String(sp.get('scale') || '1'));
    setQ({
      pos: POS[posKey] || POS[defaultPos],
      scale: Number.isFinite(scaleRaw) ? Math.min(4, Math.max(0.4, scaleRaw)) : 1,
      homeOverride: sp.get('home') || null,
      awayOverride: sp.get('away') || null,
      theme: sp.get('theme') || null,
    });
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
}: ScorebugBugProps) {
  const homeColor = view.homeColor || DEFAULT_HOME;
  const awayColor = view.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const cueAbove = pos.v === 'bottom';
  const sit = view.stats || {};
  const showSit = hasSituational(def, sit);

  return (
    <>
      <style>{`
        @keyframes sbCueIn {
          0% { opacity: 0; transform: translateY(${cueAbove ? '14px' : '-14px'}) scale(0.9); }
          12% { opacity: 1; transform: translateY(0) scale(1); }
          86% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(${cueAbove ? '-6px' : '6px'}) scale(1); }
        }
      `}</style>

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
            <span style={{ fontSize: 30, marginRight: 10 }}>{activeCue.emoji || '🎉'}</span>
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
            color={homeColor}
            logoUrl={view.homeLogoUrl}
            side="home"
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
                fontSize: hasClock ? 14 : 30,
                fontWeight: 800,
                letterSpacing: 2,
                color: hasClock ? '#64748b' : '#e2e8f0',
                marginTop: hasClock ? 4 : 0,
              }}
            >
              {segmentLabel(def, view)}
            </div>
          </div>

          <TeamBlock
            code={teamCode(view.awayTeam, awayOverride)}
            score={view.awayScore}
            color={awayColor}
            logoUrl={view.awayLogoUrl}
            side="away"
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
    </>
  );
}

function TeamBlock({
  code,
  score,
  color,
  logoUrl,
  side,
}: {
  code: string;
  score: number;
  color: string;
  logoUrl: string | null;
  side: 'home' | 'away';
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
        style={{
          fontSize: 46,
          fontWeight: 900,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {score}
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
          />
        </div>
      </div>
    </>
  );
}
