'use client';

/**
 * @cms — Colorado Time Systems (CTS) ribbon widget set.
 *
 * Composable widgets for building a custom water-polo ribbon board fed
 * by the CTS Gen 6 console. Sibling of CtsScoreboard.tsx (which is the
 * all-in-one "drop one widget on the ribbon and you're done" tile);
 * these widgets let an operator compose their own layout — clock here,
 * score there, sponsor rotator middle, player announcements right.
 *
 * Every widget reads from the same source: a `useCtsGameState()` hook
 * that subscribes to the `edu:cts-game-state` window CustomEvent that
 * the player page (apps/web/src/app/player/page.tsx) dispatches when
 * a GAME_STATE message arrives over the signed-WS channel. The bridge
 * → API → WS pipeline is in CtsBridge.tsx / @cms/scoreboard-cts.
 *
 * Falls back to a SAMPLE snapshot when no bridge is connected so the
 * builder canvas + gallery thumbnails are always alive (operator can
 * still see what the widget looks like without driving the ribbon
 * from a real CTS console).
 *
 * Vertical-gated: every variant in variants-register.ts that maps to
 * these widgets is tagged `vertical: 'SPORTS'`, so non-sports tenants
 * never see them in the palette.
 *
 * Chromium-safe — long-hand position sides only, per-child margins
 * (no flex gap), no container query units, no CSS shorthand position.
 * CtsBridge itself requires Web Serial (Chrome 89+) and never ships
 * to Taurus, but these widgets can still render on a Taurus-driven
 * ribbon if the API broadcasts game state — so the styles stay
 * conservative. See CLAUDE.md rule #10.
 *
 * Three classes of widget:
 *
 *  1. CTS-FED — clock / score / period / exclusion / shot clock /
 *     horn-flash. Pure subscribers to the bridge feed.
 *
 *  2. OPERATOR-CONFIGURED — sponsor rotator + player announcement
 *     ticker. Pull from the widget's config (no live feed needed).
 *     Lets the operator pre-build their game-day sponsor lineup
 *     in the editor weeks before the match.
 *
 *  3. AUTO-CELEBRATION — celebration widget that idles on a "GO
 *     TEAM" loop and pulses into a 5-second celebration sequence
 *     when a goal-delta is detected (homeScore or awayScore went
 *     up between snapshots) OR when the horn fires.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── Shared snapshot shape + sample state ──────────────────────────

export interface CtsExclusionLite {
  playerJersey: number;
  secondsRemaining: number;
}

export interface CtsRibbonSnapshot {
  clock: string;
  period: number;
  homeScore: number;
  awayScore: number;
  homeShotClock: string;
  awayShotClock: string;
  homeExclusions: CtsExclusionLite[];
  awayExclusions: CtsExclusionLite[];
  horn: boolean;
  receivedAt: number;
}

const SAMPLE: CtsRibbonSnapshot = {
  clock: '7:42',
  period: 3,
  homeScore: 4,
  awayScore: 3,
  homeShotClock: '24',
  awayShotClock: '',
  homeExclusions: [],
  awayExclusions: [{ playerJersey: 7, secondsRemaining: 12 }],
  horn: false,
  receivedAt: 0,
};

// Neutral state for a LIVE ribbon with no bridge feed yet — empty
// arrays, 0:00 clock. The render special-cases scores + clock to a dash
// (via the `neutral` flag) so nothing reads as a fabricated game.
const NEUTRAL_SNAPSHOT: CtsRibbonSnapshot = {
  clock: '0:00',
  period: 1,
  homeScore: 0,
  awayScore: 0,
  homeShotClock: '',
  awayShotClock: '',
  homeExclusions: [],
  awayExclusions: [],
  horn: false,
  receivedAt: 0,
};

// ─── Shared hook: subscribe to the live CTS feed ───────────────────

/**
 * Subscribe to the player page's bridged CTS feed. The player page
 * dispatches an `edu:cts-game-state` window CustomEvent per GAME_STATE
 * WS message; we listen, coerce the shape defensively, and return the
 * latest snapshot. When no bridge is connected (or in builder preview),
 * returns null and the caller should fall back to SAMPLE.
 *
 * `live` flag = a real bridge event has arrived. `neutral` flag (audit
 * P1, 2026-06-13) = this is a LIVE player surface (`isLiveSurface`, set
 * from the WidgetRenderer `live` prop) that has NO feed yet — the caller
 * must render dashes, not the fabricated SAMPLE. The OLD code keyed only
 * on `live` (event arrived?) and so showed SAMPLE on a live board with
 * no feed, indistinguishable from a real score save an 8px grey dot.
 */
function useCtsGameState(isLiveSurface = false): { snap: CtsRibbonSnapshot; live: boolean; neutral: boolean } {
  const [snap, setSnap] = useState<CtsRibbonSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      const d = detail as Partial<CtsRibbonSnapshot>;
      setSnap({
        clock: typeof d.clock === 'string' ? d.clock : '0:00',
        period: typeof d.period === 'number' ? d.period : 1,
        homeScore: typeof d.homeScore === 'number' ? d.homeScore : 0,
        awayScore: typeof d.awayScore === 'number' ? d.awayScore : 0,
        homeShotClock: typeof d.homeShotClock === 'string' ? d.homeShotClock : '',
        awayShotClock: typeof d.awayShotClock === 'string' ? d.awayShotClock : '',
        homeExclusions: Array.isArray(d.homeExclusions) ? d.homeExclusions as CtsExclusionLite[] : [],
        awayExclusions: Array.isArray(d.awayExclusions) ? d.awayExclusions as CtsExclusionLite[] : [],
        horn: typeof d.horn === 'boolean' ? d.horn : false,
        receivedAt: typeof d.receivedAt === 'number' ? d.receivedAt : Date.now(),
      });
    };
    window.addEventListener('edu:cts-game-state', onUpdate);
    return () => window.removeEventListener('edu:cts-game-state', onUpdate);
  }, []);

  // Live surface (player) with no event yet → neutral snapshot + flag.
  // Builder / thumbnail → SAMPLE so the tile is alive.
  const neutral = isLiveSurface && snap === null;
  const resolved = snap ?? (isLiveSurface ? NEUTRAL_SNAPSHOT : SAMPLE);
  return { snap: resolved, live: snap !== null, neutral };
}

/** A dash for a live-no-data value. Keeps every widget consistent. */
const N_VALUE = '—';
const N_CLOCK = '—:—';

// ─── Shared layout primitives ──────────────────────────────────────

/**
 * Measure parent height. Most ribbon widgets size their fonts off the
 * zone's height so they look right at any ribbon segment ratio.
 */
function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState<number>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setH(el.offsetHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, h };
}

/** Period label: Q1..Q4 / OT1.. for water polo and most clock sports. */
function periodLabel(p: number): string {
  if (!Number.isFinite(p) || p < 1) return 'Q1';
  if (p >= 5) {
    const ot = p - 4;
    return ot === 1 ? 'OT' : `OT${ot}`;
  }
  return `Q${p}`;
}

function pad2(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '00';
  return n < 10 ? `0${n}` : String(n);
}

/** Outer container all widgets share — absolute fill, ink-on-dark by default. */
const fillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '"Inter", "DM Mono", system-ui, -apple-system, sans-serif',
  color: 'white',
  boxSizing: 'border-box',
};

// ─── Shared config shapes ──────────────────────────────────────────

interface BgCfg {
  /** Solid background color. Default deep navy. */
  bgColor?: string;
  /** Tabular-figures accent. Default warm amber. */
  accentColor?: string;
  /** Hide the "live" green dot — useful when many CTS widgets sit
   *  on the same ribbon and the dot would clutter. */
  hideLiveDot?: boolean;
}

interface TeamCfg extends BgCfg {
  /** "H" / "EAGLES" / etc. Auto-uppercased + sliced to 4 chars. */
  homeAbbrev?: string;
  awayAbbrev?: string;
  /** Per-team accent — falls back to BgCfg.accentColor. */
  homeColor?: string;
  awayColor?: string;
}

function abbr(s: string | undefined, maxLen = 3): string {
  if (!s) return '';
  return s.trim().toUpperCase().slice(0, maxLen);
}

function LiveDot({ live, hideLiveDot }: { live: boolean; hideLiveDot?: boolean }) {
  if (hideLiveDot) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 6,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: live ? '#22c55e' : '#64748b',
        boxShadow: live ? '0 0 6px #22c55e' : 'none',
      }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1. CTS-FED widgets — pure subscribers to the live bridge feed.
// ═════════════════════════════════════════════════════════════════════

/**
 * CtsClockWidget — just the game clock, big tabular figures.
 * Flashes red on horn rising edge.
 */
export function CtsClockWidget({ config, live: liveSurface }: { config?: BgCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap, live, neutral } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(20, Math.round((h || 192) * 0.72));
  const color = snap.horn ? '#fca5a5' : (cfg.accentColor || '#f59e0b');

  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <span
        style={{
          fontWeight: 800,
          fontSize: fs,
          letterSpacing: 2,
          color,
          fontVariantNumeric: 'tabular-nums',
          textShadow: snap.horn
            ? '0 0 24px rgba(239,68,68,0.9)'
            : `0 0 14px ${color}55`,
          lineHeight: 1,
        }}
      >
        {neutral ? N_CLOCK : snap.clock}
      </span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/**
 * CtsScoreCombinedWidget — full "H 4 - 3 A" composite. Use this if you
 * want one widget that shows both scores + team abbrevs. For separate
 * home / away tiles use CtsScoreHomeWidget / CtsScoreAwayWidget.
 */
export function CtsScoreCombinedWidget({ config, live: liveSurface }: { config?: TeamCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap, live, neutral } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(18, Math.round((h || 192) * 0.6));
  const labelFs = Math.max(12, Math.round((h || 192) * 0.32));

  const homeAbbr = abbr(cfg.homeAbbrev) || 'H';
  const awayAbbr = abbr(cfg.awayAbbrev) || 'A';
  const homeColor = cfg.homeColor || '#93c5fd';
  const awayColor = cfg.awayColor || '#fca5a5';

  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <span style={{ color: homeColor, fontWeight: 900, fontSize: labelFs, letterSpacing: 1, marginRight: 12 }}>{homeAbbr}</span>
      <span style={{ color: 'white', fontWeight: 900, fontSize: fs, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {neutral ? N_VALUE : pad2(snap.homeScore)}
      </span>
      <span style={{ color: '#475569', fontSize: Math.round(fs * 0.7), margin: '0 14px' }}>{'-'}</span>
      <span style={{ color: 'white', fontWeight: 900, fontSize: fs, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {neutral ? N_VALUE : pad2(snap.awayScore)}
      </span>
      <span style={{ color: awayColor, fontWeight: 900, fontSize: labelFs, letterSpacing: 1, marginLeft: 12 }}>{awayAbbr}</span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/** CtsScoreHomeWidget — home score only, big digits. */
export function CtsScoreHomeWidget({ config, live: liveSurface }: { config?: TeamCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap, live, neutral } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(20, Math.round((h || 192) * 0.78));
  const labelFs = Math.max(12, Math.round((h || 192) * 0.32));
  const homeColor = cfg.homeColor || '#93c5fd';
  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <span style={{ color: homeColor, fontWeight: 900, fontSize: labelFs, letterSpacing: 1, marginRight: 12 }}>
        {abbr(cfg.homeAbbrev) || 'HOME'}
      </span>
      <span style={{ color: 'white', fontWeight: 900, fontSize: fs, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {neutral ? N_VALUE : pad2(snap.homeScore)}
      </span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/** CtsScoreAwayWidget — away score only, big digits. */
export function CtsScoreAwayWidget({ config, live: liveSurface }: { config?: TeamCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap, live, neutral } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(20, Math.round((h || 192) * 0.78));
  const labelFs = Math.max(12, Math.round((h || 192) * 0.32));
  const awayColor = cfg.awayColor || '#fca5a5';
  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <span style={{ color: awayColor, fontWeight: 900, fontSize: labelFs, letterSpacing: 1, marginRight: 12 }}>
        {abbr(cfg.awayAbbrev) || 'AWAY'}
      </span>
      <span style={{ color: 'white', fontWeight: 900, fontSize: fs, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {neutral ? N_VALUE : pad2(snap.awayScore)}
      </span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/** CtsPeriodWidget — current quarter / OT indicator. */
export function CtsPeriodWidget({ config, live: liveSurface }: { config?: BgCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap, live, neutral } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(18, Math.round((h || 192) * 0.62));
  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <span
        style={{
          fontWeight: 900,
          fontSize: fs,
          letterSpacing: 3,
          color: cfg.accentColor || '#cbd5e1',
        }}
      >
        {neutral ? N_VALUE : periodLabel(snap.period)}
      </span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/**
 * CtsExclusionWidget — active penalty (water polo: 20-second exclusion).
 * Shows the first active exclusion across both teams. Empty state shows
 * a faded "NO PENALTY" so the zone reads as intentional, not broken.
 */
interface ExclusionCfg extends TeamCfg {
  /** Which team's exclusions to surface. 'home' / 'away' / 'auto'
   *  (auto = first active across both, home priority). */
  team?: 'home' | 'away' | 'auto';
}
export function CtsExclusionWidget({ config, live: liveSurface }: { config?: ExclusionCfg; live?: boolean }) {
  const cfg = config ?? {};
  // Live surface → NEUTRAL_SNAPSHOT (empty exclusions → "NO PENALTY"),
  // never the SAMPLE's fabricated #7 exclusion.
  const { snap, live } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(16, Math.round((h || 192) * 0.42));
  const labelFs = Math.max(10, Math.round((h || 192) * 0.22));

  const team = cfg.team || 'auto';
  let active: CtsExclusionLite | undefined;
  let side: 'home' | 'away' | undefined;
  if (team === 'home') { active = snap.homeExclusions[0]; side = 'home'; }
  else if (team === 'away') { active = snap.awayExclusions[0]; side = 'away'; }
  else {
    active = snap.homeExclusions[0] || snap.awayExclusions[0];
    side = snap.homeExclusions[0] ? 'home' : 'away';
  }

  const sideColor = side === 'home' ? (cfg.homeColor || '#facc15') : (cfg.awayColor || '#fb923c');
  const sideAbbr = side === 'home'
    ? (abbr(cfg.homeAbbrev) || 'H')
    : (abbr(cfg.awayAbbrev) || 'A');

  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#1a0b1c', position: 'relative' as const }}>
      {active ? (
        <>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: Math.round(fs * 0.45),
              height: Math.round(fs * 0.45),
              borderRadius: '50%',
              background: sideColor,
              boxShadow: `0 0 10px ${sideColor}`,
              marginRight: 10,
              verticalAlign: 'middle',
            }}
          />
          <span style={{ color: sideColor, fontWeight: 900, fontSize: labelFs, letterSpacing: 1, marginRight: 8 }}>
            {sideAbbr}
          </span>
          <span style={{ color: 'white', fontWeight: 800, fontSize: fs, fontVariantNumeric: 'tabular-nums', marginRight: 10 }}>
            #{active.playerJersey}
          </span>
          <span style={{ color: '#cbd5e1', fontWeight: 700, fontSize: Math.round(fs * 0.78) }}>
            {active.secondsRemaining}s
          </span>
        </>
      ) : (
        <span style={{ color: '#475569', fontWeight: 800, fontSize: labelFs, letterSpacing: 2 }}>
          NO PENALTY
        </span>
      )}
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/**
 * CtsShotClockWidget — 30-second possession clock (water polo).
 * Shows "PARKED" when the shot clock is empty.
 */
interface ShotClockCfg extends TeamCfg { team?: 'home' | 'away' | 'either'; }
export function CtsShotClockWidget({ config, live: liveSurface }: { config?: ShotClockCfg; live?: boolean }) {
  const cfg = config ?? {};
  // Live surface → NEUTRAL_SNAPSHOT (empty shot clocks → parked "—"),
  // never the SAMPLE's fabricated "24".
  const { snap, live } = useCtsGameState(liveSurface === true);
  const { ref, h } = useMeasuredHeight();
  const fs = Math.max(20, Math.round((h || 192) * 0.7));
  const labelFs = Math.max(10, Math.round((h || 192) * 0.22));

  const team = cfg.team || 'either';
  const value = team === 'home' ? snap.homeShotClock
    : team === 'away' ? snap.awayShotClock
    : (snap.homeShotClock || snap.awayShotClock || '');

  const parked = !value || value === '0';
  const danger = !parked && Number(value) <= 5;

  return (
    <div ref={ref} style={{ ...fillStyle, background: cfg.bgColor || '#0f172a', position: 'relative' as const }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: labelFs, letterSpacing: 2, marginBottom: 4 }}>
          SHOT CLK
        </span>
        <span
          style={{
            color: parked ? '#475569' : (danger ? '#ef4444' : (cfg.accentColor || '#facc15')),
            fontWeight: 900,
            fontSize: fs,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            textShadow: danger ? '0 0 12px rgba(239,68,68,0.7)' : 'none',
          }}
        >
          {parked ? '—' : value}
        </span>
      </div>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
    </div>
  );
}

/**
 * CtsHornFlashWidget — visible accent that pulses red when the horn
 * fires. Useful as a small overlay tile so referees + crowd see the
 * horn even if their head is turned from the buzzer.
 */
export function CtsHornFlashWidget({ config, live: liveSurface }: { config?: BgCfg; live?: boolean }) {
  const cfg = config ?? {};
  const { snap } = useCtsGameState(liveSurface === true);
  const horn = snap.horn === true;
  return (
    <div
      style={{
        ...fillStyle,
        background: horn ? '#ef4444' : (cfg.bgColor || '#1e1b1b'),
        transition: 'background 80ms ease-out',
        position: 'relative' as const,
      }}
    >
      <span
        style={{
          color: 'white',
          fontWeight: 900,
          fontSize: 'clamp(18px, 6vw, 64px)',
          letterSpacing: 4,
          opacity: horn ? 1 : 0.18,
          textShadow: horn ? '0 0 14px rgba(0,0,0,0.6)' : 'none',
        }}
      >
        HORN
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 2. OPERATOR-CONFIGURED widgets — pulled from widget config, not feed.
//
// Each widget supports TWO data sources via `dataSource` in config:
//   • 'manual' (default in builder): widget reads `slots` / `entries`
//     from its own config; operator types entries directly.
//   • 'auto':  widget pulls live data off the public board endpoint
//     /api/v1/sports/board/:gameId. Sponsors come from the Sponsor
//     table (managed at /[schoolId]/sports/sponsors). Roster comes
//     from RosterPlayer (managed at /[schoolId]/sports/<gameId> →
//     Roster panel; bulk-import via CSV is supported there).
//
// The `gameId` is resolved automatically from the URL when the player
// page is at /ribbon/[gameId] or /board/[gameId]; can also be set
// explicitly in widget config for off-route preview.
//
// Builder preview (no URL gameId, no auto-fetch resolution): falls
// back to the SAMPLE arrays below so the canvas + thumbnails always
// render meaningful content even before the operator hooks anything
// up.
// ═════════════════════════════════════════════════════════════════════

// ─── Shared: gameId resolution + public-board fetcher ─────────────

/** Resolve the live gameId from URL or config. */
function resolveGameId(explicit?: string): string | null {
  if (explicit && explicit.length > 8) return explicit;
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/(?:ribbon|board|scorebug)\/([^/?#]+)/);
  return m ? m[1] ?? null : null;
}

/** Get the API root the same way CtsBridge does. */
function ribbonApiRoot(): string {
  if (typeof window === 'undefined') return '';
  // Same precedence as apps/web/src/app/player/page.tsx getApiRoot():
  // NEXT_PUBLIC_API_URL → window.__VENUEOS_API_URL → relative.
  const fromEnv = (process.env.NEXT_PUBLIC_API_URL as string | undefined) || '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Cast: window is augmented by the player page at runtime, but we
  // don't pull in that ambient module here to keep this file portable.
  const fromWindow = ((window as unknown) as { __VENUEOS_API_URL?: string }).__VENUEOS_API_URL;
  if (fromWindow) return fromWindow.replace(/\/$/, '');
  return '/api/v1';
}

interface RibbonBoardCue {
  id: string;
  key?: string;          // sport-celebration key (e.g. 'water-polo-goal')
  cueId?: string;        // operator-defined custom cue id
  target?: string;       // 'ALL' | 'BOARD' | 'RIBBON'
  team?: 'home' | 'away' | null;
  firedAt: string;
}

interface RibbonBoardData {
  sponsors?: Array<{
    id: string;
    name: string;
    logoUrl?: string | null;
    tagline?: string | null;
    color?: string | null;
    tier?: string | null;
    weight?: number;
    active?: boolean;
  }>;
  roster?: Array<{
    id: string;
    team: string;
    name: string;
    number?: string | null;
    position?: string | null;
    photoUrl?: string | null;
  }>;
  cues?: RibbonBoardCue[];
  homeTeam?: string;
  awayTeam?: string;
}

/**
 * Fetch /sports/board/:id every `pollMs` ms and return the JSON.
 * Returns null while the gameId is unknown (e.g. builder preview).
 * Errors are swallowed (logged once) — the consuming widget falls
 * back to its sample content rather than rendering a broken state.
 */
function useRibbonBoardData(gameId: string | null, pollMs = 30_000): RibbonBoardData | null {
  const [data, setData] = useState<RibbonBoardData | null>(null);
  useEffect(() => {
    if (!gameId) { setData(null); return; }
    let cancelled = false;
    const root = ribbonApiRoot();
    const tick = async () => {
      try {
        const url = root.endsWith('/api/v1')
          ? `${root}/sports/board/${encodeURIComponent(gameId)}`
          : `${root}/api/v1/sports/board/${encodeURIComponent(gameId)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setData(json as RibbonBoardData);
      } catch {
        // Network blip: keep stale data, retry on next tick.
      }
    };
    tick();
    const id = setInterval(tick, Math.max(5_000, pollMs));
    return () => { cancelled = true; clearInterval(id); };
  }, [gameId, pollMs]);
  return data;
}

/** One sponsor slot. Image OR text. Image preferred when both. */
export interface CtsSponsorSlot {
  /** Full URL to a sponsor logo / banner image. */
  imageUrl?: string;
  /** Fallback / overlay text (sponsor name). */
  text?: string;
  /** Display time in ms (default 6000). */
  durationMs?: number;
  /** Optional bg color for text-only slot. */
  bgColor?: string;
}

interface SponsorRotatorCfg {
  /** Where the slot list comes from:
   *   • 'manual' (default) — `slots` array below is the source of truth
   *   • 'auto' — fetched live from the tenant's Sponsor table via
   *     /api/v1/sports/board/:gameId (gameId resolved from URL or
   *     `gameId` config below). Operator manages sponsors at
   *     /[schoolId]/sports/sponsors. */
  dataSource?: 'manual' | 'auto';
  /** Override gameId (auto mode only). When unset, resolves from
   *  /ribbon/{id} or /board/{id} URL automatically. */
  gameId?: string;
  /** Ordered list of slots (manual mode). Empty → SAMPLE_SPONSORS. */
  slots?: CtsSponsorSlot[];
  /** Auto mode — restrict to sponsors with `tier` matching this
   *  literal (e.g. 'Title'). Empty = all tiers. */
  autoTierFilter?: string;
  /** Default per-slot dwell time when the slot doesn't set its own. */
  defaultDurationMs?: number;
  /** Optional header label rendered above the slot ("OUR SPONSORS"). */
  zoneLabel?: string;
  /** Solid background. Default deep slate. */
  bgColor?: string;
}

const SAMPLE_SPONSORS: CtsSponsorSlot[] = [
  { text: 'YOUR SPONSOR HERE', durationMs: 4500, bgColor: '#1e293b' },
  { text: 'BOOK NEXT GAME AT YOUR-CLUB.COM', durationMs: 4500, bgColor: '#0c4a6e' },
  { text: 'PROUD PARTNER · POOL SUPPLY CO', durationMs: 4500, bgColor: '#312e81' },
];

/**
 * CtsSponsorRotatorWidget — operator-managed sponsor rotation.
 * Crossfades between slots. Click-through tracked via a window
 * localStorage counter, same pattern as HouseAdsBannerWidget.
 *
 * In the builder this defaults to SAMPLE_SPONSORS so the operator can
 * see the rotation working without configuring it. The Properties
 * panel surfaces the `slots` array as an editable list.
 */
export function CtsSponsorRotatorWidget({ config }: { config?: SponsorRotatorCfg }) {
  const cfg = config ?? {};
  const isAuto = cfg.dataSource === 'auto';
  const gameId = isAuto ? resolveGameId(cfg.gameId) : null;
  const board = useRibbonBoardData(gameId);

  // Resolve the effective slot list:
  //   • auto + board available → map Sponsor rows → slots (filtered by tier)
  //   • manual + cfg.slots set → cfg.slots
  //   • otherwise → SAMPLE_SPONSORS so the builder + offline state always renders
  const slots = useMemo<CtsSponsorSlot[]>(() => {
    if (isAuto && board && Array.isArray(board.sponsors) && board.sponsors.length) {
      let pool = board.sponsors.filter((s) => s.active !== false);
      if (cfg.autoTierFilter && cfg.autoTierFilter.trim()) {
        const t = cfg.autoTierFilter.trim().toLowerCase();
        pool = pool.filter((s) => (s.tier || '').toLowerCase() === t);
      }
      if (!pool.length) return SAMPLE_SPONSORS;
      // Expand by `weight` (Title sponsor with weight 3 takes 3 slots).
      const expanded: CtsSponsorSlot[] = [];
      for (const s of pool) {
        const reps = Math.max(1, Math.min(8, s.weight ?? 1));
        for (let i = 0; i < reps; i++) {
          expanded.push({
            imageUrl: s.logoUrl || undefined,
            text: s.logoUrl ? undefined : s.name,
            bgColor: s.color || undefined,
            durationMs: cfg.defaultDurationMs || 6000,
          });
        }
      }
      return expanded;
    }
    if (cfg.slots && cfg.slots.length > 0) return cfg.slots;
    return SAMPLE_SPONSORS;
  }, [isAuto, board, cfg.slots, cfg.autoTierFilter, cfg.defaultDurationMs]);

  const defaultDuration = cfg.defaultDurationMs || 6000;
  const [idx, setIdx] = useState(0);
  const { ref, h } = useMeasuredHeight();

  useEffect(() => {
    if (slots.length <= 1) return;
    const cur = slots[idx];
    const dur = (cur && cur.durationMs) || defaultDuration;
    const t = setTimeout(() => setIdx((i) => (i + 1) % slots.length), Math.max(1500, dur));
    return () => clearTimeout(t);
  }, [idx, slots, defaultDuration]);

  const slot = slots[idx] ?? slots[0];
  const labelFs = Math.max(10, Math.round((h || 192) * 0.14));
  // Pump the text size up so it FILLS the zone like the scoreboard
  // does. Operator (2026-05-26) called out the previous render: "score
  // looks good full screen but my content i loaded is tiny, i thought
  // we fixed this so that it takes up the full screen always same as
  // the score". 0.65 of zone height eats the whole zone for text;
  // images use width/height:100% so small logos stretch UP to fill.
  const textFs = Math.max(20, Math.round((h || 192) * 0.55));

  return (
    <div
      ref={ref}
      style={{
        ...fillStyle,
        background: slot?.bgColor || cfg.bgColor || '#1e293b',
        display: 'flex',
        flexDirection: 'column',
        padding: cfg.zoneLabel ? '6px 12px 8px' : '0',
        transition: 'background 400ms ease',
        position: 'relative' as const,
      }}
    >
      {cfg.zoneLabel && (
        <span
          style={{
            color: '#cbd5e1',
            fontSize: labelFs,
            fontWeight: 700,
            letterSpacing: 3,
            opacity: 0.7,
            marginBottom: 2,
            flexShrink: 0,
          }}
        >
          {cfg.zoneLabel}
        </span>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 0 }}>
        {slot?.imageUrl ? (
          // Image slot — fill the zone. width/height: 100% so the IMG
          // element fills the container; objectFit: contain so the
          // image inside scales to fit while preserving aspect ratio.
          // (Previous max-width/max-height only capped the image —
          // small intrinsic logos stayed small, leaving the zone half
          // empty.)
          <img
            src={slot.imageUrl}
            alt={slot.text || 'Sponsor'}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
            onError={(e) => {
              // Bad URL: hide the broken image and let the text fall
              // back. Common when an asset gets deleted mid-game.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span
            style={{
              color: 'white',
              fontWeight: 900,
              fontSize: textFs,
              letterSpacing: 1,
              textAlign: 'center',
              lineHeight: 1.0,
              padding: '0 12px',
            }}
          >
            {slot?.text || ''}
          </span>
        )}
      </div>
    </div>
  );
}

/** One announcement entry — text + optional duration. */
export interface CtsAnnouncementEntry {
  text: string;
  /** Display time in ms. Default 5000. */
  durationMs?: number;
}

interface AnnouncementCfg {
  /** Where entries come from:
   *   • 'manual' (default) — `entries` below is the source of truth
   *   • 'auto' — auto-generated from the current game's roster via
   *     /api/v1/sports/board/:gameId. Use this to do team introductions
   *     during pre-game — operator just curates the roster at
   *     /[schoolId]/sports/<gameId> → Roster panel and the ribbon
   *     auto-rolls "NOW INTRODUCING #7 J. RIVERA · DRIVER" through
   *     every starter. */
  dataSource?: 'manual' | 'auto';
  /** Override gameId (auto mode only). Resolves from URL when unset. */
  gameId?: string;
  /** Auto mode — entry templates. Each template is formatted per
   *  player with these tokens replaced:
   *    {abbrev}  — home/away (H/A)
   *    {number}  — jersey
   *    {name}    — player name
   *    {nameLast}— last name only
   *    {position}— position
   *    {team}    — full team name (Eagles / Cougars)
   *  Default templates produce a team-intro reel: starting lineup +
   *  per-player intro lines + a closing "GO {team}" cheer. Operator
   *  can override these per ribbon. */
  autoTemplates?: {
    /** One line listing all home jersey numbers ("HOME — 1, 7, 11..."). */
    homeLineup?: string;
    /** One line listing all away jersey numbers. */
    awayLineup?: string;
    /** Per-player template (fires once per player). */
    perPlayer?: string;
    /** Closing cheer template. */
    closer?: string;
  };
  /** Auto mode — entry dwell time per template (default 4000). */
  autoDurationMs?: number;
  /** Ordered list of entries (manual mode). Empty → SAMPLE_ANNOUNCEMENTS. */
  entries?: CtsAnnouncementEntry[];
  /** Per-entry dwell when the entry doesn't set its own. */
  defaultDurationMs?: number;
  /** Optional header label ("PLAYER OF THE GAME", "NEXT MATCH", etc). */
  zoneLabel?: string;
  /** Solid background. Default deep slate. */
  bgColor?: string;
  /** Accent for the header label. */
  accentColor?: string;
}

/** Default per-game intro templates for the auto data source. */
const DEFAULT_AUTO_TEMPLATES = {
  homeLineup: 'HOME LINEUP — {team} · {numbers}',
  awayLineup: 'AWAY LINEUP — {team} · {numbers}',
  perPlayer: 'NOW IN · #{number} {name}',
  closer: "LET'S GO {team}!",
} as const;

function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? vars[k] ?? '' : `{${k}}`));
}

const SAMPLE_ANNOUNCEMENTS: CtsAnnouncementEntry[] = [
  { text: 'STARTING LINEUP — H 1, 7, 11, 12, 4, 8, 9', durationMs: 6000 },
  { text: 'NEXT HOME MATCH — FRI 7:00 PM · AQUATIC CENTER', durationMs: 6000 },
  { text: 'PLAYER OF THE WEEK — #7 J. RIVERA · 4 GOALS', durationMs: 6000 },
  { text: 'CONCESSIONS OPEN ON MEZZANINE — CASH OR CARD', durationMs: 5000 },
];

/**
 * CtsAnnouncementWidget — rotating player / event announcement ticker.
 * Pure operator config — no live feed needed. Operator pre-builds the
 * announcement queue in the editor (typically the morning of the match
 * or even weeks ahead), the player rotates through them on the ribbon
 * during the game. Slide-up crossfade between entries.
 */
export function CtsAnnouncementWidget({ config }: { config?: AnnouncementCfg }) {
  const cfg = config ?? {};
  const isAuto = cfg.dataSource === 'auto';
  const gameId = isAuto ? resolveGameId(cfg.gameId) : null;
  const board = useRibbonBoardData(gameId);

  // Resolve the effective entry list:
  //   • auto + roster available → generate intros from templates
  //   • manual + cfg.entries set → cfg.entries
  //   • otherwise → SAMPLE_ANNOUNCEMENTS so editor preview renders
  const entries = useMemo<CtsAnnouncementEntry[]>(() => {
    if (isAuto && board && Array.isArray(board.roster) && board.roster.length) {
      const tpls = { ...DEFAULT_AUTO_TEMPLATES, ...(cfg.autoTemplates || {}) };
      const dur = cfg.autoDurationMs || 4000;
      const home = board.roster.filter((p) => p.team !== 'away');
      const away = board.roster.filter((p) => p.team === 'away');
      const homeTeam = board.homeTeam || 'HOME';
      const awayTeam = board.awayTeam || 'AWAY';
      const homeNums = home.map((p) => `#${p.number || '—'}`).join(' · ') || '—';
      const awayNums = away.map((p) => `#${p.number || '—'}`).join(' · ') || '—';
      const out: CtsAnnouncementEntry[] = [];
      // Lineup overview entries.
      if (tpls.homeLineup) {
        out.push({
          text: applyTemplate(tpls.homeLineup, { abbrev: 'H', team: homeTeam, numbers: homeNums }),
          durationMs: dur,
        });
      }
      if (tpls.awayLineup) {
        out.push({
          text: applyTemplate(tpls.awayLineup, { abbrev: 'A', team: awayTeam, numbers: awayNums }),
          durationMs: dur,
        });
      }
      // Per-player intro entries (interleave home/away for crowd
      // energy: H1, A1, H2, A2, …). Cap at 24 total so the reel
      // doesn't run all game.
      if (tpls.perPlayer) {
        const maxLen = Math.max(home.length, away.length);
        for (let i = 0; i < maxLen && out.length < 24 + 2; i++) {
          for (const [side, list, teamName] of ([['home', home, homeTeam], ['away', away, awayTeam]] as const)) {
            const p = list[i];
            if (!p) continue;
            const name = p.name || 'PLAYER';
            const last = name.split(' ').slice(-1)[0] || name;
            out.push({
              text: applyTemplate(tpls.perPlayer, {
                abbrev: side === 'home' ? 'H' : 'A',
                number: p.number || '—',
                name: name.toUpperCase(),
                nameLast: last.toUpperCase(),
                position: (p.position || '').toUpperCase(),
                team: teamName,
              }),
              durationMs: dur,
            });
          }
        }
      }
      if (tpls.closer) {
        out.push({ text: applyTemplate(tpls.closer, { team: homeTeam }), durationMs: dur });
      }
      return out.length ? out : SAMPLE_ANNOUNCEMENTS;
    }
    if (cfg.entries && cfg.entries.length > 0) return cfg.entries;
    return SAMPLE_ANNOUNCEMENTS;
  }, [isAuto, board, cfg.entries, cfg.autoTemplates, cfg.autoDurationMs]);

  const defaultDuration = cfg.defaultDurationMs || 5000;
  const [idx, setIdx] = useState(0);
  const { ref, h } = useMeasuredHeight();

  useEffect(() => {
    if (entries.length <= 1) return;
    const cur = entries[idx];
    const dur = (cur && cur.durationMs) || defaultDuration;
    const t = setTimeout(() => setIdx((i) => (i + 1) % entries.length), Math.max(1500, dur));
    return () => clearTimeout(t);
  }, [idx, entries, defaultDuration]);

  const entry = entries[idx] ?? entries[0];
  const labelFs = Math.max(10, Math.round((h || 192) * 0.14));
  // Pump font multiplier up like the sponsor widget — operator
  // (2026-05-26): "score looks good full screen but my content i
  // loaded is tiny". Announcement text now fills its zone the same
  // way the scoreboard does.
  const textFs = Math.max(18, Math.round((h || 192) * 0.56));

  return (
    <div
      ref={ref}
      style={{
        ...fillStyle,
        background: cfg.bgColor || '#0c1322',
        display: 'flex',
        flexDirection: 'column',
        padding: cfg.zoneLabel ? '6px 12px 8px' : '0 12px',
        position: 'relative' as const,
      }}
    >
      {cfg.zoneLabel && (
        <span
          style={{
            color: cfg.accentColor || '#fbbf24',
            fontSize: labelFs,
            fontWeight: 800,
            letterSpacing: 3,
            opacity: 0.85,
            marginBottom: 2,
            flexShrink: 0,
          }}
        >
          {cfg.zoneLabel}
        </span>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', width: '100%', minHeight: 0, overflow: 'hidden' }}>
        <span
          key={idx}
          style={{
            color: 'white',
            fontWeight: 900,
            fontSize: textFs,
            letterSpacing: 1,
            lineHeight: 1.0,
            display: 'inline-block',
            whiteSpace: 'nowrap',
            animation: 'ctsAnnounceIn 420ms ease-out both',
          }}
        >
          {entry?.text || ''}
        </span>
      </div>
      <style>{`@keyframes ctsAnnounceIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 3. AUTO-CELEBRATION widget — listens for goal-delta + horn.
// ═════════════════════════════════════════════════════════════════════

interface CelebrationCfg extends TeamCfg {
  /** Custom celebration text. Default "GOAL!". */
  text?: string;
  /** Active scene duration in ms after a goal-delta. Default 6000. */
  activeMs?: number;
  /** Idle loop content text. Default "GO TEAM". */
  idleText?: string;
  /** Trigger on horn rising edge too (water polo: end-of-quarter horn
   *  + goal celebrations from console). Default true. */
  hornAlsoTriggers?: boolean;
}

/**
 * CtsCelebrationWidget — pulses a celebration scene when the CTS feed
 * shows a goal-delta (homeScore or awayScore increased between
 * consecutive snapshots) or when the horn fires. Idle state shows a
 * subtle "GO TEAM" loop so the zone never reads as blank.
 *
 * The detection uses refs so two snapshots with no change don't
 * re-trigger. When triggered, the widget enters "active" mode for
 * `activeMs` then returns to idle.
 *
 * In builder preview (no live feed), the widget renders idle. Operators
 * can preview the active state via the Properties panel's "Preview
 * celebration" button which dispatches a fake event — wired in a
 * follow-up; the widget already listens to the event today.
 */
export function CtsCelebrationWidget({ config, live: liveSurface }: { config?: CelebrationCfg; live?: boolean }) {
  const cfg = config ?? {};
  const text = cfg.text || 'GOAL!';
  const idleText = cfg.idleText || 'GO TEAM';
  const activeMs = cfg.activeMs || 6000;
  const hornTriggers = cfg.hornAlsoTriggers !== false;

  // On a live surface the baseline starts from NEUTRAL_SNAPSHOT (0-0), so
  // the first real snapshot can't mis-fire a celebration off the SAMPLE
  // 4-3 jump. Builder keeps the SAMPLE.
  const { snap, live } = useCtsGameState(liveSurface === true);
  const [active, setActive] = useState<null | { team: 'home' | 'away' | 'horn'; until: number }>(null);
  const lastHomeRef = useRef<number>(snap.homeScore);
  const lastAwayRef = useRef<number>(snap.awayScore);
  const lastHornRef = useRef<boolean>(snap.horn);
  const { ref, h } = useMeasuredHeight();

  // Fire on goal-delta. Refs hold the previous value so the SAME
  // snapshot arriving twice (from server replays) doesn't re-fire.
  useEffect(() => {
    // 2026-06-15 DOUBLE-FIRE FIX — when this widget sits on a custom template
    // rendered by the LIVE board/ribbon route, that route's own CueOverlay
    // already plays the cue; firing here too animates every goal TWICE. Stand
    // down on a live surface (refs still track score so we never mis-fire on a
    // later context). Builder previews don't set the flag → still animate.
    if (!surfaceHandlesCues()) {
      if (snap.homeScore > lastHomeRef.current) {
        setActive({ team: 'home', until: Date.now() + activeMs });
      } else if (snap.awayScore > lastAwayRef.current) {
        setActive({ team: 'away', until: Date.now() + activeMs });
      } else if (hornTriggers && snap.horn && !lastHornRef.current) {
        setActive({ team: 'horn', until: Date.now() + activeMs });
      }
    }
    lastHomeRef.current = snap.homeScore;
    lastAwayRef.current = snap.awayScore;
    lastHornRef.current = snap.horn;
  }, [snap.homeScore, snap.awayScore, snap.horn, hornTriggers, activeMs]);

  // Listen for operator-fired preview events so the Properties panel
  // can show "Preview celebration" without needing a live bridge.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPreview = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const team: 'home' | 'away' | 'horn' = detail.team === 'away' ? 'away' : detail.team === 'horn' ? 'horn' : 'home';
      setActive({ team, until: Date.now() + activeMs });
    };
    window.addEventListener('edu:cts-celebration-preview', onPreview);
    return () => window.removeEventListener('edu:cts-celebration-preview', onPreview);
  }, [activeMs]);

  // Auto-revert when the active window expires.
  useEffect(() => {
    if (!active) return;
    const left = active.until - Date.now();
    if (left <= 0) { setActive(null); return; }
    const t = setTimeout(() => setActive(null), left);
    return () => clearTimeout(t);
  }, [active]);

  const isActive = !!active;
  const homeColor = cfg.homeColor || '#3b82f6';
  const awayColor = cfg.awayColor || '#ef4444';
  const teamColor = active?.team === 'away' ? awayColor : active?.team === 'horn' ? '#ef4444' : homeColor;
  const fs = Math.max(28, Math.round((h || 192) * 0.85));

  return (
    <div
      ref={ref}
      style={{
        ...fillStyle,
        background: isActive
          ? `radial-gradient(ellipse at center, ${teamColor}cc 0%, ${teamColor}66 60%, #000 110%)`
          : (cfg.bgColor || '#0a0a14'),
        transition: 'background 200ms ease',
        position: 'relative' as const,
      }}
    >
      {/* Animated burst when active */}
      {isActive && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background: `repeating-linear-gradient(135deg, ${teamColor}44 0 24px, transparent 24px 48px)`,
              animation: 'ctsCelebSweep 1.6s linear infinite',
              opacity: 0.65,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              boxShadow: `inset 0 0 60px ${teamColor}aa`,
            }}
          />
        </>
      )}
      <span
        style={{
          position: 'relative' as const,
          color: 'white',
          fontWeight: 900,
          fontSize: fs,
          letterSpacing: isActive ? 4 : 2,
          textShadow: isActive
            ? `0 0 24px ${teamColor}, 0 0 48px ${teamColor}`
            : 'none',
          opacity: isActive ? 1 : 0.55,
          textTransform: 'uppercase',
          animation: isActive ? 'ctsCelebPulse 480ms ease-in-out infinite alternate' : undefined,
          transition: 'opacity 220ms ease, letter-spacing 220ms ease',
        }}
      >
        {isActive ? text : idleText}
      </span>
      <LiveDot live={live} hideLiveDot={cfg.hideLiveDot} />
      <style>{`
        @keyframes ctsCelebPulse { from { transform: scale(1); } to { transform: scale(1.08); } }
        @keyframes ctsCelebSweep { from { background-position: 0 0; } to { background-position: 96px 0; } }
      `}</style>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4. CELEBRATION ORCHESTRATOR — fires the cinematic CEL_* library on
//    goal-delta / horn / period-change detected from the CTS feed.
// ═════════════════════════════════════════════════════════════════════
//
// Why this exists: CtsCelebrationWidget above is a SIMPLE "GOAL!" text
// pulse. The actual cinematic library (CelSoccerGoalWidget,
// CelHockeyGoalWidget, CelFootballTouchdownWidget, etc — ~50 widgets
// in apps/web/src/components/widgets/v2/Celebrations*Widgets.tsx) was
// shipping as drop-on-canvas tiles but NEVER fired automatically from
// score events. Operator (2026-05-26): "did you wire in all of our
// new celebrations? doesnt seem like those are working".
//
// The orchestrator closes that — it watches the CTS bridge feed for
// home/away goal-deltas + horn rising edges + period changes, picks
// a cue from the operator-configured deck for that event, and renders
// the matching cinematic widget full-coverage over the ribbon for N
// seconds, then auto-reverts. Operator-configurable cue deck per
// event type — so a home goal can roll through SOCCER → HOCKEY →
// LACROSSE goal scenes round-robin, never repeating the same one
// twice in a row.
//
// Operator preview: any zone with the orchestrator listens for
//   window.dispatchEvent(new CustomEvent('edu:cts-celebration-preview',
//     { detail: { team: 'home' | 'away' | 'horn', cueId?: string } }))
// so a Properties-panel "Test celebration" button (follow-up) fires
// without needing a real bridge connection.

// Static import of the cinematic library — bundled with the SPORTS
// vertical only since these widgets are SPORTS-gated end-to-end.
import { CelSoccerGoalWidget, CelSoccerGolazoWidget, CelSoccerFreeKickWidget, CelSoccerHatTrickWidget } from '../v2/CelebrationsSoccerWidgets';
import { CelHockeyGoalWidget, CelHockeyHatTrickWidget, CelHockeyPowerPlayWidget, CelHockeyEmptyNetWidget } from '../v2/CelebrationsHockeyWidgets';
import { CelFootballTouchdownWidget, CelFootballFieldGoalWidget } from '../v2/CelebrationsFootballWidgets';
import { CelBasketballThreeWidget, CelBasketballBuzzerWidget, CelBasketballDunkWidget } from '../v2/CelebrationsBasketballWidgets';
import { ScGoalRetroWidget, ScGoalNeonWidget, HkGoalNeonWidget, HkGoalRetroWidget, LxGoalWidget, LxBehindTheBackWidget, LxBigSaveWidget, TnAceWidget, TnWinnerWidget, TnMatchPointWidget, GfAceWidget, GfEagleWidget, GfBirdieWidget, TrWorldRecordWidget, TrFinishWidget, TrPersonalBestWidget, SwRecordWidget, SwFinishWidget } from '../v2/CelebrationsOtherSportsWidgets';
import { CelBaseballHomeRunWidget, CelBaseballGrandSlamWidget, CelBaseballStrikeoutWidget, CelBaseballDoublePlayWidget } from '../v2/CelebrationsBaseballWidgets';

/**
 * Available cue catalog. Operator picks cue IDs from this list to
 * build their per-event deck. Every entry is a real, shipping
 * celebration widget that already renders cleanly at any zone size
 * (sized off the `height` prop and wrapped via the
 * `withMeasuredHeight` HOC pattern further down).
 *
 * For water polo the "goal in a net" cues map cleanly even though no
 * widget is literally labeled "water polo" — a soccer / hockey /
 * lacrosse goal scene reads correctly on a water-polo ribbon and the
 * operator overrides the scorer / team / score copy via per-cue
 * config (`cueOverrides` below).
 */
const CUE_CATALOG = {
  // ─── Goal / score scenes (best for water polo + soccer + hockey) ─
  CEL_SOCCER_GOAL: { Component: CelSoccerGoalWidget, label: 'Soccer "GOOOOAL"', defaults: { scorer: 'SCORER', score: '1-0' } },
  CEL_SOCCER_GOLAZO: { Component: CelSoccerGolazoWidget, label: 'Soccer "GOLAZO"', defaults: { player: 'SCORER', kind: 'WHAT A STRIKE' } },
  CEL_SOCCER_FREEKICK: { Component: CelSoccerFreeKickWidget, label: 'Soccer Free Kick Goal', defaults: { player: 'SCORER', distance: '25 YD' } },
  CEL_SOCCER_HATTRICK: { Component: CelSoccerHatTrickWidget, label: 'Soccer Hat Trick', defaults: { player: 'SCORER', goals: ["12'", "38'", "81'"] } },
  CEL_HOCKEY_GOAL: { Component: CelHockeyGoalWidget, label: 'Hockey GOAL (red lamp)', defaults: { scorer: 'SCORER', assists: [], score: '1-0' } },
  CEL_HOCKEY_HATTRICK: { Component: CelHockeyHatTrickWidget, label: 'Hockey Hat Trick', defaults: { player: 'SCORER' } },
  CEL_HOCKEY_POWERPLAY: { Component: CelHockeyPowerPlayWidget, label: 'Hockey Power-Play Goal', defaults: { scorer: 'SCORER', strength: '6-on-5', score: '1-0' } },
  CEL_HOCKEY_EMPTYNET: { Component: CelHockeyEmptyNetWidget, label: 'Empty Net Goal', defaults: { scorer: 'SCORER', finalScore: '5-3' } },
  CEL_SC_GOAL_RETRO: { Component: ScGoalRetroWidget, label: 'Soccer Goal · Retro', defaults: { scorer: 'SCORER', minute: "42'" } },
  CEL_SC_GOAL_NEON: { Component: ScGoalNeonWidget, label: 'Soccer Goal · Neon', defaults: { scorer: 'SCORER', minute: "63'" } },
  CEL_HK_GOAL_NEON: { Component: HkGoalNeonWidget, label: 'Hockey Goal · Neon', defaults: { scorer: 'SCORER' } },
  CEL_HK_GOAL_RETRO: { Component: HkGoalRetroWidget, label: 'Hockey Goal · Retro', defaults: { scorer: 'SCORER', period: 1 } },
  CEL_LX_GOAL: { Component: LxGoalWidget, label: 'Lacrosse Goal', defaults: { scorer: 'SCORER', number: '7', score: '1-0' } },
  CEL_LX_BEHINDTHEBACK: { Component: LxBehindTheBackWidget, label: 'Behind-the-Back Goal', defaults: { player: 'SCORER', distance: '10 YD' } },
  CEL_LX_SAVE: { Component: LxBigSaveWidget, label: 'Lacrosse Big Save', defaults: { goalie: 'KEEPER', saves: 1 } },
  // ─── Baseball / softball scenes (the diamond sports) ────────────
  // Before 2026-06-13 these had NO cinematic in the CTS catalog, so
  // every baseball/softball home-run, grand-slam, strikeout, and
  // double-play fell back to the generic confetti burst. Now they get
  // their bespoke scenes (CelebrationsBaseballWidgets.tsx).
  CEL_BASEBALL_HOMERUN: { Component: CelBaseballHomeRunWidget, label: 'Baseball HOME RUN', defaults: { player: 'SLUGGER', distance: '418 FT', exitVelo: '108 MPH EXIT VELOCITY' } },
  CEL_BASEBALL_GRANDSLAM: { Component: CelBaseballGrandSlamWidget, label: 'Baseball GRAND SLAM', defaults: { player: 'SLUGGER', score: '1-0' } },
  CEL_BASEBALL_STRIKEOUT: { Component: CelBaseballStrikeoutWidget, label: 'Baseball STRIKEOUT', defaults: { pitcher: 'ACE', kCount: 1, team: 'starting rotation' } },
  CEL_BASEBALL_DOUBLEPLAY: { Component: CelBaseballDoublePlayWidget, label: 'Baseball DOUBLE PLAY', defaults: { combo: '6-4-3', players: ['SS', '2B', '1B'] } },
  // ─── Pickleball / paddle-sport scenes ───────────────────────────
  // Pickleball had ZERO cinematics. It is a paddle/racquet sport with
  // tennis-shaped scoring (serve ace, winner, game/match point), so the
  // tennis scene set reads correctly on a pickleball ribbon. Operator
  // overrides the player/score copy per cue via cueOverrides.
  CEL_PICKLEBALL_ACE: { Component: TnAceWidget, label: 'Pickleball ACE (serve)', defaults: { player: 'SERVER', speed: '', aces: 1 } },
  CEL_PICKLEBALL_WINNER: { Component: TnWinnerWidget, label: 'Pickleball WINNER (rally)', defaults: { player: 'PLAYER', shot: 'PUT-AWAY', winners: 1 } },
  CEL_PICKLEBALL_GAMEWIN: { Component: TnMatchPointWidget, label: 'Pickleball GAME / MATCH POINT', defaults: { player: 'PLAYER', score: '11-9' } },
  // ─── Meet sports (track / swim / cross-country / golf) ──────────
  // 2026-06-13 — before today no cinematic existed for ANY meet sport,
  // so firstPlace / newRecord / personalBest / eagle / birdie /
  // holeInOne fired only as a basic emoji+text slam. These reuse the
  // already-shipped meet-sport cinematics in CelebrationsOtherSportsWidgets:
  //   • Track/XC: TrWorldRecord (record), TrFinish (podium / first place),
  //               TrPersonalBest (PB).
  //   • Swimming: SwRecord (record), SwFinish (heat podium / first place).
  //   • Golf:     GfAce (hole-in-one), GfEagle, GfBirdie.
  // The operator overrides athlete / event / time / player copy per cue
  // via cueOverrides. They read correctly on any meet ribbon — XC reuses
  // the track scenes (same finish-line / record metaphor).
  CEL_TF_FIRSTPLACE: { Component: TrFinishWidget, label: 'Track/XC · First Place (podium)', defaults: { event: 'FINAL' } },
  CEL_TF_RECORD: { Component: TrWorldRecordWidget, label: 'Track/XC · New Record', defaults: { athlete: 'ATHLETE', event: 'EVENT', time: '', country: '' } },
  CEL_TF_PERSONALBEST: { Component: TrPersonalBestWidget, label: 'Track/XC · Personal Best', defaults: { athlete: 'ATHLETE', event: 'EVENT', time: '', delta: '' } },
  CEL_SW_FIRSTPLACE: { Component: SwFinishWidget, label: 'Swim · First Place (heat)', defaults: { event: 'FINAL' } },
  CEL_SW_RECORD: { Component: SwRecordWidget, label: 'Swim · New Record', defaults: { athlete: 'ATHLETE', event: 'EVENT', time: '' } },
  CEL_GOLF_HOLEINONE: { Component: GfAceWidget, label: 'Golf · HOLE-IN-ONE', defaults: { player: 'GOLFER', hole: 1, yards: 0 } },
  CEL_GOLF_EAGLE: { Component: GfEagleWidget, label: 'Golf · Eagle', defaults: { player: 'GOLFER', hole: 1, score: '' } },
  CEL_GOLF_BIRDIE: { Component: GfBirdieWidget, label: 'Golf · Birdie', defaults: { player: 'GOLFER', hole: 1, score: '' } },
  // ─── End-of-period / horn / big-moment scenes ───────────────────
  CEL_FOOTBALL_TOUCHDOWN: { Component: CelFootballTouchdownWidget, label: 'Football TOUCHDOWN', defaults: { player: 'TEAM', distance: 'END OF PERIOD', score: '' } },
  CEL_FOOTBALL_FIELDGOAL: { Component: CelFootballFieldGoalWidget, label: 'Football Field Goal', defaults: { kicker: '', distance: '' } },
  CEL_BASKETBALL_BUZZER: { Component: CelBasketballBuzzerWidget, label: 'Buzzer Beater', defaults: { player: '', clock: '0.0', kind: 'END OF PERIOD' } },
  // ─── Misc cinematic that work as a general "BIG MOMENT" ─────────
  CEL_BASKETBALL_THREE: { Component: CelBasketballThreeWidget, label: '3-Pointer (visual reuse)', defaults: { player: 'SCORER', threesTonight: 1 } },
  CEL_BASKETBALL_DUNK: { Component: CelBasketballDunkWidget, label: 'Slam Dunk (visual reuse)', defaults: { player: 'SCORER', kind: 'POSTER' } },
} as const;

export type CtsCueId = keyof typeof CUE_CATALOG;

export const CTS_CUE_IDS: CtsCueId[] = Object.keys(CUE_CATALOG) as CtsCueId[];

/** Human-readable cue labels for the Properties-panel picker. */
export const CTS_CUE_LABELS: Record<CtsCueId, string> = Object.fromEntries(
  (Object.keys(CUE_CATALOG) as CtsCueId[]).map((k) => [k, CUE_CATALOG[k].label]),
) as Record<CtsCueId, string>;

interface OrchestratorCueDeck {
  /** Cues to rotate on a home-team goal (round-robin). */
  homeGoal?: CtsCueId[];
  /** Cues to rotate on an away-team goal (round-robin). */
  awayGoal?: CtsCueId[];
  /** Cues to fire on a period change (period number increased). */
  periodEnd?: CtsCueId[];
  /** Cues to fire on a horn rising edge. */
  horn?: CtsCueId[];
}

export interface CtsCelebrationOrchestratorCfg {
  /** Per-event cue decks. Empty → sensible water-polo defaults. */
  cues?: OrchestratorCueDeck;
  /** Active scene duration in ms. Default 6000. */
  durationMs?: number;
  /** Optional team copy / colors applied to every cue (cue widgets
   *  resolve these as their `homeColor` / `awayColor` / `score`). */
  homeTeamName?: string;
  awayTeamName?: string;
  homeColor?: string;
  awayColor?: string;
  /** Per-cue config overrides (deep-merged into the cue defaults).
   *  Operator uses this to set the scorer text per cue if they want
   *  something other than the generic "SCORER" placeholder. */
  cueOverrides?: Partial<Record<CtsCueId, Record<string, unknown>>>;
  /** Disable horn-based trigger (rare — most installs want it on). */
  ignoreHorn?: boolean;
  /** Disable period-end trigger (some operators only want score-driven). */
  ignorePeriodEnd?: boolean;
}

/** Water-polo defaults — goal-in-net scenes for the score events, an
 *  end-of-period "TOUCHDOWN" / "BUZZER" for the horn + period change. */
const DEFAULT_CUE_DECK: Required<OrchestratorCueDeck> = {
  homeGoal: ['CEL_SOCCER_GOAL', 'CEL_HOCKEY_GOAL', 'CEL_LX_GOAL', 'CEL_SC_GOAL_NEON'],
  awayGoal: ['CEL_HOCKEY_GOAL', 'CEL_SOCCER_GOAL', 'CEL_HK_GOAL_RETRO', 'CEL_LX_GOAL'],
  periodEnd: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
  horn: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
};

/**
 * True while a LIVE board/ribbon route (which mounts its own CueOverlay /
 * RibbonCueOverlay) is on screen. Set by those routes; read by the embedded
 * celebration widgets so they DON'T also auto-fire the same cue — the
 * 2026-06-15 double-fire fix. Function declaration → hoisted, usable by every
 * widget in this module regardless of definition order.
 */
function surfaceHandlesCues(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as Window & { __VENUEOS_SURFACE_HANDLES_CUES?: boolean })
      .__VENUEOS_SURFACE_HANDLES_CUES
  );
}

/**
 * CtsCelebrationOrchestratorWidget — full-coverage overlay that fires
 * a cinematic celebration scene whenever the CTS feed shows a
 * goal-delta, horn, or period change. Idle = invisible
 * (pointer-events: none, opacity: 0) so the rest of the ribbon shows
 * through. Active = full-coverage cinematic for `durationMs`, then
 * auto-revert.
 *
 * Drop this on the ribbon as a high-z-index full-bleed zone (the
 * "CTS Water Polo Ribbon" preset does this at z-index 50). It does
 * not block clicks when idle.
 */
export function CtsCelebrationOrchestratorWidget({ config, live: liveSurface }: { config?: CtsCelebrationOrchestratorCfg; live?: boolean }) {
  const cfg = config ?? {};
  const durationMs = cfg.durationMs || 6000;
  const cues = cfg.cues || {};
  const homeDeck = (cues.homeGoal && cues.homeGoal.length ? cues.homeGoal : DEFAULT_CUE_DECK.homeGoal).filter((c) => c in CUE_CATALOG);
  const awayDeck = (cues.awayGoal && cues.awayGoal.length ? cues.awayGoal : DEFAULT_CUE_DECK.awayGoal).filter((c) => c in CUE_CATALOG);
  const periodDeck = (cues.periodEnd && cues.periodEnd.length ? cues.periodEnd : DEFAULT_CUE_DECK.periodEnd).filter((c) => c in CUE_CATALOG);
  const hornDeck = (cues.horn && cues.horn.length ? cues.horn : DEFAULT_CUE_DECK.horn).filter((c) => c in CUE_CATALOG);

  // On a live surface the goal-delta baseline starts from NEUTRAL_SNAPSHOT
  // (0-0) so the first real snapshot can't mis-fire a celebration off the
  // SAMPLE 4-3 jump.
  const { snap } = useCtsGameState(liveSurface === true);
  const [active, setActive] = useState<null | { cueId: CtsCueId; until: number; team: 'home' | 'away' | 'horn' }>(null);

  // Round-robin indices per deck. Refs (not state) because we don't
  // need re-render — we just advance on the next fire.
  const homeIdxRef = useRef<number>(0);
  const awayIdxRef = useRef<number>(0);
  const periodIdxRef = useRef<number>(0);
  const hornIdxRef = useRef<number>(0);

  // Last-seen refs for delta detection.
  const lastHomeRef = useRef<number>(snap.homeScore);
  const lastAwayRef = useRef<number>(snap.awayScore);
  const lastPeriodRef = useRef<number>(snap.period);
  const lastHornRef = useRef<boolean>(snap.horn);

  // Sprint 13 followup — listen for cues coming through the existing
  // /sports/board feed too. The operator (2026-05-26) called out the
  // duplication: "i can pick the CTS template from the dropdown here
  // and all the cues are loaded hopefully that we created already".
  // The existing /sports/<gameId> Celebrations panel POSTs to
  // /sports/games/:id/cue, which queues the cue in /sports/board/:id
  // data.cues. The legacy /ribbon page polls + plays them; my
  // orchestrator now also polls + plays them, so ONE button (the
  // existing Celebrations panel's "GOAL" tile) fires my cinematic on
  // the ribbon. Operator never has to learn a second UX.
  const cueGameId = resolveGameId();
  const cueBoard = useRibbonBoardData(cueGameId, 1500);
  const seenCueIdsRef = useRef<Set<string>>(new Set<string>());
  const firstCuePollRef = useRef<boolean>(true);

  // Cross-snapshot cue dedup. If the same cueId is requested within
  // CUE_COOLDOWN_MS of the last fire (e.g. a flap on the CTS feed
  // resends the same horn-rising-edge), we DROP the duplicate. Without
  // this guard a noisy console can re-fire the touchdown cinematic
  // three times in 600ms — unwatchable. Tuned to 2s: shorter than any
  // realistic celebration sequence, longer than any realistic feed
  // glitch.
  const lastFireAtRef = useRef<number>(0);
  const lastFireCueRef = useRef<string>('');
  const CUE_COOLDOWN_MS = 2_000;

  // Best-effort audit POST. Resolves the gameId from URL the same way
  // the sponsor/announcement widgets do, fire-and-forget so a network
  // blip never blocks the visual. Writes a GameEvent row server-side
  // for sponsor proof-of-play reporting.
  const auditCueFire = useCallback((cueId: string, team: 'home' | 'away' | 'horn', source: 'auto' | 'preview' | 'manual') => {
    if (typeof window === 'undefined') return;
    const gameId = resolveGameId();
    if (!gameId) return;
    const root = ribbonApiRoot();
    const url = root.endsWith('/api/v1')
      ? `${root}/sports/board/${encodeURIComponent(gameId)}/cts-cue-fired`
      : `${root}/api/v1/sports/board/${encodeURIComponent(gameId)}/cts-cue-fired`;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // keepalive: survive a tab-close mid-POST.
        keepalive: true,
        body: JSON.stringify({
          cueId,
          team,
          source,
          score: `${snap.homeScore}-${snap.awayScore}`,
        }),
      }).catch(() => undefined);
    } catch { /* ignore */ }
  }, [snap.homeScore, snap.awayScore]);

  const fire = useCallback((deck: CtsCueId[], idxRef: { current: number }, team: 'home' | 'away' | 'horn', source: 'auto' | 'preview' | 'manual' = 'auto') => {
    if (!deck.length) return;
    // 2026-06-15 DOUBLE-FIRE FIX — on a live board/ribbon route the surface's
    // own overlay already plays auto + feed cues; firing here too animates
    // every goal TWICE. Only operator PREVIEW (test buttons / Stream-Deck cue)
    // should fire from inside an embedded widget on a live surface.
    if (source !== 'preview' && surfaceHandlesCues()) return;
    const cueId = deck[idxRef.current % deck.length] as CtsCueId;
    // Dedup: if this exact cue fired within the cooldown, skip it.
    const now = Date.now();
    if (cueId === lastFireCueRef.current && now - lastFireAtRef.current < CUE_COOLDOWN_MS) {
      return;
    }
    idxRef.current = (idxRef.current + 1) % deck.length;
    lastFireAtRef.current = now;
    lastFireCueRef.current = cueId;
    setActive({ cueId, until: now + durationMs, team });
    auditCueFire(cueId, team, source);
  }, [durationMs, auditCueFire]);

  // Goal / horn / period detection on every snapshot update.
  useEffect(() => {
    let fired = false;
    if (snap.homeScore > lastHomeRef.current) {
      fire(homeDeck, homeIdxRef, 'home');
      fired = true;
    } else if (snap.awayScore > lastAwayRef.current) {
      fire(awayDeck, awayIdxRef, 'away');
      fired = true;
    }
    // Horn + period changes are checked SECOND so a goal-with-horn
    // (rare but possible) shows the goal scene, not the period scene.
    if (!fired) {
      if (!cfg.ignoreHorn && snap.horn && !lastHornRef.current) {
        fire(hornDeck, hornIdxRef, 'horn');
      } else if (!cfg.ignorePeriodEnd && snap.period > lastPeriodRef.current) {
        fire(periodDeck, periodIdxRef, 'horn');
      }
    }
    lastHomeRef.current = snap.homeScore;
    lastAwayRef.current = snap.awayScore;
    lastPeriodRef.current = snap.period;
    lastHornRef.current = snap.horn;
  }, [snap.homeScore, snap.awayScore, snap.period, snap.horn, homeDeck, awayDeck, periodDeck, hornDeck, fire, cfg.ignoreHorn, cfg.ignorePeriodEnd]);

  // Sprint 13 followup — when the operator fires a cue from the
  // EXISTING /sports/<gameId> Celebrations panel, it lands in the
  // /sports/board feed as a Cue. Pick it up, map to the operator's
  // cinematic deck, fire. Target filter: only RIBBON or ALL cues
  // (BOARD-only cues stay on the scoreboard surface, never the ribbon).
  //
  // Team routing:
  //   • cue.team='home'  → homeGoal deck (the GOAL celebration the
  //     operator clicked AFTER a home score)
  //   • cue.team='away'  → awayGoal deck
  //   • cue.team unset   → horn deck (sport celebrations without a
  //     team — saves, penalties, period markers, etc.)
  //
  // The orchestrator's deck config (cues.homeGoal / cues.awayGoal /
  // cues.horn from Properties panel) is the single source of truth
  // for which cinematic plays on the ribbon. Operator never has to
  // touch a separate "ribbon cinematics" UI.
  useEffect(() => {
    if (!cueBoard || !Array.isArray(cueBoard.cues)) return;
    // First poll's cues already played (they arrived BEFORE the
    // ribbon mounted) — record them as seen, don't re-fire. Otherwise
    // every fresh ribbon load would replay the last 20s of cues.
    for (const c of cueBoard.cues) {
      if (!c || !c.id) continue;
      if (seenCueIdsRef.current.has(c.id)) continue;
      seenCueIdsRef.current.add(c.id);
      if (firstCuePollRef.current) continue;
      // Target filter — null/'ALL'/'RIBBON' plays here; 'BOARD' skips.
      const target = (c.target || 'ALL').toUpperCase();
      if (target !== 'ALL' && target !== 'RIBBON') continue;
      // Pick deck based on team. Sport celebrations without a team
      // (saves, penalties) route to the horn deck — operator can
      // assign the right cinematic in Properties panel.
      const team: 'home' | 'away' | 'horn' = c.team === 'home' ? 'home' : c.team === 'away' ? 'away' : 'horn';
      const deck = team === 'home' ? homeDeck : team === 'away' ? awayDeck : hornDeck;
      const idxRef = team === 'home' ? homeIdxRef : team === 'away' ? awayIdxRef : hornIdxRef;
      fire(deck, idxRef, team, 'manual');
    }
    firstCuePollRef.current = false;
  }, [cueBoard, homeDeck, awayDeck, hornDeck, fire]);

  // Operator-preview event — Properties-panel test buttons + admin
  // CTS_MANUAL_CUE WS message (Stream Deck / mobile cue panel) both
  // dispatch this. Detail can pin a specific cueId; otherwise it
  // round-robins through the appropriate deck for the team. The
  // `source` field tells the audit log whether this was a Properties-
  // panel preview ('preview') or a Stream Deck / admin trigger
  // ('manual'); defaults to 'preview' for back-compat.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPreview = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const team: 'home' | 'away' | 'horn' = detail.team === 'away' ? 'away' : detail.team === 'horn' ? 'horn' : 'home';
      const source: 'preview' | 'manual' = detail.source === 'manual' ? 'manual' : 'preview';
      let cueId: CtsCueId | undefined = typeof detail.cueId === 'string' && detail.cueId in CUE_CATALOG ? detail.cueId : undefined;
      if (!cueId) {
        // No specific cue id pinned — round-robin from the appropriate
        // deck. Wrap in a one-shot deck so we still go through the
        // shared `fire()` for dedup + audit.
        const deck = team === 'home' ? homeDeck : team === 'away' ? awayDeck : hornDeck;
        const idxRef = team === 'home' ? homeIdxRef : team === 'away' ? awayIdxRef : hornIdxRef;
        if (!deck.length) return;
        fire(deck, idxRef, team, source);
        return;
      }
      // Specific cue pinned — fire it directly (still dedup + audit).
      const now = Date.now();
      if (cueId === lastFireCueRef.current && now - lastFireAtRef.current < CUE_COOLDOWN_MS) {
        return;
      }
      lastFireAtRef.current = now;
      lastFireCueRef.current = cueId;
      setActive({ cueId, until: now + durationMs, team });
      auditCueFire(cueId, team, source);
    };
    window.addEventListener('edu:cts-celebration-preview', onPreview);
    return () => window.removeEventListener('edu:cts-celebration-preview', onPreview);
  }, [homeDeck, awayDeck, hornDeck, durationMs, fire, auditCueFire]);

  // Auto-revert when the window expires.
  useEffect(() => {
    if (!active) return;
    const left = active.until - Date.now();
    if (left <= 0) { setActive(null); return; }
    const t = setTimeout(() => setActive(null), left);
    return () => clearTimeout(t);
  }, [active]);

  // Compose the final cue config: catalog defaults + cueOverrides +
  // team colors + score (so the celebration's "score" string reflects
  // the live game when the orchestrator fires).
  const cueProps = useMemo(() => {
    if (!active) return null;
    const entry = CUE_CATALOG[active.cueId];
    if (!entry) return null;
    const baseDefaults = (entry as { defaults: Record<string, unknown> }).defaults || {};
    const override = (cfg.cueOverrides && cfg.cueOverrides[active.cueId]) || {};
    return {
      ...baseDefaults,
      ...override,
      // Inject team copy / colors so cues without explicit values pull
      // them from the orchestrator's tenant-wide config. Cues that
      // don't read these fields just ignore them.
      homeColor: cfg.homeColor || (override as any).homeColor || '#3b82f6',
      awayColor: cfg.awayColor || (override as any).awayColor || '#ef4444',
      teamName: active.team === 'away' ? cfg.awayTeamName : cfg.homeTeamName,
      // Live score string — many cues render `score` somewhere.
      score: `${snap.homeScore}-${snap.awayScore}`,
    } as Record<string, unknown>;
  }, [active, cfg.cueOverrides, cfg.homeColor, cfg.awayColor, cfg.homeTeamName, cfg.awayTeamName, snap.homeScore, snap.awayScore]);

  // Measured overlay container so the cue widgets get a real `height`
  // prop (they size their typography off it). When idle the overlay
  // is still mounted but invisible — keeps the layout stable.
  const { ref, h } = useMeasuredHeight();
  const isActive = !!active && !!cueProps;
  const Active = isActive && active ? CUE_CATALOG[active.cueId]?.Component : null;

  return (
    <div
      ref={ref}
      aria-hidden={!isActive}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
        opacity: isActive ? 1 : 0,
        transition: 'opacity 220ms ease',
        background: isActive ? '#000' : 'transparent',
      }}
    >
      {Active && h > 0 && (
        <Active config={cueProps as never} live={true} height={h} />
      )}
    </div>
  );
}

// ─── Exports barrel ────────────────────────────────────────────────

export const CTS_WIDGET_DEFAULTS = {
  homeAbbrev: 'H',
  awayAbbrev: 'A',
  bgColor: '#0f172a',
  accentColor: '#f59e0b',
} as const;
