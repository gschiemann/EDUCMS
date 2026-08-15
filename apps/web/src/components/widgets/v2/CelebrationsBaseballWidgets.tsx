"use client";
/**
 * VenueOS · Baseball celebration ribbons. Drop into any zone; reflows
 * from full 7680×480 bowl ribbon down to a concourse fascia.
 *
 * Each widget is ASPECT-AWARE. It measures its own rendered box and
 * picks one of two layouts:
 *   - wide  (≥ 3.2:1, an LED ribbon)  → the original horizontal strip.
 *   - scene (< 3.2:1, a ~16:9 board)  → a centered, vertically-stacked
 *                                       scene that fits a 16:9 box with
 *                                       no overlap.
 * Both layouts render the SAME content; only the arrangement differs.
 *
 * - Each widget uses widget-prefixed @keyframes (no cross-widget collisions).
 * - Only `transform` / `opacity` animate (LED-controller safe).
 * - Animations gated on `r.anim.on && live`.
 */
import React from 'react';
import type { CSSProperties } from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';
import { sceneCss } from '../scene-css';

/* ──────────── shared helpers (local; no globals) ──────────── */

function px(zone: number, frac: number): number {
  return Math.max(8, Math.round(zone * frac));
}

/** Hero glyph size for the scene layout — bounded by BOTH axes so it can
 *  never overflow a near-16:9 box no matter how it is shaped. */
function heroSize(width: number, height: number): number {
  return Math.max(8, Math.round(Math.min(height * 0.34, width * 0.13)));
}

/** Aspect threshold: at or above this width/height ratio we treat the
 *  zone as a ribbon and keep the horizontal layout. */
const WIDE_RATIO = 3.2;

interface SparklesProps { on: boolean; count: number; color: string; kf: string; dur: number; }
function Sparkles({ on, count, color, kf, dur }: SparklesProps) {
  if (!on) return null;
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const leftPct = (i * 9.6 + (i * 3.7) % 6) % 100;
    const size = 6 + (i % 5) * 2;
    const delay = ((i % 12) * 0.08).toFixed(2);
    const d = ((dur + (i % 5) * 0.25)).toFixed(2);
    items.push(
      <span key={i} style={{
        position: 'absolute', left: `${leftPct}%`, bottom: 0, width: size, height: size, borderRadius: size,
        background: color, boxShadow: `0 0 12px ${color}`,
        animation: `${kf} ${d}s ease-out ${delay}s infinite`, willChange: 'transform, opacity',
      }} />
    );
  }
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>{items}</div>;
}

/* ════════════════ STRIKEOUT ════════════════ */

export interface CelBaseballStrikeoutCfg extends BaseCfg {
  pitcher?: string;
  kCount?: number;
  team?: string;
}

export function CelBaseballStrikeoutWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballStrikeoutCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', accentColor: '#dc2626', highlightColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const pitcher = c.pitcher ?? 'BURNES';
  const k = c.kCount ?? 11;
  const team = c.team ?? 'starting rotation';
  const spin = `${animDurationSec(r.anim.speed, 1.8)}s`;
  const blink = `${animDurationSec(r.anim.speed, 0.6)}s`;

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbSoSpin  { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes celBbSoBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `)}</style>}

      {wide ? (
        <>
          {r.show('ball', true) && (
            <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', width: height * 0.65, height: height * 0.65, borderRadius: '50%', background: '#fff', boxShadow: 'inset 0 0 0 2px #d4d3cd' }}>
              <div style={{ width: '100%', height: '100%', animation: animOn ? `celBbSoSpin ${spin} linear infinite` : undefined, willChange: animOn ? 'transform' : undefined }}>
                <svg viewBox="0 0 100 100" width="100%" height="100%">
                  <path d="M14 28 Q35 50 14 72" stroke={r.accent.primary} strokeWidth="3" fill="none"/>
                  <path d="M86 28 Q65 50 86 72" stroke={r.accent.primary} strokeWidth="3" fill="none"/>
                </svg>
              </div>
            </div>
          )}

          {/* 2026-07-03 — Rule #10 variant 3: was `{left:'20%', right:'38%',
              top:0, bottom:0}` (4 explicit sides, non-uniform, top===0),
              which the browser's CSSOM re-serializes to the `inset`
              shorthand with a leading-zero value (top first: 0px, then
              38% 0px 20%) — collides with the player/layout.tsx
              Chromium-83 polyfill's attribute-substring selector for a
              leading-zero inset value, force-zeroing all sides. Fixed to
              3 sides + explicit width (100% - 20% - 38% = 42%) —
              identical computed geometry. See CLAUDE.md rule #10
              (2026-07-03 entry). */}
          <div style={{ position: 'absolute', left: '20%', top: 0, bottom: 0, width: '42%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                fontFamily: r.font.family, fontWeight: r.font.weight, fontSize: px(height, 0.92), lineHeight: 1,
                marginLeft: i === 0 ? 0 : '8%', marginRight: i === 2 ? 0 : '8%',
                color: i === 2 ? r.accent.primary : r.font.color,
                textShadow: i === 2 ? `0 0 80px ${r.accent.primary}` : r.font.shadow,
                animation: animOn ? `celBbSoBlink ${blink} ${i * 0.2}s infinite` : undefined,
                letterSpacing: '-0.04em', willChange: animOn ? 'opacity' : undefined,
              }}>K</div>
            ))}
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right', paddingLeft: '2%', borderLeft: `4px solid ${r.accent.primary}` }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.09), letterSpacing: '0.12em', fontWeight: 800, textTransform: 'uppercase' }}>STRIKEOUT · #{k} TONIGHT</div>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1, marginTop: '2%' }}>{pitcher}</div>
            <div style={{ fontSize: px(height, 0.075), color: '#9aa3b2', fontWeight: 700, marginTop: '2%' }}>{team}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {r.show('ball', true) && (
            <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: heroSize(width, height) * 2.6, height: heroSize(width, height) * 2.6, borderRadius: '50%', background: '#fff', opacity: 0.08 }}>
              <div style={{ width: '100%', height: '100%', animation: animOn ? `celBbSoSpin ${spin} linear infinite` : undefined, willChange: animOn ? 'transform' : undefined }}>
                <svg viewBox="0 0 100 100" width="100%" height="100%">
                  <path d="M14 28 Q35 50 14 72" stroke={r.accent.primary} strokeWidth="3" fill="none"/>
                  <path d="M86 28 Q65 50 86 72" stroke={r.accent.primary} strokeWidth="3" fill="none"/>
                </svg>
              </div>
            </div>
          )}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.06), letterSpacing: '0.12em', fontWeight: 800, textTransform: 'uppercase', marginBottom: px(height, 0.04) }}>STRIKEOUT · #{k} TONIGHT</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  fontFamily: r.font.family, fontWeight: r.font.weight, fontSize: heroSize(width, height), lineHeight: 1,
                  marginLeft: i === 0 ? 0 : px(height, 0.04), marginRight: i === 2 ? 0 : px(height, 0.04),
                  color: i === 2 ? r.accent.primary : r.font.color,
                  textShadow: i === 2 ? `0 0 80px ${r.accent.primary}` : r.font.shadow,
                  animation: animOn ? `celBbSoBlink ${blink} ${i * 0.2}s infinite` : undefined,
                  letterSpacing: '-0.04em', willChange: animOn ? 'opacity' : undefined,
                }}>K</div>
              ))}
            </div>
            <div style={{ fontSize: px(height, 0.16), lineHeight: 1, marginTop: px(height, 0.05) }}>{pitcher}</div>
            <div style={{ fontSize: px(height, 0.055), color: '#9aa3b2', fontWeight: 700, marginTop: px(height, 0.025) }}>{team}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ HOME RUN ════════════════ */

export interface CelBaseballHomeRunCfg extends BaseCfg {
  player?: string;
  distance?: string;
  exitVelo?: string;
}

export function CelBaseballHomeRunWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballHomeRunCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ce1141', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'TUCKER';
  const distance = c.distance ?? '418 FT';
  const velo = c.exitVelo ?? '108 MPH EXIT VELOCITY';
  const swoosh = `${animDurationSec(r.anim.speed, 1.5)}s`;
  const slide = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbHrSwoosh { 0% { stroke-dashoffset: 2200; } 100% { stroke-dashoffset: 0; } }
        @keyframes celBbHrSlideL { 0% { transform: translateX(-30%); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbHrSlideR { 0% { transform: translateX( 30%); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbHrSpark  { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
        @keyframes celBbHrPunch  { 0% { transform: scale(2.2); opacity: 0; } 35% { transform: scale(1); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      `)}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 8px, rgba(255,255,255,0) 8px 16px)' }} />

      <Sparkles on={animOn} count={wide ? 80 : 60} color={r.accent.highlight} kf="celBbHrSpark" dur={sparkDur} />

      {wide ? (
        <>
          <svg viewBox="0 0 7680 480" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="celBbHrTrail" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0"/>
                <stop offset="100%" stopColor={r.accent.highlight} stopOpacity="1"/>
              </linearGradient>
            </defs>
            <path d="M 200 400 Q 3000 -800 6800 380" stroke="url(#celBbHrTrail)" strokeWidth="22" fill="none" strokeDasharray="2200" style={animOn ? { animation: `celBbHrSwoosh ${swoosh} ease-out infinite` } : undefined} />
            <circle cx="6800" cy="380" r="40" fill="#fff" />
          </svg>

          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ animation: animOn ? `celBbHrSlideL ${slide} ease-out both` : undefined }}>
              <div style={{ color: r.accent.primary, fontWeight: r.font.weight, fontSize: px(height, 0.1), letterSpacing: '0.16em', textShadow: `0 0 30px ${r.accent.highlight}` }}>HOME RUN!</div>
              <div style={{ fontSize: px(height, 0.46), lineHeight: 1, letterSpacing: '-0.04em', textShadow: '0 6px 30px #000', marginTop: '2%' }}>{player}</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ animation: animOn ? `celBbHrSlideR ${slide} ease-out both` : undefined }}>
              <div style={{ color: r.accent.primary, fontWeight: r.font.weight, fontSize: px(height, 0.5), fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: 1, textShadow: `0 0 50px ${r.accent.highlight}` }}>{distance}</div>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.08), marginTop: '2%' }}>{velo}</div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '70%', height: '70%', opacity: 0.5 }}>
            <defs>
              <linearGradient id="celBbHrTrailScene" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0"/>
                <stop offset="100%" stopColor={r.accent.highlight} stopOpacity="1"/>
              </linearGradient>
            </defs>
            <path d="M 80 540 Q 500 -120 920 520" stroke="url(#celBbHrTrailScene)" strokeWidth="14" fill="none" strokeDasharray="2200" style={animOn ? { animation: `celBbHrSwoosh ${swoosh} ease-out infinite` } : undefined} />
            <circle cx="920" cy="520" r="20" fill="#fff" />
          </svg>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', animation: animOn ? `celBbHrPunch ${slide} ease-out both` : undefined }}>
            <div style={{ color: r.accent.primary, fontWeight: r.font.weight, fontSize: px(height, 0.075), letterSpacing: '0.16em', textShadow: `0 0 30px ${r.accent.highlight}`, marginBottom: px(height, 0.035) }}>HOME RUN!</div>
            <div style={{ fontSize: px(height, 0.175), lineHeight: 1, letterSpacing: '-0.04em', textShadow: '0 6px 30px #000' }}>{player}</div>
            <div style={{ color: r.accent.primary, fontWeight: r.font.weight, fontSize: heroSize(width, height), fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: 1, textShadow: `0 0 50px ${r.accent.highlight}`, marginTop: px(height, 0.045) }}>{distance}</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.055), marginTop: px(height, 0.03) }}>{velo}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ GRAND SLAM ════════════════ */

export interface CelBaseballGrandSlamCfg extends BaseCfg {
  player?: string;
  score?: string;
}

export function CelBaseballGrandSlamWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballGrandSlamCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#5e0612', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'DEVERS';
  const score = c.score ?? '7-2';
  const punch = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const blink = `${animDurationSec(r.anim.speed, 0.8)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  const basePositions: Array<CSSProperties> = [
    { top: 0,    left: '50%' },
    { top: '50%', right: 0 },
    { bottom: 0, left: '50%' },
    { top: '50%', left: 0 },
  ];

  // Decorative four-base diamond, sized to a side length.
  const diamond = (side: number) => (
    <div style={{ position: 'relative', width: side, height: side }}>
      {basePositions.map((pos, i) => (
        <div key={i} style={{ position: 'absolute', ...pos, transform: 'translate(-50%, -50%) rotate(45deg)', width: side * 0.26, height: side * 0.26, background: r.accent.primary, boxShadow: `0 0 50px ${r.accent.primary}`, animation: animOn ? `celBbGsBlink ${blink} ${i * 0.18}s infinite` : undefined }} />
      ))}
    </div>
  );

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbGsBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes celBbGsPunch { 0% { transform: scale(2.4); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 70% { transform: scale(1); } 100% { transform: scale(1.06); } }
        @keyframes celBbGsSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `)}</style>}

      <Sparkles on={animOn} count={wide ? 120 : 80} color={r.accent.highlight} kf="celBbGsSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', width: height * 0.7, height: height * 0.7 }}>
            {basePositions.map((pos, i) => (
              <div key={i} style={{ position: 'absolute', ...pos, transform: 'translate(-50%, -50%) rotate(45deg)', width: height * 0.18, height: height * 0.18, background: r.accent.primary, boxShadow: `0 0 50px ${r.accent.primary}`, animation: animOn ? `celBbGsBlink ${blink} ${i * 0.18}s infinite` : undefined }} />
            ))}
          </div>

          <div style={{ position: 'absolute', left: '34%', right: '20%', top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }}>
            <div style={{ animation: animOn ? `celBbGsPunch ${punch} ease-out both` : undefined }}>
              <div style={{ fontSize: px(height, 0.6), lineHeight: 0.9, color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}55`, letterSpacing: '-0.04em' }}>GRAND</div>
              <div style={{ fontSize: px(height, 0.6), lineHeight: 0.9, color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}55`, letterSpacing: '-0.04em' }}>SLAM</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.13) }}>+4 RUNS</div>
            <div style={{ fontSize: px(height, 0.38), lineHeight: 1, marginTop: '2%' }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.18), fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: '2%' }}>{score}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.16 }}>
            {diamond(Math.min(height * 0.92, width * 0.5))}
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', animation: animOn ? `celBbGsPunch ${punch} ease-out both` : undefined }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.07) }}>+4 RUNS</div>
            <div style={{ fontSize: heroSize(width, height), lineHeight: 0.9, color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}55`, letterSpacing: '-0.04em', marginTop: px(height, 0.03) }}>GRAND</div>
            <div style={{ fontSize: heroSize(width, height), lineHeight: 0.9, color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}55`, letterSpacing: '-0.04em' }}>SLAM</div>
            <div style={{ fontSize: px(height, 0.15), lineHeight: 1, marginTop: px(height, 0.045) }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: px(height, 0.025) }}>{score}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ NO HITTER ════════════════ */

export interface CelBaseballNoHitterCfg extends BaseCfg {
  pitcher?: string;
  inning?: number;
}

export function CelBaseballNoHitterWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballNoHitterCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', accentColor: '#22c55e', highlightColor: '#ffffff', ...c.style });
  const animOn = r.anim.on && live;
  const pitcher = c.pitcher ?? 'KERSHAW';
  const inning = c.inning ?? 9;
  const glow = `${animDurationSec(r.anim.speed, 2)}s`;
  const pulse = `${animDurationSec(r.anim.speed, 2)}s`;
  const slide = `${animDurationSec(r.anim.speed, 0.7)}s`;

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbNhGlow  { 0%, 100% { filter: drop-shadow(0 0 30px ${r.accent.highlight}); } 50% { filter: drop-shadow(0 0 80px ${r.accent.highlight}); } }
        @keyframes celBbNhPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes celBbNhSlide { 0% { transform: translateX(-30%); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbNhRise  { 0% { transform: translateY(18%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `)}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: `radial-gradient(ellipse at center, ${r.accent.primary}55 0%, transparent 60%)`, animation: animOn ? `celBbNhPulse ${pulse} ease-in-out infinite` : undefined }} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ animation: animOn ? `celBbNhSlide ${slide} ease-out both` : undefined }}>
              <div style={{ color: '#9aa3b2', fontSize: px(height, 0.1), letterSpacing: '0.18em' }}>HISTORY IN PROGRESS</div>
              <div style={{ fontSize: px(height, 0.42), lineHeight: 1, letterSpacing: '-0.04em', textShadow: `0 0 50px ${r.accent.highlight}`, marginTop: '2%' }}>NO HITTER</div>
            </div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', animation: animOn ? `celBbNhGlow ${glow} ease-in-out infinite` : undefined }}>
            <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: r.font.weight, fontSize: px(height, 0.88), lineHeight: 0.85, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}66` }}>0</div>
            <div style={{ fontSize: px(height, 0.11), letterSpacing: '0.12em', color: '#9aa3b2' }}>HITS</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{pitcher}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.11), marginTop: '2%' }}>thru {inning} innings</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: animOn ? `celBbNhRise ${slide} ease-out both` : undefined }}>
            <div style={{ color: '#9aa3b2', fontSize: px(height, 0.055), letterSpacing: '0.18em' }}>HISTORY IN PROGRESS</div>
            <div style={{ fontSize: px(height, 0.13), lineHeight: 1, letterSpacing: '-0.04em', textShadow: `0 0 50px ${r.accent.highlight}`, marginTop: px(height, 0.03) }}>NO HITTER</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: px(height, 0.04), animation: animOn ? `celBbNhGlow ${glow} ease-in-out infinite` : undefined }}>
              <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: r.font.weight, fontSize: heroSize(width, height), lineHeight: 0.85, textShadow: `0 0 80px ${r.accent.highlight}, 0 0 160px ${r.accent.highlight}66` }}>0</div>
              <div style={{ fontSize: px(height, 0.06), letterSpacing: '0.12em', color: '#9aa3b2' }}>HITS</div>
            </div>
            <div style={{ fontSize: px(height, 0.16), lineHeight: 1, marginTop: px(height, 0.045) }}>{pitcher}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.055), marginTop: px(height, 0.02) }}>thru {inning} innings</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ STOLEN BASE ════════════════ */

export interface CelBaseballStolenBaseCfg extends BaseCfg {
  runner?: string;
  base?: '2ND' | '3RD' | 'HOME';
  seasonSb?: number;
}

export function CelBaseballStolenBaseWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballStolenBaseCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a08', accentColor: '#22c55e', highlightColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const runner = c.runner ?? 'WITT JR.';
  const base = c.base ?? '2ND';
  const seasonSb = c.seasonSb ?? 14;
  const sweep = `${animDurationSec(r.anim.speed, 2.4)}s`;
  const rise = `${animDurationSec(r.anim.speed, 0.5)}s`;

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbSbSweep { 0% { transform: translateX(-30%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(220%); opacity: 0; } }
        @keyframes celBbSbRise  { 0% { transform: translateY(16%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `)}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none', opacity: wide ? 1 : 0.4 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ position: 'absolute', top: `${(i % 3) * 30 + 10}%`, left: 0, width: '14%', height: '12%', animation: animOn ? `celBbSbSweep ${sweep} linear ${i * 0.24}s infinite` : undefined, opacity: 0.4 + (i % 3) * 0.2, willChange: animOn ? 'transform, opacity' : undefined }}>
            <svg viewBox="0 0 280 60" preserveAspectRatio="none" width="100%" height="100%">
              <polygon points="0,30 220,30 220,5 280,30 220,55 220,30" fill={r.accent.primary}/>
            </svg>
          </div>
        ))}
      </div>

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>SAFE!</div>
            <div style={{ fontSize: px(height, 0.54), lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: '2%' }}>STEAL</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{runner}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), marginTop: '2%' }}>{base} BASE</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.09), letterSpacing: '0.1em' }}>SEASON</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.58), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1 }}>{seasonSb}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', animation: animOn ? `celBbSbRise ${rise} ease-out both` : undefined }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.06), letterSpacing: '0.14em' }}>SAFE!</div>
            <div style={{ fontSize: px(height, 0.2), lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: px(height, 0.025) }}>STEAL</div>
            <div style={{ fontSize: px(height, 0.15), lineHeight: 1, marginTop: px(height, 0.04) }}>{runner}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.06), marginTop: px(height, 0.02) }}>{base} BASE</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.055), letterSpacing: '0.1em', marginTop: px(height, 0.05) }}>SEASON</div>
            <div style={{ color: r.accent.primary, fontSize: heroSize(width, height), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1 }}>{seasonSb}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ DOUBLE PLAY ════════════════ */

export interface CelBaseballDoublePlayCfg extends BaseCfg {
  combo?: string;
  players?: string[];
}

export function CelBaseballDoublePlayWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballDoublePlayCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a1a30', accentColor: '#22d39b', highlightColor: '#22d39b', ...c.style });
  const animOn = r.anim.on && live;
  const combo = c.combo ?? '6-4-3';
  const players = c.players ?? ['LINDOR', 'ALBIES', 'OLSON'];
  const swoosh = `${animDurationSec(r.anim.speed, 2)}s`;
  const slide = `${animDurationSec(r.anim.speed, 0.4)}s`;
  const parts = combo.split('-');

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbDpSwoosh { 0% { stroke-dashoffset: 2200; } 100% { stroke-dashoffset: 0; } }
        @keyframes celBbDpSlide  { 0% { transform: translateX(20%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbDpRise   { 0% { transform: translateY(20%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `)}</style>}

      {wide ? (
        <>
          <svg viewBox="0 0 7680 480" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            <path d="M 800 280 Q 2200 100 3700 280 Q 5100 460 6500 280" stroke={r.accent.primary} strokeWidth="14" fill="none" strokeDasharray="40 30" style={animOn ? { animation: `celBbDpSwoosh ${swoosh} linear infinite` } : undefined}/>
          </svg>

          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>TURN TWO!</div>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1, letterSpacing: '-0.04em', marginTop: '2%' }}>DOUBLE PLAY</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: r.accent.primary, fontSize: px(height, 0.62), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 60px ${r.accent.highlight}` }}>{combo}</div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            {players.slice(0, 3).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', marginBottom: i === 2 ? 0 : '2%', animation: animOn ? `celBbDpSlide ${slide} ${i * 0.15}s both` : undefined }}>
                <span style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.08), marginRight: '4%' }}>{parts[i] ?? ''}</span>
                <span style={{ fontSize: px(height, 0.13) }}>{p}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid meet" aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '74%', height: '74%', opacity: 0.4 }}>
            <path d="M 80 220 Q 320 80 500 220 Q 680 360 920 220" stroke={r.accent.primary} strokeWidth="10" fill="none" strokeDasharray="40 30" style={animOn ? { animation: `celBbDpSwoosh ${swoosh} linear infinite` } : undefined}/>
          </svg>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.06), letterSpacing: '0.14em' }}>TURN TWO!</div>
            <div style={{ fontSize: px(height, 0.13), lineHeight: 1, letterSpacing: '-0.04em', marginTop: px(height, 0.02) }}>DOUBLE PLAY</div>
            <div style={{ color: r.accent.primary, fontSize: heroSize(width, height), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1, marginTop: px(height, 0.04) }}>{combo}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: px(height, 0.045) }}>
              {players.slice(0, 3).map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: i === 2 ? 0 : px(height, 0.018), animation: animOn ? `celBbDpRise ${slide} ${i * 0.12}s both` : undefined }}>
                  <span style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.055), marginRight: px(height, 0.03) }}>{parts[i] ?? ''}</span>
                  <span style={{ fontSize: px(height, 0.085) }}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TRIPLE PLAY ════════════════ */

export interface CelBaseballTriplePlayCfg extends BaseCfg {
  caption?: string;
}

export function CelBaseballTriplePlayWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballTriplePlayCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#3a0008', accentColor: '#ffd23a', accentColor2: '#dc2626', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const caption = c.caption ?? '1st in 6 yrs';
  const burst = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const punch = `${animDurationSec(r.anim.speed, 0.7)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbTpBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 60% { transform: scale(1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes celBbTpBurstR { 0% { transform: rotate(45deg) scale(0); opacity: 0; } 30% { transform: rotate(45deg) scale(1.15); opacity: 1; } 60% { transform: rotate(45deg) scale(1); } 100% { transform: rotate(45deg) scale(1); opacity: 1; } }
        @keyframes celBbTpPunch { 0% { transform: scale(2.4); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.06); } }
        @keyframes celBbTpSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `)}</style>}

      <Sparkles on={animOn} count={wide ? 150 : 90} color={r.accent.highlight} kf="celBbTpSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ width: height * 0.42, height: height * 0.42, background: r.accent.primary, transform: 'rotate(45deg)', boxShadow: `0 0 80px ${r.accent.highlight}`, marginLeft: n === 1 ? 0 : '3%', marginRight: n === 3 ? 0 : '3%', animation: animOn ? `celBbTpBurst ${burst} ${n * 0.15}s both` : undefined }} />
            ))}
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ animation: animOn ? `celBbTpPunch ${punch} ease-out 0.5s both` : undefined }}>
              <div style={{ fontSize: px(height, 0.75), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.font.color}` }}>TRIPLE</div>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.75), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}` }}>PLAY</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', color: r.accent.primary, fontSize: px(height, 0.09), maxWidth: '20%', lineHeight: 1.1, textAlign: 'right', textShadow: `0 0 30px ${r.accent.highlight}` }}>{caption}</div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.18 }}>
            {[1, 2, 3].map(n => {
              const side = Math.min(height * 0.34, width * 0.13);
              return (
                <div key={n} style={{ width: side, height: side, background: r.accent.primary, transform: 'rotate(45deg)', boxShadow: `0 0 80px ${r.accent.highlight}`, marginLeft: n === 1 ? 0 : px(height, 0.035), marginRight: n === 3 ? 0 : px(height, 0.035), animation: animOn ? `celBbTpBurstR ${burst} ${n * 0.15}s both` : undefined }} />
              );
            })}
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', animation: animOn ? `celBbTpPunch ${punch} ease-out 0.5s both` : undefined }}>
            <div style={{ fontSize: heroSize(width, height), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.font.color}` }}>TRIPLE</div>
            <div style={{ color: r.accent.primary, fontSize: heroSize(width, height), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}` }}>PLAY</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.07), lineHeight: 1.1, textAlign: 'center', textShadow: `0 0 30px ${r.accent.highlight}`, marginTop: px(height, 0.05) }}>{caption}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ WALK-OFF ════════════════ */

export interface CelBaseballWalkOffCfg extends BaseCfg {
  teamName?: string;
  hero?: string;
  finalScore?: string;
  innings?: number;
}

export function CelBaseballWalkOffWidget({ config, live = true, height = 480 }: WidgetProps<CelBaseballWalkOffCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#dc2626', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const teamName = c.teamName ?? 'BULLS';
  const hero = c.hero ?? 'JUDGE';
  const score = c.finalScore ?? '5-4';
  const innings = c.innings ?? 11;
  const fly = `${animDurationSec(r.anim.speed, 4)}s`;
  const slide = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{sceneCss(`
        @keyframes celBbWoFly    { from { transform: translateX(0); } to { transform: translateX(-200px); } }
        @keyframes celBbWoSpark  { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
        @keyframes celBbWoSlideL { 0% { transform: translateX(-30%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbWoSlideR { 0% { transform: translateX(30%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBbWoRise   { 0% { transform: translateY(20%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `)}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `repeating-linear-gradient(135deg, ${r.bg.color} 0 100px, #000 100px 200px)`, animation: animOn ? `celBbWoFly ${fly} linear infinite` : undefined, willChange: animOn ? 'transform' : undefined }} />

      <Sparkles on={animOn} count={wide ? 120 : 80} color={r.accent.highlight} kf="celBbWoSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ animation: animOn ? `celBbWoSlideL ${slide} ease-out` : undefined }}>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.14em' }}>WALK-OFF WIN</div>
              <div style={{ fontSize: px(height, 0.46), lineHeight: 0.95, textShadow: '0 6px 30px #000', marginTop: '2%' }}>{teamName}</div>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.1), marginTop: '2%' }}>{innings} INNINGS · {score}</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ animation: animOn ? `celBbWoSlideR ${slide} ease-out` : undefined }}>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.13) }}>HERO</div>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.58), lineHeight: 0.9, textShadow: `0 0 50px ${r.accent.highlight}` }}>{hero}</div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', animation: animOn ? `celBbWoRise ${slide} ease-out both` : undefined }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.07), letterSpacing: '0.14em' }}>WALK-OFF WIN</div>
            <div style={{ fontSize: px(height, 0.2), lineHeight: 0.95, textShadow: '0 6px 30px #000', marginTop: px(height, 0.025) }}>{teamName}</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.06), marginTop: px(height, 0.025) }}>{innings} INNINGS · {score}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.06), marginTop: px(height, 0.05) }}>HERO</div>
            <div style={{ color: r.accent.primary, fontSize: heroSize(width, height), lineHeight: 0.9, textShadow: `0 0 50px ${r.accent.highlight}` }}>{hero}</div>
          </div>
        </div>
      )}
    </div>
  );
}
