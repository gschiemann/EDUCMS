'use client';

/**
 * MainScoreboardWidget — the REAL scoreboard, as an editable template.
 *
 * Variant `scoreboard-main` ("Main Scoreboard (live)") — THIS is the
 * component the gallery / builder renders for a sports scoreboard.
 *
 * REBUILT 2026-05-29 to faithfully match the approved vibrant HS mockup
 * (scratch/design/scoreboards/hs.html) — the prior render was a muted,
 * half-empty dark board. This is the CLAUDE.md design-loop port:
 *   HTML mockup (approved) → React port (this file) → screenshot verify.
 *
 * EDITABLE: every value is operator-overridable from the Properties panel
 * (team names, scores, team colors, gold accent, banner, period, clock,
 * shot clock, possession, fouls, timeouts). When a live Game is bound
 * (GameStateProvider), its live values WIN over the static overrides — so
 * the one template works live OR hand-typed. Outside a provider it
 * self-plays a sample so the builder tile is alive.
 *
 * NO FAKE SCORES ON A LIVE BOARD (audit P1, 2026-06-13): the self-playing
 * SAMPLE (EAGLES 62 / TIGERS 58 / 7:42 / Q3) is for the BUILDER ONLY. On a
 * live player surface (provider present: `useGameState() != null`) that has
 * no snapshot yet AND no operator override, the score / clock / period /
 * shot-clock render NEUTRAL ("—" / "—:—") — never a fabricated number a
 * crowd could mistake for the real game. Operator-typed overrides
 * (c.homeScore / c.clock / …) still WIN, so a hand-configured board is
 * unaffected.
 *
 * APPROVED 2026-05-29 — matches scratch/design/scoreboards/hs.html,
 * screenshot-verified via apps/web/tests/e2e/scoreboard-shot.spec.ts.
 * DO NOT regress to vw/% units or the muted-panel look.
 *
 * Sizing: fixed 1920×1080 scene + useScaleToFit transform:scale.
 * Chromium-83 / Taurus safe — long-hand sides, NO flex `gap`, NO `inset`
 * shorthand, NO `backdrop-filter`. Font: Fredoka (self-hosted next/font).
 */

import { useEffect, useRef, useState } from 'react';
import { findSport, formatScore } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import { useGameState, fmtClock, type GameSnapshot } from './GameStateContext';
import { liveNeutral } from './cts-fields';
import type { BaseCfg, WidgetProps } from '../v2/_shared/types';

const DEFAULT_HOME = '#1e3a8a';
const DEFAULT_AWAY = '#b91c1c';
const ACCENT_DEFAULT = '#fbbf24';
const DISPLAY_FONT = "var(--font-fredoka), 'Fredoka', 'Baloo 2', system-ui, sans-serif";

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function segmentLabel(def: SportDefinition, snap: GameSnapshot): string {
  const n = snap.segment;
  if (def.segment.name === 'Inning') {
    const half = String((snap.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  return `${def.segment.name.toUpperCase()} ${n}`;
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sideOf = (v: unknown): 'home' | 'away' | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'home' || s === 'h') return 'home';
  if (s === 'away' || s === 'a') return 'away';
  return null;
};
/** Use the override when set (not undefined/null/''), else the fallback. */
function pick<T>(override: T | undefined | null, fallback: T): T {
  return override === undefined || override === null || (override as unknown) === '' ? fallback : override;
}
/** Blend a #rrggbb toward black by `amt` (0..1). Passthrough on non-hex. */
function darken(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

// Self-playing sample so the builder canvas / gallery tile is alive +
// shows the full rich board (shot clock, possession, fouls, timeouts).
const SAMPLE: GameSnapshot = {
  id: 'sample',
  sport: 'basketball',
  status: 'LIVE',
  segment: 3,
  homeTeam: 'EAGLES',
  awayTeam: 'TIGERS',
  homeScore: 62,
  awayScore: 58,
  homeColor: '#1e3a8a',
  awayColor: '#b91c1c',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 7 * 60_000 + 42_000,
  clockRunning: true,
  clockUpdatedAt: new Date().toISOString(),
  stats: { shotClock: 14, possession: 'home', homeFouls: 3, awayFouls: 5, homeTimeouts: 2, awayTimeouts: 1 },
  serverTime: Date.now(),
};

// ── scale-to-fit (fixed 1920×1080 scene → any zone) ──────────────
function useScaleToFit(naturalW: number, naturalH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / naturalW, h / naturalH));
    };
    compute();
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, [naturalW, naturalH]);
  return { ref, scale };
}

export interface MainScoreboardCfg extends BaseCfg {
  /** Center banner text. Defaults to "GAME NIGHT". */
  bannerText?: string;
  /** Gold trim color (banner / clock frame / borders). */
  accentColor?: string;
  // ── Static overrides (editable in Properties). A bound game's live
  //    values win over these, so the template works live OR hand-typed.
  homeName?: string;
  awayName?: string;
  homeScore?: number;
  awayScore?: number;
  homeColor?: string;
  awayColor?: string;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  /** Literal period text (e.g. "QUARTER 3"); else derived from the game. */
  period?: string;
  /** Literal clock text (e.g. "7:42"); else derived from the game. */
  clock?: string;
  shotClock?: number;
  possession?: 'home' | 'away' | '';
  homeFouls?: number;
  awayFouls?: number;
  homeTimeouts?: number;
  awayTimeouts?: number;
  status?: string;
  hideWordmark?: boolean;
}

export function MainScoreboardWidget({ config, live = true }: WidgetProps<MainScoreboardCfg>) {
  const c = config ?? {};
  const state = useGameState();

  const [sampleMs, setSampleMs] = useState(SAMPLE.clockMs);
  const [sampleShot, setSampleShot] = useState(14);
  useEffect(() => {
    if (state?.snapshot) return;
    const id = setInterval(() => {
      setSampleMs((m) => (m <= 0 ? 7 * 60_000 + 42_000 : m - 1000));
      setSampleShot((s) => (s <= 0 ? 24 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [state?.snapshot]);

  const snap = state?.snapshot ?? SAMPLE;
  const clockMs = state?.snapshot ? state.liveClockMs : sampleMs;
  const def = findSport(snap.sport);
  const { ref, scale } = useScaleToFit(1920, 1080);

  if (!def) {
    return (
      <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0d12', color: '#64748b', fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 700 }}>
        UNKNOWN SPORT
      </div>
    );
  }

  const stats = (snap.stats || {}) as Record<string, unknown>;
  const hasClock = def.clock.type !== 'none';

  // ── No fake scores on a live board (audit P1) ──────────────────────
  // We're on a LIVE player surface whenever the GameStateProvider is
  // mounted (state != null) — that only happens on the /board route, not
  // the builder/thumbnail. When it's mounted but no snapshot has arrived
  // (game not live / no feed yet), the `snap` above fell back to SAMPLE,
  // which would paint fabricated digits. So: on a live surface with no
  // snapshot, the SAMPLE-sourced score / clock / period / shot read
  // NEUTRAL instead. Operator overrides (c.*) still WIN — a hand-typed
  // board is unaffected. The builder (state == null) keeps the self-
  // playing SAMPLE so the tile stays alive.
  const isLiveNoData = state != null && !state.snapshot;
  const NEUTRAL = liveNeutral('value');

  // ── view = static config overrides layered over live/sample data ──
  const homeColor = pick(c.homeColor, snap.homeColor || DEFAULT_HOME);
  const awayColor = pick(c.awayColor, snap.awayColor || DEFAULT_AWAY);
  const accent = pick(c.accentColor, ACCENT_DEFAULT);
  const homeName = String(pick(c.homeName, snap.homeTeam) || 'HOME');
  const awayName = String(pick(c.awayName, snap.awayTeam) || 'AWAY');
  // Score: operator override wins; else the live score; else NEUTRAL on a
  // live surface with no data (never SAMPLE's 62 / 58).
  const homeScore = pick(c.homeScore, isLiveNoData ? NEUTRAL : snap.homeScore);
  const awayScore = pick(c.awayScore, isLiveNoData ? NEUTRAL : snap.awayScore);
  // Judged sports (gymnastics / cheer) store a SCALED int — format the
  // displayed value with decimals. Non-number values (NEUTRAL '—', a
  // hand-typed string override) pass through untouched. Integer sports:
  // formatScore is String(n), so this is a no-op for them.
  const fmtScoreVal = (v: number | string) =>
    typeof v === 'number' ? formatScore(def, v) : v;
  const homeLogoUrl = pick(c.homeLogoUrl, snap.homeLogoUrl);
  const awayLogoUrl = pick(c.awayLogoUrl, snap.awayLogoUrl);
  const status = String(pick(c.status, snap.status));
  const isLive = status === 'LIVE' && live !== false && !isLiveNoData;
  const periodText = pick(c.period, isLiveNoData ? NEUTRAL : segmentLabel(def, snap));
  const clockText = pick(c.clock, hasClock ? (isLiveNoData ? liveNeutral('clock') : fmtClock(clockMs)) : '');
  const clockUrgent = !c.clock && !isLiveNoData && hasClock && snap.clockRunning && clockMs > 0 && clockMs < 60_000;

  // Shot clock: live value when present, sample only in the builder,
  // hidden on a live surface with no data (handled by hasShot below).
  const shotClock = pick(c.shotClock, state?.snapshot ? num(stats.shotClock) : sampleShot);
  // Show the shot coin for: an operator override, a live shotClock, or
  // the builder sample — but NOT a live board with no data (would show
  // the fabricated sample 14). `num(NEUTRAL)` is 0, so even if it slips
  // through, `shotClock > 0` would gate it; the explicit guard is clearer.
  const hasShot =
    (c.shotClock !== undefined || 'shotClock' in stats || (!state?.snapshot && !isLiveNoData)) &&
    shotClock > 0 &&
    hasClock;
  const poss = sideOf(pick(c.possession, stats.possession));
  const hasFouls = c.homeFouls !== undefined || c.awayFouls !== undefined || 'homeFouls' in stats || 'awayFouls' in stats;
  const hasTimeouts = c.homeTimeouts !== undefined || c.awayTimeouts !== undefined || 'homeTimeouts' in stats || 'awayTimeouts' in stats;
  const homeFouls = pick(c.homeFouls, num(stats.homeFouls));
  const awayFouls = pick(c.awayFouls, num(stats.awayFouls));
  const homeTO = pick(c.homeTimeouts, num(stats.homeTimeouts));
  const awayTO = pick(c.awayTimeouts, num(stats.awayTimeouts));
  const maxTO = 3;

  const homeInitial = homeName.trim().charAt(0).toUpperCase();
  const awayInitial = awayName.trim().charAt(0).toUpperCase();
  const BLOCK_W = 620;

  const sideBlock = (which: 'home' | 'away'): React.CSSProperties => {
    const col = which === 'home' ? homeColor : awayColor;
    return {
      position: 'absolute', top: 0,
      [which === 'home' ? 'left' : 'right']: 0,
      width: BLOCK_W, height: 1080,
      background: `linear-gradient(${which === 'home' ? 160 : 200}deg, ${col} 0%, ${darken(col, 0.28)} 60%, ${darken(col, 0.45)} 100%)`,
      [which === 'home' ? 'borderRight' : 'borderLeft']: `14px solid ${accent}`,
      boxShadow: `inset ${which === 'home' ? '-40px' : '40px'} 0 80px rgba(0,0,0,0.35)`,
    } as React.CSSProperties;
  };
  const logoCoin = (which: 'home' | 'away'): React.CSSProperties => {
    const col = which === 'home' ? homeColor : awayColor;
    return {
      position: 'absolute', top: 96,
      [which === 'home' ? 'left' : 'right']: 194,
      width: 232, height: 232, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 150, color: '#fff',
      background: `radial-gradient(circle at 38% 32%, ${col}, ${darken(col, 0.45)})`,
      border: '12px solid rgba(255,255,255,0.92)',
      boxShadow: '0 18px 44px rgba(0,0,0,0.45), inset 0 6px 18px rgba(255,255,255,0.12)',
      overflow: 'hidden',
    } as React.CSSProperties;
  };
  const nameStyle = (which: 'home' | 'away'): React.CSSProperties => ({
    position: 'absolute', top: 360,
    [which === 'home' ? 'left' : 'right']: 0,
    width: BLOCK_W, textAlign: 'center', fontWeight: 800, fontSize: 90, lineHeight: 0.95,
    color: '#fff', letterSpacing: 1, textShadow: '0 6px 0 rgba(0,0,0,0.28)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 24px', boxSizing: 'border-box',
  } as React.CSSProperties);
  const tagStyle = (which: 'home' | 'away'): React.CSSProperties => ({
    position: 'absolute', top: 478,
    [which === 'home' ? 'left' : 'right']: 0,
    width: BLOCK_W, textAlign: 'center', fontWeight: 600, fontSize: 34, letterSpacing: 12, color: accent,
  } as React.CSSProperties);
  const scoreStyle = (which: 'home' | 'away'): React.CSSProperties => ({
    position: 'absolute', top: 552,
    [which === 'home' ? 'left' : 'right']: 0,
    width: BLOCK_W, textAlign: 'center', fontWeight: 800, fontSize: 440, lineHeight: 0.8,
    color: '#fff', fontVariantNumeric: 'tabular-nums',
    textShadow: '0 14px 0 rgba(0,0,0,0.30), 0 0 70px rgba(255,255,255,0.22)',
  } as React.CSSProperties);
  const pip = (on: boolean, color: string): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: '50%', marginLeft: 12,
    background: on ? color : 'transparent', border: `3px solid ${on ? color : 'rgba(255,255,255,0.5)'}`, display: 'inline-block',
  });

  return (
    <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0d12' }}>
      <div
        style={{
          width: 1920, height: 1080, flexShrink: 0,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)', transformOrigin: 'center center',
          position: 'relative', overflow: 'hidden', fontFamily: DISPLAY_FONT,
          background: '#11151d',
          backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.018) 0 60px, rgba(255,255,255,0) 60px 120px)',
        }}
      >
        <style>{`@keyframes mainSbBlink{0%,100%{opacity:1}50%{opacity:.25}}@keyframes mainSbClk{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

        {/* HOME side */}
        <div style={sideBlock('home')} />
        <div style={logoCoin('home')}>
          {homeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={homeLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          ) : homeInitial}
        </div>
        <div style={nameStyle('home')}>{homeName.toUpperCase()}</div>
        <div style={tagStyle('home')}>HOME</div>
        <div style={scoreStyle('home')}>{fmtScoreVal(homeScore)}</div>

        {/* AWAY side */}
        <div style={sideBlock('away')} />
        <div style={logoCoin('away')}>
          {awayLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={awayLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          ) : awayInitial}
        </div>
        <div style={nameStyle('away')}>{awayName.toUpperCase()}</div>
        <div style={tagStyle('away')}>AWAY</div>
        <div style={scoreStyle('away')}>{fmtScoreVal(awayScore)}</div>

        {/* CENTER COLUMN */}
        <div style={{ position: 'absolute', top: 0, left: BLOCK_W, width: 680, height: 1080 }}>
          {/* banner */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 680, height: 150, background: `linear-gradient(180deg, ${accent}, ${darken(accent, 0.22)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 50, letterSpacing: 4, color: '#1e2a4a', boxShadow: '0 8px 22px rgba(0,0,0,0.4)' }}>
            <span style={{ fontSize: 40, marginRight: 18 }}>★</span>
            {String(pick(c.bannerText, 'GAME NIGHT')).toUpperCase()}
            <span style={{ fontSize: 40, marginLeft: 18 }}>★</span>
          </div>

          {/* period chip */}
          <div style={{ position: 'absolute', top: 196, left: 140, width: 400, height: 96, background: '#fff', borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 52, color: darken(homeColor, 0.15), boxShadow: '0 10px 0 rgba(0,0,0,0.22)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {periodText}
          </div>

          {/* clock card (or sport plate for no-clock sports) */}
          {clockText ? (
            <div style={{ position: 'absolute', top: 330, left: 60, width: 560, height: 300, background: '#0a0f1c', border: `10px solid ${accent}`, borderRadius: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 16px 0 rgba(0,0,0,0.30), inset 0 0 60px ${accent}1a` }}>
              <span style={{ fontWeight: 800, fontSize: 200, lineHeight: 1, color: clockUrgent ? '#f87171' : '#fde047', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 40px rgba(253,224,71,0.55)', animation: clockUrgent ? 'mainSbClk 1s ease-in-out infinite' : undefined }}>
                {clockText}
              </span>
            </div>
          ) : (
            <div style={{ position: 'absolute', top: 330, left: 60, width: 560, height: 300, background: '#0a0f1c', border: `10px solid ${accent}`, borderRadius: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 84, color: accent, letterSpacing: 4, textAlign: 'center', padding: '0 20px' }}>
              {def.name.toUpperCase()}
            </div>
          )}

          {/* shot clock coin */}
          {hasShot && (
            <div style={{ position: 'absolute', top: 300, left: 470, width: 168, height: 168, borderRadius: '50%', background: 'radial-gradient(circle at 40% 34%, #ff5b5b, #c81e1e)', border: '9px solid #fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 28px rgba(0,0,0,0.5)' }}>
              <span style={{ fontWeight: 800, fontSize: 92, lineHeight: 0.9, color: '#fff' }}>{shotClock}</span>
              <span style={{ fontWeight: 600, fontSize: 21, letterSpacing: 2, color: '#ffe2e2', marginTop: 2 }}>SHOT</span>
            </div>
          )}

          {/* possession bar */}
          {poss && (
            <div style={{ position: 'absolute', top: 658, left: 60, width: 560, height: 92, background: '#fff', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 0 rgba(0,0,0,0.2)' }}>
              <span style={{ fontSize: 60, lineHeight: 1, color: darken(homeColor, 0.1), opacity: poss === 'home' ? 1 : 0.18 }}>◄</span>
              <span style={{ fontWeight: 600, fontSize: 32, letterSpacing: 3, color: '#475569', margin: '0 22px' }}>POSSESSION</span>
              <span style={{ fontSize: 60, lineHeight: 1, color: darken(awayColor, 0.1), opacity: poss === 'away' ? 1 : 0.18 }}>►</span>
            </div>
          )}

          {/* fouls + timeouts meters */}
          {(hasFouls || hasTimeouts) && (
            <div style={{ position: 'absolute', top: 776, left: 60, width: 560, height: 216, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              {hasFouls && (
                <div style={{ height: 100, background: '#161c2b', border: '4px solid #2a3450', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
                  <span style={{ fontWeight: 600, fontSize: 28, letterSpacing: 3, color: '#cbd5e1' }}>TEAM FOULS</span>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, fontSize: 56, lineHeight: 1, width: 92, textAlign: 'center', borderRadius: 16, padding: '4px 0', background: homeColor, color: '#fff' }}>{homeFouls}</span>
                    <span style={{ fontWeight: 600, fontSize: 26, color: '#64748b', margin: '0 16px' }}>–</span>
                    <span style={{ fontWeight: 800, fontSize: 56, lineHeight: 1, width: 92, textAlign: 'center', borderRadius: 16, padding: '4px 0', background: awayColor, color: '#fff' }}>{awayFouls}</span>
                  </span>
                </div>
              )}
              {hasTimeouts && (
                <div style={{ height: 100, background: '#161c2b', border: '4px solid #2a3450', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
                  <span style={{ fontWeight: 600, fontSize: 28, letterSpacing: 3, color: '#cbd5e1' }}>TIMEOUTS</span>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {Array.from({ length: maxTO }).map((_, i) => <span key={`h${i}`} style={pip(i < homeTO, '#60a5fa')} />)}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 26, color: '#64748b', margin: '0 16px' }}>/</span>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {Array.from({ length: maxTO }).map((_, i) => <span key={`a${i}`} style={pip(i < awayTO, '#f87171')} />)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LIVE flag */}
        {isLive && (
          <div style={{ position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)', background: '#dc2626', color: '#fff', fontWeight: 700, fontSize: 30, letterSpacing: 4, padding: '8px 26px', borderRadius: 999, display: 'flex', alignItems: 'center', boxShadow: '0 6px 16px rgba(0,0,0,0.4)', zIndex: 5 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', marginRight: 12, animation: 'mainSbBlink 1.3s ease-in-out infinite' }} />
            LIVE
          </div>
        )}
      </div>
    </div>
  );
}
