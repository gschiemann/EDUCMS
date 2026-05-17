"use client";
/**
 * VenueOS · Basketball celebration ribbons.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

interface SparklesProps { on: boolean; count: number; color: string; kf: string; dur: number; }
function Sparkles({ on, count, color, kf, dur }: SparklesProps) {
  if (!on) return null;
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const left = (i * 9.6 + (i * 3.7) % 6) % 100;
    const size = 6 + (i % 5) * 2;
    const delay = ((i % 12) * 0.08).toFixed(2);
    const d = ((dur + (i % 5) * 0.25)).toFixed(2);
    items.push(<span key={i} style={{ position: 'absolute', left: `${left}%`, bottom: 0, width: size, height: size, borderRadius: size, background: color, boxShadow: `0 0 12px ${color}`, animation: `${kf} ${d}s ease-out ${delay}s infinite`, willChange: 'transform, opacity' }}/>);
  }
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>{items}</div>;
}

/* ════════════════ 3-POINTER ════════════════ */

export interface CelBasketballThreeCfg extends BaseCfg {
  player?: string;
  threesTonight?: number;
}

export function CelBasketballThreeWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballThreeCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'CURRY';
  const threesTonight = c.threesTonight ?? 7;
  const pulse = `${animDurationSec(r.anim.speed, 1)}s`;
  const swoosh = `${animDurationSec(r.anim.speed, 1.5)}s`;
  const spin = `${animDurationSec(r.anim.speed, 1.5)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkThreePulse  { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celBkThreeSwoosh { 0% { stroke-dashoffset: 2200; } 100% { stroke-dashoffset: 0; } }
        @keyframes celBkThreeSpin   { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      `}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: `radial-gradient(ellipse at center, ${r.accent.highlight}22, transparent 60%)`, animation: animOn ? `celBkThreePulse ${pulse} ease-in-out infinite` : undefined }} />

      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 600 350 Q 3500 -300 6900 200" stroke={r.accent.primary} strokeWidth="20" strokeDasharray="40 25" fill="none" strokeLinecap="round" style={animOn ? { animation: `celBkThreeSwoosh ${swoosh} linear infinite` } : undefined} />
      </svg>

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
        <div style={{ width: height * 0.62, height: height * 0.62, borderRadius: '50%', background: '#dc6a1d', animation: animOn ? `celBkThreeSpin ${spin} linear infinite` : undefined, marginRight: '4%' }}>
          <svg viewBox="0 0 100 100" width="100%" height="100%">
            <circle cx="50" cy="50" r="48" fill="none" stroke="#0b0c0e" strokeWidth="2"/>
            <path d="M50 4 Q70 50 50 96" stroke="#0b0c0e" strokeWidth="2" fill="none"/>
            <path d="M4 50 Q50 30 96 50" stroke="#0b0c0e" strokeWidth="2" fill="none"/>
            <path d="M4 50 Q50 70 96 50" stroke="#0b0c0e" strokeWidth="2" fill="none"/>
          </svg>
        </div>
        <div>
          <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.14em' }}>FROM DOWNTOWN</div>
          <div style={{ color: r.accent.primary, fontSize: px(height, 0.58), lineHeight: 0.9, textShadow: `0 0 80px ${r.accent.highlight}` }}>3</div>
        </div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.5), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), marginTop: '2%' }}>{threesTonight} TONIGHT</div>
      </div>
    </div>
  );
}

/* ════════════════ SLAM DUNK ════════════════ */

export interface CelBasketballDunkCfg extends BaseCfg {
  player?: string;
  kind?: 'SLAM' | 'POSTER' | 'ALLEY-OOP' | 'TIP-IN' | 'REVERSE' | '360°' | 'TOMAHAWK';
}

export function CelBasketballDunkWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballDunkCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', accentColor: '#dc6a1d', highlightColor: '#dc6a1d', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'GIANNIS';
  const kind = c.kind ?? 'POSTER';
  const burst = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkDunkBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 60% { transform: scale(1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes celBkDunkRipple { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.3); } }
        @keyframes celBkDunkSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={100} color={r.accent.primary} kf="celBkDunkSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', left: '34%', right: '34%', top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 100 60" width="100%" height="80%">
          <rect x="20" y="6" width="60" height="6" fill={r.accent.primary}/>
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1={22 + i * 6} y1="12" x2={22 + i * 6} y2="50" stroke="#fff" strokeWidth=".4" style={{ animation: animOn ? `celBkDunkRipple 0.5s ${i * 0.04}s infinite` : undefined, transformOrigin: `${22 + i * 6}px 12px` }}/>
          ))}
        </svg>
      </div>

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celBkDunkBurst ${burst} ease-out both` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.14em' }}>{kind}!</div>
        <div style={{ fontSize: px(height, 0.62), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>SLAM</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.54), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), marginTop: '2%' }}>nothing but rim</div>
      </div>
    </div>
  );
}

/* ════════════════ BUZZER BEATER ════════════════ */

export interface CelBasketballBuzzerCfg extends BaseCfg {
  player?: string;
  clock?: string;
  kind?: 'GAME WINNER' | 'TIE GAME' | 'QUARTER BEATER';
}

export function CelBasketballBuzzerWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballBuzzerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#dc2626', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BOOKER';
  const clock = c.clock ?? '0.4';
  const kind = c.kind ?? 'GAME WINNER';
  const thump = `${animDurationSec(r.anim.speed, 0.4)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkBuzzerThump { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celBkBuzzerSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        backgroundImage: `repeating-linear-gradient(135deg, ${r.bg.color} 0 100px, #000 100px 200px)` }} />

      <Sparkles on={animOn} count={150} color={r.accent.highlight} kf="celBkBuzzerSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'center', animation: animOn ? `celBkBuzzerThump ${thump} ease-in-out infinite` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>AT THE BUZZER</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.75), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 80px ${r.accent.highlight}`, lineHeight: 0.9 }}>{clock}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.096) }}>SECONDS</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.42), lineHeight: 0.95, textShadow: `0 0 60px ${r.accent.highlight}` }}>{kind}</div>
        <div style={{ fontSize: px(height, 0.5), lineHeight: 1, marginTop: '2%' }}>{player}</div>
      </div>
    </div>
  );
}

/* ════════════════ BLOCK ════════════════ */

export interface CelBasketballBlockCfg extends BaseCfg {
  player?: string;
  blocksTonight?: number;
}

export function CelBasketballBlockWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballBlockCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a0a', accentColor: '#22c55e', highlightColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'EMBIID';
  const blocks = c.blocksTonight ?? 3;
  const burst = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const pulse = `${animDurationSec(r.anim.speed, 0.5)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkBlockBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 60% { transform: scale(1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes celBkBlockPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      `}</style>}

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celBkBlockBurst ${burst} ease-out both` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.14em' }}>GET THAT OUT!</div>
        <div style={{ fontSize: px(height, 0.62), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>BLOCK!</div>
      </div>

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', animation: animOn ? `celBkBlockPulse ${pulse} ease-in-out infinite` : undefined }}>
        <svg width={height * 0.46} height={height * 0.58} viewBox="0 0 60 80">
          <rect x="10" y="10" width="40" height="60" rx="4" fill={r.accent.primary} stroke="#fff" strokeWidth="2"/>
          <text x="30" y="60" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="800" fontSize="44" fill="#fff">×</text>
        </svg>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.46), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), marginTop: '2%' }}>{blocks} BLOCKS TONIGHT</div>
      </div>
    </div>
  );
}

/* ════════════════ STEAL ════════════════ */

export interface CelBasketballStealCfg extends BaseCfg {
  player?: string;
  stealsTonight?: number;
}

export function CelBasketballStealWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballStealCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a08', accentColor: '#22c55e', highlightColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'GILGEOUS';
  const steals = c.stealsTonight ?? 4;
  const sweep = `${animDurationSec(r.anim.speed, 1.4)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celBkStealSweep { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }`}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{ position: 'absolute', top: `${(i % 3) * 28 + 8}%`, left: 0, width: '14%', height: '12%', animation: animOn ? `celBkStealSweep ${sweep} linear ${i * 0.12}s infinite` : undefined, opacity: 0.5 + (i % 3) * 0.15 }}>
            <svg viewBox="0 0 280 60" preserveAspectRatio="none" width="100%" height="100%"><polygon points="0,30 220,30 220,5 280,30 220,55 220,30" fill={r.accent.primary}/></svg>
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.14em' }}>PICKED OFF!</div>
        <div style={{ fontSize: px(height, 0.58), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>STEAL</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.46), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), marginTop: '2%' }}>{steals} STEALS TONIGHT</div>
      </div>
    </div>
  );
}

/* ════════════════ ALLEY-OOP ════════════════ */

export interface CelBasketballAlleyOopCfg extends BaseCfg {
  passer?: string;
  dunker?: string;
}

export function CelBasketballAlleyOopWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballAlleyOopCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', accentColor: '#dc6a1d', accentColor2: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const passer = c.passer ?? 'DONCIC';
  const dunker = c.dunker ?? 'IRVING';
  const pulse = `${animDurationSec(r.anim.speed, 0.7)}s`;
  const swoosh = `${animDurationSec(r.anim.speed, 1.6)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkOopPulse  { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celBkOopSwoosh { 0% { stroke-dashoffset: 2200; } 100% { stroke-dashoffset: 0; } }
        @keyframes celBkOopSpark  { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={70} color={r.accent.highlight} kf="celBkOopSpark" dur={sparkDur} />

      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 900 300 Q 3500 -200 6700 280" stroke={r.accent.primary} strokeWidth="22" strokeDasharray="50 30" fill="none" style={animOn ? { animation: `celBkOopSwoosh ${swoosh} linear infinite` } : undefined} />
      </svg>

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ color: r.accent.highlight, fontSize: px(height, 0.09) }}>PASS</div>
        <div style={{ fontSize: px(height, 0.38), lineHeight: 1, marginTop: '2%' }}>{passer}</div>
      </div>

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', animation: animOn ? `celBkOopPulse ${pulse} ease-in-out infinite` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.58), lineHeight: 0.95, textShadow: `0 0 60px ${r.accent.primary}` }}>ALLEY</div>
        <div style={{ color: r.accent.highlight, fontSize: px(height, 0.58), lineHeight: 0.95, textShadow: `0 0 60px ${r.accent.highlight}` }}>OOP!</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)' }}>
        <div style={{ color: r.accent.highlight, fontSize: px(height, 0.09) }}>FINISH</div>
        <div style={{ fontSize: px(height, 0.38), lineHeight: 1, marginTop: '2%' }}>{dunker}</div>
      </div>
    </div>
  );
}

/* ════════════════ AND-ONE ════════════════ */

export interface CelBasketballAndOneCfg extends BaseCfg {
  player?: string;
}

export function CelBasketballAndOneWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballAndOneCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0e00', accentColor: '#ffd23a', accentColor2: '#dc6a1d', highlightColor: '#dc6a1d', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'TATUM';
  const thump = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const pulse = `${animDurationSec(r.anim.speed, 0.6)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkA1Thump { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.04); } }
        @keyframes celBkA1Pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      `}</style>}

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celBkA1Thump ${thump} ease-in-out infinite` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.5), lineHeight: 1, letterSpacing: '-0.04em' }}>AND</div>
      </div>

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: r.accent.highlight, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.8), textShadow: `0 0 80px ${r.accent.highlight}`, animation: animOn ? `celBkA1Pulse ${pulse} ease-in-out infinite` : undefined }}>1</div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.1em' }}>FOUL ON THE PLAY</div>
        <div style={{ fontSize: px(height, 0.46), lineHeight: 1, marginTop: '2%' }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.088), marginTop: '2%' }}>shooting 1 of 1</div>
      </div>
    </div>
  );
}

/* ════════════════ TRIPLE-DOUBLE ════════════════ */

export interface CelBasketballTripleDoubleCfg extends BaseCfg {
  player?: string;
  line?: string;
  careerCount?: number;
}

export function CelBasketballTripleDoubleWidget({ config, live = true, height = 480 }: WidgetProps<CelBasketballTripleDoubleCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d0820', accentColor: '#7c3aed', highlightColor: '#7c3aed', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'JOKIC';
  const line = c.line ?? '24 PTS · 12 REB · 13 AST';
  const count = c.careerCount ?? 18;
  const slide = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const punch = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);
  const stats = line.split(' · ');

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celBkTdSlide { 0% { transform: translateX(-30%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celBkTdPunch { 0% { transform: scale(2.4); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.06); } }
        @keyframes celBkTdSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={120} color={r.accent.highlight} kf="celBkTdSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celBkTdSlide ${slide} ease-out` : undefined }}>
        <div style={{ color: '#a78bfa', fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>TRIPLE-DOUBLE</div>
        <div style={{ fontSize: px(height, 0.46), lineHeight: 1, marginTop: '2%' }}>{player}</div>
        <div style={{ color: '#a78bfa', fontSize: px(height, 0.096), marginTop: '2%' }}>career #{count}</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
        {stats.map((s, i) => {
          const [val, label] = s.split(' ');
          return (
            <div key={i} style={{ textAlign: 'center', marginLeft: i === 0 ? 0 : '5%', animation: animOn ? `celBkTdPunch ${punch} ${i * 0.15}s both` : undefined }}>
              <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.42), textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 0.9 }}>{val}</div>
              <div style={{ color: '#a78bfa', fontSize: px(height, 0.075) }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
