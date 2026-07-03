'use client';

/**
 * CtsScoreboard — water-polo ribbon scoreboard fed by the Colorado
 * Time Systems (CTS) System 6 / Gen 6 bridge.
 *
 * This widget consumes CTS bridge updates that the player page
 * forwards via the `edu:cts-game-state` window CustomEvent. The
 * bridge (CtsBridge) → API → signed-WS → player page → CustomEvent
 * → this widget. Decoupling via CustomEvent lets multiple ribbon
 * segments mount this same component without each one needing a
 * direct React context wire-up to the giant player/page.tsx file.
 *
 * Render layout (designed for a 480×208 px ribbon panel — six
 * 80×208 LED tiles stacked horizontally on a NovaStar VX400 Pro):
 *
 *   ┌───────────────────────────────────────────────┐
 *   │           7:42                          Q3    │  ← clock + period
 *   │     H  1 - 0  A                               │  ← team initials + score
 *   │  HOME  • 7 (12s)                              │  ← active exclusion (if any)
 *   └───────────────────────────────────────────────┘
 *
 * Falls back to a sample state when no bridge is connected so the
 * builder canvas + gallery thumbnails are always alive.
 *
 * NO FAKE SCORE ON A LIVE BOARD (audit P1, 2026-06-13; hardened task #290,
 * 2026-07-03): the SAMPLE (1-0, 7:42, Q3) is for the BUILDER / gallery
 * thumbnail ONLY. On a real PLAYER surface, until a real CTS
 * `edu:cts-game-state` event arrives, the board renders NEUTRAL (—:—
 * clock, "—" scores) — never the fabricated sample a water-polo crowd
 * could mistake for the real game. `cfg.preview` still forces the sample
 * for an explicit off-route preview.
 *
 * ── task #290: the `live` prop is NOT the player signal ────────────────
 * The original fix (2026-06-13) keyed `isLiveSurface` off the generic
 * `live` prop `WidgetRenderer.WidgetPreviewInner` threads into every
 * widget (video autoplay, carousel rotation, iframe loading, etc). That
 * prop answers "should this render as if it's actually running" — which
 * is ALSO true for `TemplatePreviewModal` (the builder's "what does this
 * look like on a TV?" fullscreen preview: a BUILDER surface, explicitly
 * `live={true}` so videos autoplay) and `AppConfigForm`'s config-preview
 * pane. Neither of those is a real screen with real CTS hardware attached
 * — so keying the water-polo NEUTRAL/SAMPLE choice off `live` painted the
 * fabricated 1-0 SAMPLE score onto what LOOKED like a real preview.
 *
 * The correct signal is `RenderSurfaceContext` (GameStateContext.tsx) —
 * set to 'player' ONLY by the two components that render a REAL screen
 * (apps/web/src/app/player/page.tsx, apps/web/src/components/player/
 * TouchOverlay.tsx). `isLiveSurface` now requires BOTH `renderSurface ===
 * 'player'` AND the caller's `live` prop truthy (defends the same "is
 * this actually running" signal on top) — so a template preview or an
 * App Library config-preview (`renderSurface` unset → defaults to
 * 'builder') keeps rendering the alive SAMPLE, exactly like every other
 * sport widget's builder canvas, while a genuine player render with no
 * bridge feed yet renders NEUTRAL.
 *
 * Chromium-safe — uses long-hand sides for position, per-child
 * margin instead of flex gap (Chromium 83 traps, see CLAUDE.md rule
 * #10). NOT designed for Chromium-83 because the CTS bridge itself
 * requires Web Serial which is Chrome 89+ — but the styles stay
 * conservative just in case someone uses this widget on a non-CTS
 * surface.
 */

import { useEffect, useRef, useState } from 'react';
import { useRenderSurface } from './GameStateContext';

export interface CtsScoreboardSnapshot {
  clock: string;
  period: number;
  homeScore: number;
  awayScore: number;
  homeExclusions: Array<{ playerJersey: number; secondsRemaining: number }>;
  awayExclusions: Array<{ playerJersey: number; secondsRemaining: number }>;
  homeShotClock?: string;
  awayShotClock?: string;
  horn?: boolean;
}

const SAMPLE: CtsScoreboardSnapshot = {
  clock: '7:42',
  period: 3,
  homeScore: 1,
  awayScore: 0,
  homeExclusions: [],
  awayExclusions: [{ playerJersey: 7, secondsRemaining: 12 }],
  homeShotClock: '24',
  awayShotClock: '',
  horn: false,
};

// Neutral state for a LIVE board with no bridge feed yet — empty arrays,
// 0:00 clock, period 1. The render special-cases scores + clock to a
// dash (see `neutral` below) so nothing reads as a fabricated game.
const NEUTRAL_SNAPSHOT: CtsScoreboardSnapshot = {
  clock: '0:00',
  period: 1,
  homeScore: 0,
  awayScore: 0,
  homeExclusions: [],
  awayExclusions: [],
  homeShotClock: '',
  awayShotClock: '',
  horn: false,
};

export interface CtsScoreboardConfig {
  /** Two-letter home team abbreviation. Default "H". */
  homeAbbrev?: string;
  /** Two-letter away team abbreviation. Default "A". */
  awayAbbrev?: string;
  /** Solid background color. Default deep navy. */
  bgColor?: string;
  /** Brand-primary fallback color for accents. Default amber. */
  accentColor?: string;
  /** When true, ignores the live feed and renders SAMPLE — for
   *  builder canvas / gallery thumbnails. */
  preview?: boolean;
}

export function CtsScoreboard(
  // WidgetRenderer passes `config` + `live`; the legacy direct callers
  // passed `cfg`. Accept both — `config` wins when present.
  { cfg, config, live }: { cfg?: CtsScoreboardConfig; config?: CtsScoreboardConfig; live?: boolean } = {},
) {
  const c = config ?? cfg ?? {};
  const homeAbbrev = (c.homeAbbrev || 'H').slice(0, 3).toUpperCase();
  const awayAbbrev = (c.awayAbbrev || 'A').slice(0, 3).toUpperCase();
  const bgColor = c.bgColor || '#0f172a';
  const accentColor = c.accentColor || '#f59e0b';

  // Real player surface (task #290) = RenderSurfaceContext says 'player'
  // (set ONLY by player/page.tsx + TouchOverlay.tsx) AND the caller's
  // `live` flag is truthy. A template preview / App Library config
  // preview never sets renderSurface, so it stays on the builder default
  // and keeps the alive SAMPLE even though it passes `live={true}` for
  // video/carousel autoplay. `cfg.preview` still forces the sample for an
  // explicit off-route preview.
  const renderSurface = useRenderSurface();
  const isLiveSurface = renderSurface === 'player' && live === true && !c.preview;

  const [snapshot, setSnapshot] = useState<CtsScoreboardSnapshot | null>(
    c.preview ? SAMPLE : null,
  );

  // Subscribe to bridge updates. The CustomEvent is dispatched by
  // the player page WS handler whenever a GAME_STATE message arrives.
  useEffect(() => {
    if (c.preview) return;
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'object') {
        // The bridge ships the FULL CtsFullSnapshot; coerce field
        // names defensively so a stale snapshot shape can't crash
        // the render.
        const d = detail as Partial<CtsScoreboardSnapshot>;
        setSnapshot({
          clock: typeof d.clock === 'string' ? d.clock : '0:00',
          period: typeof d.period === 'number' ? d.period : 1,
          homeScore: typeof d.homeScore === 'number' ? d.homeScore : 0,
          awayScore: typeof d.awayScore === 'number' ? d.awayScore : 0,
          homeExclusions: Array.isArray(d.homeExclusions) ? d.homeExclusions : [],
          awayExclusions: Array.isArray(d.awayExclusions) ? d.awayExclusions : [],
          homeShotClock: typeof d.homeShotClock === 'string' ? d.homeShotClock : '',
          awayShotClock: typeof d.awayShotClock === 'string' ? d.awayShotClock : '',
          horn: typeof d.horn === 'boolean' ? d.horn : false,
        });
      }
    };
    window.addEventListener('edu:cts-game-state', onUpdate);
    return () => window.removeEventListener('edu:cts-game-state', onUpdate);
  }, [c.preview]);

  // Scale-to-fit wrapper, same pattern as MainScoreboardWidget. Fixed
  // 480×208 px natural size — the design canvas the lead's water-polo
  // install uses.
  const NATURAL_W = 480;
  const NATURAL_H = 208;
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / NATURAL_W, h / NATURAL_H));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live surface with no bridge event yet → NEUTRAL (—:— clock, dash
  // scores), never the SAMPLE. Builder / preview → SAMPLE so the tile is
  // alive. A real snapshot always wins.
  const neutral = isLiveSurface && snapshot == null;
  const snap = snapshot ?? (isLiveSurface ? NEUTRAL_SNAPSHOT : SAMPLE);
  const clockText = neutral ? '—:—' : snap.clock;
  const homeScoreText = neutral ? '—' : pad2(snap.homeScore);
  const awayScoreText = neutral ? '—' : pad2(snap.awayScore);
  const showExcl = snap.homeExclusions[0] || snap.awayExclusions[0];
  const exclSide = snap.homeExclusions[0] ? homeAbbrev : awayAbbrev;
  const exclColor = snap.homeExclusions[0] ? '#facc15' : '#fb923c';
  const horn = snap.horn === true;

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: bgColor,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: NATURAL_W,
          height: NATURAL_H,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          fontFamily: '"DM Mono", "Courier New", monospace',
          color: 'white',
        }}
      >
        {/* Top row: clock (left, big) + period (right, small) */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 12,
            fontSize: 92,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: 2,
            color: horn ? '#ef4444' : accentColor,
            textShadow: horn
              ? '0 0 20px rgba(239,68,68,0.8)'
              : `0 0 12px ${accentColor}66`,
          }}
        >
          {clockText}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            fontSize: 28,
            fontWeight: 700,
            color: '#cbd5e1',
            letterSpacing: 1,
          }}
        >
          {periodLabel(snap.period)}
        </div>

        {/* Middle row: score block */}
        <div
          style={{
            position: 'absolute',
            top: 108,
            left: 0,
            width: NATURAL_W,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'baseline',
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          <span style={{ color: '#93c5fd', marginRight: 14 }}>{homeAbbrev}</span>
          <span style={{ color: 'white', minWidth: 50, textAlign: 'right' }}>
            {homeScoreText}
          </span>
          <span style={{ color: '#64748b', margin: '0 14px' }}>−</span>
          <span style={{ color: 'white', minWidth: 50, textAlign: 'left' }}>
            {awayScoreText}
          </span>
          <span style={{ color: '#fca5a5', marginLeft: 14 }}>{awayAbbrev}</span>
        </div>

        {/* Bottom row: active exclusion OR shot clock */}
        {showExcl && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 12,
              right: 12,
              fontSize: 20,
              color: exclColor,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: exclColor,
                borderRadius: 6,
                marginRight: 8,
                verticalAlign: 'middle',
              }}
            />
            {exclSide} {' '}
            EXCL #{showExcl.playerJersey}
            {' · '}
            {showExcl.secondsRemaining}s
          </div>
        )}
        {!showExcl && (snap.homeShotClock || snap.awayShotClock) && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 12,
              right: 12,
              fontSize: 18,
              color: '#94a3b8',
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            {snap.homeShotClock && (
              <span style={{ marginRight: 16 }}>
                {homeAbbrev} SC {snap.homeShotClock}
              </span>
            )}
            {snap.awayShotClock && (
              <span>
                {awayAbbrev} SC {snap.awayShotClock}
              </span>
            )}
          </div>
        )}

        {/* Live / disconnected dot */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: snapshot ? '#22c55e' : '#64748b',
            boxShadow: snapshot ? '0 0 6px #22c55e' : 'none',
          }}
        />
      </div>
    </div>
  );
}

function pad2(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '00';
  return n < 10 ? `0${n}` : String(n);
}

function periodLabel(p: number): string {
  if (p >= 5) return `OT${p - 4 === 1 ? '' : p - 4}`;
  return `Q${p}`;
}
