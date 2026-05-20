'use client';

/**
 * MainScoreboardWidget — the REAL scoreboard, as an editable template.
 *
 * Operator (2026-05-19): "the [scoreboard presets] you gave me are all
 * the same and they are fucking useless, nothing like the final
 * scoreboard we created." Right — the generic SCORE_HOME/GAME_CLOCK
 * 7-zone preset was a stripped-down toy. THIS widget is a faithful
 * pixel reproduction of the actual BoardScene that /board/[gameId]
 * pushes to screens: header strip + status pill, team-color panels
 * with logos + 264px scores + winning glow, the 188px amber game
 * clock, sport-aware segment label, football possession marker,
 * VENUEOS wordmark.
 *
 * Data: reads useGameState() (the GameStateProvider that CustomScoreboardScene
 * wraps the rendered template in), so a "Main Scoreboard" template bound
 * to a game shows live score / clock / period exactly like the real
 * board. OUTSIDE a provider (builder canvas, gallery thumbnail) it
 * renders a self-playing sample game so the tile is always alive.
 *
 * Sizing: fixed 1920×1080 scene + useScaleToFit transform:scale — the
 * same pattern AnimatedWelcomeWidget / ScaledTemplateThumbnail use, so
 * it drops into any zone and any LED resolution and stays pixel-faithful.
 *
 * Chromium-83 / NovaStar-Taurus safe — long-hand top/right/bottom/left,
 * no flex `gap`, no `inset` shorthand, no `aspect-ratio`.
 */

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import { useGameState, fmtClock, type GameSnapshot } from './GameStateContext';
import type { BaseCfg, WidgetProps } from '../v2/_shared/types';

const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

const STATUS_STYLE: Record<string, { label: string; bg: string; pulse?: boolean }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626', pulse: true },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function segmentLabel(def: SportDefinition, snap: GameSnapshot): string {
  const n = snap.segment;
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  if (def.segment.name === 'Inning') {
    const half = String((snap.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  return `${def.segment.name.toUpperCase()} ${n}`;
}

// Self-playing sample so the builder canvas / gallery tile is alive.
const SAMPLE: GameSnapshot = {
  id: 'sample',
  sport: 'basketball',
  status: 'LIVE',
  segment: 3,
  homeTeam: 'EAGLES',
  awayTeam: 'TIGERS',
  homeScore: 62,
  awayScore: 58,
  homeColor: '#4f46e5',
  awayColor: '#dc2626',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 7 * 60_000 + 42_000,
  // running so the sample/thumbnail shows the signature amber glowing
  // clock (the iconic "live" look), not the dimmed stopped state.
  clockRunning: true,
  clockUpdatedAt: new Date().toISOString(),
  stats: {},
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

// ── team panel ───────────────────────────────────────────────────
function TeamPanel({
  side, name, score, color, logoUrl, winning, hasPossession,
}: {
  side: 'home' | 'away';
  name: string;
  score: number;
  color: string;
  logoUrl: string | null;
  winning: boolean;
  hasPossession?: boolean;
}) {
  return (
    <div style={{
      position: 'relative', flex: 1, height: '100%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(${side === 'home' ? '135deg' : '225deg'}, ${color}2e, #0b0f1a 72%)`,
      borderTop: `10px solid ${color}`,
    }}>
      {/* logo with team-color halo (or initial circle) */}
      <div style={{ position: 'relative', width: 200, height: 176, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: `radial-gradient(circle at 50% 48%, ${color}59, transparent 64%)` }} />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" style={{ position: 'relative', width: 176, height: 176, objectFit: 'contain', filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.55))' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div style={{
            position: 'relative', width: 130, height: 130, borderRadius: '50%', background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 66, fontWeight: 900, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: 660, marginTop: 6 }}>
        {hasPossession && <span aria-hidden style={{ fontSize: 40, lineHeight: 1, marginRight: 14 }}>🏈</span>}
        <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: 1, color: '#fff', textAlign: 'center', lineHeight: 1.05, textShadow: '0 4px 18px rgba(0,0,0,0.6)' }}>
          {name}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 6, color, marginTop: 8 }}>
        {side === 'home' ? 'HOME' : 'AWAY'}
      </div>
      <div style={{
        fontSize: 264, fontWeight: 900, color: '#fff', lineHeight: 1, marginTop: 2,
        fontVariantNumeric: 'tabular-nums',
        textShadow: winning ? `0 0 64px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
      }}>
        {score}
      </div>
    </div>
  );
}

export interface MainScoreboardCfg extends BaseCfg {
  /** Reserved — future per-board overrides (hide branding, accent, etc.). */
  hideWordmark?: boolean;
}

export function MainScoreboardWidget({ config, live = true }: WidgetProps<MainScoreboardCfg>) {
  const c = config ?? {};
  const state = useGameState();

  // Live game from context, else the self-playing sample. In the
  // sample path we tick the clock down locally so the tile feels alive.
  const [sampleMs, setSampleMs] = useState(SAMPLE.clockMs);
  useEffect(() => {
    if (state?.snapshot) return;            // real game bound — context drives the clock
    const id = setInterval(() => setSampleMs((m) => (m <= 0 ? 7 * 60_000 + 42_000 : m - 1000)), 1000);
    return () => clearInterval(id);
  }, [state?.snapshot]);

  const snap = state?.snapshot ?? SAMPLE;
  const clockMs = state?.snapshot ? state.liveClockMs : sampleMs;
  const def = findSport(snap.sport);
  const { ref, scale } = useScaleToFit(1920, 1080);

  if (!def) {
    return (
      <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070d', color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 20, fontWeight: 700 }}>
        UNKNOWN SPORT
      </div>
    );
  }

  const status = STATUS_STYLE[snap.status] || STATUS_STYLE.SCHEDULED;
  const homeColor = snap.homeColor || DEFAULT_HOME;
  const awayColor = snap.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const ballSide = def.key === 'football'
    ? String((snap.stats as Record<string, unknown> | undefined)?.possession || '').trim().toLowerCase()
    : '';
  const pulse = !!status.pulse && live !== false;

  return (
    <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070d' }}>
      {pulse && <style>{`@keyframes mainSbPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.62; } }`}</style>}
      <div style={{
        width: 1920, height: 1080, flexShrink: 0,
        transform: scale > 0 ? `scale(${scale})` : 'scale(0)', transformOrigin: 'center center',
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif', color: '#fff', position: 'relative',
      }}>
        {/* header */}
        <div style={{ height: 92, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 44px', background: '#05070d', borderBottom: '2px solid #1e2638' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ fontSize: 48, marginRight: 16 }}>{def.emoji}</span>
            {def.name.toUpperCase()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: status.bg, padding: '12px 28px', borderRadius: 999, fontSize: 30, fontWeight: 900, letterSpacing: 3, animation: pulse ? 'mainSbPulse 1.6s ease-in-out infinite' : undefined }}>
            {status.pulse && <span style={{ width: 16, height: 16, borderRadius: 999, background: '#fff', marginRight: 14, display: 'inline-block' }} />}
            {status.label}
          </div>
        </div>

        {/* main row */}
        <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
          <TeamPanel side="home" name={snap.homeTeam} score={snap.homeScore} color={homeColor} logoUrl={snap.homeLogoUrl}
            winning={snap.homeScore > snap.awayScore && snap.status !== 'SCHEDULED'} hasPossession={ballSide === 'home'} />

          {/* center column */}
          <div style={{ width: 600, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#05070d' }}>
            <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 5, color: '#94a3b8' }}>{segmentLabel(def, snap)}</div>
            {hasClock ? (
              <div style={{
                fontSize: 188, fontWeight: 900, lineHeight: 1, marginTop: 18, fontVariantNumeric: 'tabular-nums',
                color: snap.clockRunning ? '#fbbf24' : '#e2e8f0',
                textShadow: snap.clockRunning ? '0 0 50px rgba(251,191,36,0.5)' : 'none', whiteSpace: 'nowrap',
              }}>
                {fmtClock(clockMs)}
              </div>
            ) : (
              <div style={{ fontSize: 150, fontWeight: 900, lineHeight: 1, marginTop: 24, color: '#e2e8f0' }}>{def.emoji}</div>
            )}
            {!c.hideWordmark && (
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 3, color: '#475569', marginTop: 18 }}>VENUEOS</div>
            )}
          </div>

          <TeamPanel side="away" name={snap.awayTeam} score={snap.awayScore} color={awayColor} logoUrl={snap.awayLogoUrl}
            winning={snap.awayScore > snap.homeScore && snap.status !== 'SCHEDULED'} hasPossession={ballSide === 'away'} />
        </div>
      </div>
    </div>
  );
}
