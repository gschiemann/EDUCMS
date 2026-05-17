"use client";
/**
 * VenueOS · Soccer celebration ribbons.
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

/* ════════════════ GOOOOAL ════════════════ */

export interface CelSoccerGoalCfg extends BaseCfg {
  scorer?: string;
  minute?: string;
  score?: string;
}

export function CelSoccerGoalWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerGoalCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#22c55e', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'MESSI';
  const minute = c.minute ?? "63'";
  const score = c.score ?? '2-1';
  const sparkDur = animDurationSec(r.anim.speed, 2);
  const flyDur = `${animDurationSec(r.anim.speed, 8)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celScGoalFly   { from { transform: translateX(0); } to { transform: translateX(-200px); } }
        @keyframes celScGoalSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `repeating-linear-gradient(0deg, ${r.bg.color} 0 80px, rgba(0,0,0,0.2) 80px 160px)`, animation: animOn ? `celScGoalFly ${flyDur} linear infinite` : undefined, willChange: animOn ? 'transform' : undefined }} />
      <Sparkles on={animOn} count={140} color={r.accent.highlight} kf="celScGoalSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              fontWeight: 800, fontSize: px(height, 0.54), letterSpacing: '-0.04em', lineHeight: 1,
              color: i === 0 ? r.accent.highlight : `${r.accent.highlight}${Math.max(0xa - i, 1).toString(16)}0`,
              textShadow: i === 0 ? `0 0 80px ${r.accent.highlight}` : 'none',
              marginRight: '4%',
            }}>GOOOOAL!</div>
          ))}
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '5%', left: '5%', right: '5%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>{minute}</div>
          <div style={{ fontSize: px(height, 0.29), lineHeight: 1, marginTop: '1%' }}>{scorer}</div>
        </div>
        <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.29), textShadow: `0 0 50px ${r.accent.highlight}` }}>{score}</div>
      </div>
    </div>
  );
}

/* ════════════════ HAT TRICK ════════════════ */

export interface CelSoccerHatTrickCfg extends BaseCfg {
  player?: string;
  goals?: string[];
}

export function CelSoccerHatTrickWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerHatTrickCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ce1141', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'HAALAND';
  const goals = c.goals ?? ["12'", "38'", "81'"];
  const drop = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celScHtDrop  { 0% { transform: translateY(-30%) rotate(-8deg); opacity: 0; } 60% { transform: translateY(2%) rotate(2deg); opacity: 1; } 100% { transform: translateY(0) rotate(0); } }
        @keyframes celScHtSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={120} color={r.accent.highlight} kf="celScHtSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.125), letterSpacing: '0.14em' }}>HAT TRICK!</div>
        <div style={{ fontSize: px(height, 0.5), lineHeight: 1, textShadow: '0 0 60px #000', marginTop: '2%' }}>{player}</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
        {goals.slice(0, 3).map((m, i) => (
          <div key={i} style={{ background: r.accent.primary, color: '#000', padding: '6% 5%', borderRadius: 18, marginLeft: i === 0 ? 0 : '3%', boxShadow: `0 0 40px ${r.accent.highlight}`, animation: animOn ? `celScHtDrop ${drop} ${i * 0.2}s both` : undefined, minWidth: px(height, 0.42) }}>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.066), letterSpacing: '0.06em' }}>GOAL {i + 1}</div>
            <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: px(height, 0.25), lineHeight: 1 }}>{m}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════ GOLAZO ════════════════ */

export interface CelSoccerGolazoCfg extends BaseCfg {
  player?: string;
  kind?: 'BICYCLE KICK' | 'HEADER' | 'LONG RANGE' | 'FREE KICK' | 'VOLLEY' | 'RABONA';
}

export function CelSoccerGolazoWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerGolazoCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#fff', accentColor: '#ffd23a', accentColor2: '#dc2626', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BELLINGHAM';
  const kind = c.kind ?? 'BICYCLE KICK';
  const pulse = `${animDurationSec(r.anim.speed, 1)}s`;
  const punch = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celScGlPunch { 0% { transform: scale(2.4); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.06); } }
        @keyframes celScGlPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celScGlSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={150} color={r.accent.highlight} kf="celScGlSpark" dur={sparkDur} />
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: px(height, 2.9), height: px(height, 2.9), background: `radial-gradient(circle, ${r.accent.highlight}66 0%, transparent 60%)`, animation: animOn ? `celScGlPulse ${pulse} ease-in-out infinite` : undefined }} />

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celScGlPunch ${punch} ease-out both` : undefined }}>
        <div style={{ color: r.accent.secondary, fontSize: px(height, 0.125), letterSpacing: '0.14em' }}>{kind}</div>
        <div style={{ color: r.accent.primary, fontStyle: 'italic', fontSize: px(height, 0.71), lineHeight: 0.85, textShadow: `0 0 100px ${r.accent.highlight}, 0 0 200px ${r.accent.highlight}44`, letterSpacing: '-0.04em' }}>GOLAZO!</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.5), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.096), marginTop: '2%' }}>world-class strike</div>
      </div>
    </div>
  );
}

/* ════════════════ RED CARD ════════════════ */

export interface CelSoccerRedCardCfg extends BaseCfg {
  player?: string;
  number?: string;
  reason?: 'violent conduct' | 'denial of goal-scoring opportunity' | '2nd yellow' | 'serious foul play' | 'spitting' | 'foul language';
}

export function CelSoccerRedCardWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerRedCardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#dc2626', textColor: '#fff', accentColor: '#fff', highlightColor: '#fff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'RAMOS';
  const number = c.number ?? '4';
  const reason = c.reason ?? '2nd yellow';
  const blink = `${animDurationSec(r.anim.speed, 0.5)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celScRcBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>}

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', width: px(height, 0.62), height: px(height, 0.88), background: '#fff', borderRadius: 18, boxShadow: '0 0 80px #fff', animation: animOn ? `celScRcBlink ${blink} infinite` : undefined }}>
        <div style={{ position: 'absolute', top: '4%', right: '4%', bottom: '4%', left: '4%', background: r.bg.color, borderRadius: 14 }}/>
      </div>

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
        <div style={{ fontSize: px(height, 0.71), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: '0 0 60px #000' }}>RED CARD</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.1), letterSpacing: '0.12em', opacity: 0.9, marginTop: '2%' }}>{reason.toUpperCase()}</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.58), lineHeight: 0.9 }}>#{number}</div>
        <div style={{ fontSize: px(height, 0.17), lineHeight: 1, marginTop: '2%' }}>{player}</div>
      </div>
    </div>
  );
}

/* ════════════════ PENALTY SAVE ════════════════ */

export interface CelSoccerPenSaveCfg extends BaseCfg { goalie?: string; }

export function CelSoccerPenaltySaveWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerPenSaveCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a14', textColor: '#fff', accentColor: '#22d39b', highlightColor: '#22d39b', ...c.style });
  const animOn = r.anim.on && live;
  const goalie = c.goalie ?? 'COURTOIS';
  const burst = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const blink = `${animDurationSec(r.anim.speed, 0.4)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celScPsBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes celScPsBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes celScPsSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={120} color={r.accent.primary} kf="celScPsSpark" dur={sparkDur} />

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celScPsBurst ${burst} ease-out both` : undefined }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.125), letterSpacing: '0.14em' }}>DENIED!</div>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.62), lineHeight: 0.9, textShadow: `0 0 80px ${r.accent.highlight}`, marginTop: '2%' }}>SAVE!</div>
      </div>

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', animation: animOn ? `celScPsBlink ${blink} infinite` : undefined }}>
        <svg width={px(height, 0.67)} height={px(height, 0.42)} viewBox="0 0 80 50">
          <rect x="2" y="10" width="76" height="35" fill="none" stroke={r.accent.primary} strokeWidth="2"/>
          {Array.from({length:18}).map((_,i) => <line key={i} x1={4+i*4} y1="12" x2={4+i*4} y2="44" stroke={r.accent.primary} strokeWidth=".5"/>)}
          <circle cx="40" cy="44" r="3" fill={r.accent.primary}/>
        </svg>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.1em' }}>NO PENALTY</div>
        <div style={{ fontSize: px(height, 0.42), lineHeight: 1, marginTop: '2%' }}>{goalie}</div>
      </div>
    </div>
  );
}

/* ════════════════ FREE KICK GOAL ════════════════ */

export interface CelSoccerFreeKickCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function CelSoccerFreeKickWidget({ config, live = true, height = 480 }: WidgetProps<CelSoccerFreeKickCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d2226', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BECKHAM';
  const distance = c.distance ?? '28 YD';
  const swoosh = `${animDurationSec(r.anim.speed, 2)}s`;

  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celScFkSwoosh { 0% { stroke-dashoffset: 2200; } 100% { stroke-dashoffset: 0; } }`}</style>}

      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 600 400 Q 2500 -100 4500 100 Q 6300 250 7000 280" stroke={r.accent.primary} strokeWidth="20" strokeDasharray="40 25" fill="none" style={animOn ? { animation: `celScFkSwoosh ${swoosh} linear infinite` } : undefined} />
        {[2800,2960,3120,3280].map((x,i) => <rect key={i} x={x} y="150" width="100" height="280" rx="10" fill="#0a4a8a"/>)}
        <circle cx="600" cy="400" r="30" fill="#fff"/>
      </svg>

      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
        <div style={{ color: r.accent.primary, fontSize: px(height, 0.11) }}>BENT IT AROUND THE WALL</div>
        <div style={{ fontSize: px(height, 0.5), lineHeight: 0.9, marginTop: '2%' }}>FREE KICK!</div>
      </div>

      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
        <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{player}</div>
        <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.17), marginTop: '2%' }}>{distance}</div>
      </div>
    </div>
  );
}
