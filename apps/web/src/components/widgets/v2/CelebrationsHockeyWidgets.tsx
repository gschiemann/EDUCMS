"use client";
/**
 * VenueOS · Hockey celebration ribbons.
 *
 * Every widget here is aspect-aware. These celebration cues get triggered
 * onto BOTH a wide LED ribbon (≈16:1) AND a near-16:9 scoreboard. The
 * widget measures its own rendered box with `useElementSize` and branches:
 *
 *   • wide  (w/h ≥ 3.2) — the original horizontal ribbon strip. Unchanged.
 *   • scene (w/h < 3.2) — a centered, vertically-stacked scene that fits a
 *                         16:9 box with no overlap.
 *
 * Before the first measurement we default to the wide layout.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/** Aspect threshold: a box wider than 3.2:1 uses the ribbon layout. */
const WIDE_RATIO = 3.2;

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

/* ════════════════ HOCKEY GOAL ════════════════ */

export interface CelHockeyGoalCfg extends BaseCfg {
  scorer?: string;
  assists?: string[];
  score?: string;
}

export function CelHockeyGoalWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyGoalCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ce1141', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'MCDAVID';
  const assists = (c.assists ?? ['DRAISAITL', 'NUGENT-HOPKINS']).join(' · ');
  const score = c.score ?? '3-1';
  const pulse = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const shake = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celHkGoalPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celHkGoalShake { 0%, 100% { transform: translate(0,0); } 10%, 30%, 50%, 70%, 90% { transform: translate(-8px, 0); } 20%, 40%, 60%, 80% { transform: translate(8px, 0); } }
        @keyframes celHkGoalSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `repeating-linear-gradient(135deg, ${r.bg.color} 0 100px, #000 100px 200px)` }} />
      <Sparkles on={animOn} count={120} color="#fff" kf="celHkGoalSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
            <svg width={px(height, 0.5)} height={px(height, 0.5)} viewBox="0 0 80 100" style={{ animation: animOn ? `celHkGoalPulse ${pulse} ease-in-out infinite` : undefined, marginRight: '4%' }}>
              <ellipse cx="40" cy="60" rx="30" ry="34" fill="#dc2626" stroke="#fff" strokeWidth="3"/>
              <ellipse cx="32" cy="50" rx="8" ry="14" fill="#ffd23a" opacity=".8"/>
              <rect x="30" y="10" width="20" height="14" fill="#888"/>
            </svg>
            <div style={{ fontSize: px(height, 0.62), lineHeight: 0.85, letterSpacing: '-0.04em', color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 6px 30px #000`, animation: animOn ? `celHkGoalShake ${shake} ease-in-out 1` : undefined }}>GOAL!</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.06em' }}>SCORE</div>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 0.95, marginTop: '2%' }}>{scorer}</div>
            <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.07), marginTop: '2%' }}>assists: {assists}</div>
            <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.2), marginTop: '2%' }}>{score}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box' }}>
          <svg width={Math.min(measuredH * 0.2, width * 0.16)} height={Math.min(measuredH * 0.2, width * 0.16)} viewBox="0 0 80 100" style={{ animation: animOn ? `celHkGoalPulse ${pulse} ease-in-out infinite` : undefined, marginBottom: Math.round(measuredH * 0.02) }}>
            <ellipse cx="40" cy="60" rx="30" ry="34" fill="#dc2626" stroke="#fff" strokeWidth="3"/>
            <ellipse cx="32" cy="50" rx="8" ry="14" fill="#ffd23a" opacity=".8"/>
            <rect x="30" y="10" width="20" height="14" fill="#888"/>
          </svg>
          <div style={{ fontSize: Math.min(measuredH * 0.34, width * 0.13), lineHeight: 0.85, letterSpacing: '-0.04em', color: r.accent.primary, textShadow: `0 0 80px ${r.accent.highlight}, 0 6px 30px #000`, animation: animOn ? `celHkGoalShake ${shake} ease-in-out 1` : undefined }}>GOAL!</div>
          <div style={{ fontSize: Math.min(measuredH * 0.13, width * 0.07), lineHeight: 1, marginTop: Math.round(measuredH * 0.05) }}>{scorer}</div>
          <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: Math.min(measuredH * 0.05, width * 0.032), marginTop: Math.round(measuredH * 0.025) }}>assists: {assists}</div>
          <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: Math.min(measuredH * 0.12, width * 0.07), marginTop: Math.round(measuredH * 0.025) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ HAT TRICK ════════════════ */

export interface CelHockeyHatTrickCfg extends BaseCfg { player?: string; }

export function CelHockeyHatTrickWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyHatTrickCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'OVECHKIN';
  const burst = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celHkHtBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 60% { transform: scale(1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes celHkHtSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={140} color={r.accent.highlight} kf="celHkHtSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ animation: animOn ? `celHkHtBurst ${burst} ease-out both` : undefined }}>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.12em' }}>3 GOALS · ONE NIGHT</div>
              <div style={{ color: r.accent.primary, fontSize: px(height, 0.62), lineHeight: 0.9, textShadow: `0 0 80px ${r.accent.highlight}`, marginTop: '2%' }}>HAT TRICK</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.5), lineHeight: 1 }}>{player}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '3%' }}>
              {[1,2,3].map(n => (
                <div key={n} style={{ width: px(height, 0.19), height: px(height, 0.19), borderRadius: 18, background: r.accent.primary, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.11), marginLeft: n === 1 ? 0 : '3%', boxShadow: `0 0 30px ${r.accent.highlight}` }}>{n}</div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box', animation: animOn ? `celHkHtBurst ${burst} ease-out both` : undefined }}>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.06, width * 0.05), letterSpacing: '0.12em' }}>3 GOALS · ONE NIGHT</div>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.34, width * 0.13), lineHeight: 0.9, textShadow: `0 0 80px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.025) }}>HAT TRICK</div>
          <div style={{ fontSize: Math.min(measuredH * 0.14, width * 0.075), lineHeight: 1, marginTop: Math.round(measuredH * 0.05) }}>{player}</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: Math.round(measuredH * 0.04) }}>
            {[1,2,3].map(n => {
              const dot = Math.min(measuredH * 0.13, width * 0.075);
              return (
                <div key={n} style={{ width: dot, height: dot, borderRadius: 18, background: r.accent.primary, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: Math.min(measuredH * 0.075, width * 0.044), marginLeft: n === 1 ? 0 : Math.round(measuredH * 0.04), boxShadow: `0 0 30px ${r.accent.highlight}` }}>{n}</div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ POWER PLAY GOAL ════════════════ */

export interface CelHockeyPowerPlayCfg extends BaseCfg {
  scorer?: string;
  strength?: '5-on-4' | '5-on-3' | '4-on-3';
  score?: string;
}

export function CelHockeyPowerPlayWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyPowerPlayCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ce1141', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'MATTHEWS';
  const strength = c.strength ?? '5-on-4';
  const score = c.score ?? '2-1';

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celHkPpPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }`}</style>}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `repeating-linear-gradient(135deg, #000 0 100px, ${r.bg.color} 100px 200px)` }} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.1em' }}>POWER PLAY</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.5), lineHeight: 0.9, textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>GOAL!</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <div style={{ background: '#000', border: `4px solid ${r.accent.primary}`, borderRadius: 14, padding: '3% 5%', textAlign: 'center', boxShadow: `0 0 30px ${r.accent.highlight}`, animation: animOn ? `celHkPpPulse 1.5s ease-in-out infinite` : undefined }}>
              <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.07), letterSpacing: '0.1em' }}>STRENGTH</div>
              <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: px(height, 0.25), lineHeight: 0.9 }}>{strength}</div>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{scorer}</div>
            <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.19), marginTop: '2%' }}>{score}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box' }}>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.055, width * 0.04), letterSpacing: '0.1em' }}>POWER PLAY</div>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.34, width * 0.13), lineHeight: 0.9, textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.015) }}>GOAL!</div>
          <div style={{ background: '#000', border: `4px solid ${r.accent.primary}`, borderRadius: 14, padding: `${Math.round(measuredH * 0.02)}px ${Math.round(measuredH * 0.045)}px`, textAlign: 'center', boxShadow: `0 0 30px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.05), animation: animOn ? `celHkPpPulse 1.5s ease-in-out infinite` : undefined }}>
            <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: Math.min(measuredH * 0.045, width * 0.03), letterSpacing: '0.1em' }}>STRENGTH</div>
            <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: Math.min(measuredH * 0.11, width * 0.07), lineHeight: 0.9 }}>{strength}</div>
          </div>
          <div style={{ fontSize: Math.min(measuredH * 0.12, width * 0.07), lineHeight: 1, marginTop: Math.round(measuredH * 0.04) }}>{scorer}</div>
          <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: Math.min(measuredH * 0.1, width * 0.06), marginTop: Math.round(measuredH * 0.02) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SHORTHANDED GOAL ════════════════ */

export interface CelHockeyShortyCfg extends BaseCfg {
  scorer?: string;
  strength?: '4-on-5' | '3-on-5' | '3-on-4';
}

export function CelHockeyShortyWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyShortyCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a3a', textColor: '#fff', accentColor: '#22d39b', highlightColor: '#22d39b', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'POINT';
  const strength = c.strength ?? '4-on-5';
  const sweep = `${animDurationSec(r.anim.speed, 2)}s`;

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celHkShortySweep { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }`}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>
        {Array.from({length:8}).map((_,i) => (
          <div key={i} style={{ position: 'absolute', top: `${(i % 3) * 30 + 10}%`, left: 0, width: '14%', height: '12%', animation: animOn ? `celHkShortySweep ${sweep} linear ${i * 0.3}s infinite` : undefined, opacity: 0.4 + (i % 3) * 0.2 }}>
            <svg viewBox="0 0 280 60" preserveAspectRatio="none" width="100%" height="100%"><polygon points="0,30 220,30 220,5 280,30 220,55 220,30" fill={r.accent.primary}/></svg>
          </div>
        ))}
      </div>

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.1em' }}>SHORTHANDED!</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.5), lineHeight: 0.9, textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>SHORTY</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: '#000', border: `4px solid ${r.accent.primary}`, borderRadius: 14, padding: '3% 5%' }}>
            <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.25) }}>{strength}</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{scorer}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.096), marginTop: '2%' }}>against the odds</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box' }}>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.055, width * 0.04), letterSpacing: '0.1em' }}>SHORTHANDED!</div>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.34, width * 0.13), lineHeight: 0.9, textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.015) }}>SHORTY</div>
          <div style={{ background: '#000', border: `4px solid ${r.accent.primary}`, borderRadius: 14, padding: `${Math.round(measuredH * 0.02)}px ${Math.round(measuredH * 0.045)}px`, marginTop: Math.round(measuredH * 0.05) }}>
            <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: Math.min(measuredH * 0.11, width * 0.07) }}>{strength}</div>
          </div>
          <div style={{ fontSize: Math.min(measuredH * 0.12, width * 0.07), lineHeight: 1, marginTop: Math.round(measuredH * 0.04) }}>{scorer}</div>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.05, width * 0.032), marginTop: Math.round(measuredH * 0.02) }}>against the odds</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BIG SAVE ════════════════ */

export interface CelHockeyBigSaveCfg extends BaseCfg {
  goalie?: string;
  saves?: number;
}

export function CelHockeyBigSaveWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyBigSaveCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a14', textColor: '#fff', accentColor: '#22d39b', highlightColor: '#22d39b', ...c.style });
  const animOn = r.anim.on && live;
  const goalie = c.goalie ?? 'SHESTERKIN';
  const saves = c.saves ?? 28;
  const burst = `${animDurationSec(r.anim.speed, 0.5)}s`;

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celHkSaveBurst { 0% { transform: scale(0); opacity: 0; } 30% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }`}</style>}

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.1em' }}>NO GOAL!</div>
            <div style={{ fontSize: px(height, 0.58), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: `0 0 50px ${r.accent.highlight}`, marginTop: '2%' }}>BIG SAVE</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <div style={{ animation: animOn ? `celHkSaveBurst ${burst} ease-out both` : undefined }}>
              <svg width={px(height, 0.58)} height={px(height, 0.58)} viewBox="0 0 60 60">
                <path d="M30 5 L52 18 L52 38 Q30 58 8 38 L8 18 Z" fill={r.accent.primary} stroke="#fff" strokeWidth="2"/>
                <text x="30" y="38" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="800" fontSize="22" fill="#fff">SAVE</text>
              </svg>
            </div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{goalie}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.096), marginTop: '2%' }}>{saves} SAVES TONIGHT</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box' }}>
          <svg width={Math.min(measuredH * 0.22, width * 0.16)} height={Math.min(measuredH * 0.22, width * 0.16)} viewBox="0 0 60 60" style={{ animation: animOn ? `celHkSaveBurst ${burst} ease-out both` : undefined, marginBottom: Math.round(measuredH * 0.02) }}>
            <path d="M30 5 L52 18 L52 38 Q30 58 8 38 L8 18 Z" fill={r.accent.primary} stroke="#fff" strokeWidth="2"/>
            <text x="30" y="38" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="800" fontSize="22" fill="#fff">SAVE</text>
          </svg>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.055, width * 0.04), letterSpacing: '0.1em' }}>NO GOAL!</div>
          <div style={{ fontSize: Math.min(measuredH * 0.34, width * 0.13), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: `0 0 50px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.015) }}>BIG SAVE</div>
          <div style={{ fontSize: Math.min(measuredH * 0.12, width * 0.07), lineHeight: 1, marginTop: Math.round(measuredH * 0.05) }}>{goalie}</div>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.05, width * 0.032), marginTop: Math.round(measuredH * 0.02) }}>{saves} SAVES TONIGHT</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ EMPTY NET ════════════════ */

export interface CelHockeyEmptyNetCfg extends BaseCfg {
  scorer?: string;
  finalScore?: string;
}

export function CelHockeyEmptyNetWidget({ config, live = true, height = 480 }: WidgetProps<CelHockeyEmptyNetCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ce1141', textColor: '#fff', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'BARKOV';
  const finalScore = c.finalScore ?? '4-2';
  const sparkDur = animDurationSec(r.anim.speed, 2);

  const { ref, width, height: measuredH } = useElementSize<HTMLDivElement>();
  const wide = width > 0 ? width / Math.max(measuredH, 1) >= WIDE_RATIO : true;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celHkEnSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }`}</style>}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `repeating-linear-gradient(135deg, ${r.bg.color} 0 100px, #000 100px 200px)` }} />
      <Sparkles on={animOn} count={100} color={r.accent.highlight} kf="celHkEnSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>GAME OVER</div>
            <div style={{ fontSize: px(height, 0.5), lineHeight: 0.9, textShadow: '0 0 50px #000', marginTop: '2%' }}>EMPTY NET!</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{scorer}</div>
            <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.29), textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: '2%' }}>{finalScore}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4%', boxSizing: 'border-box' }}>
          <div style={{ color: r.accent.primary, fontSize: Math.min(measuredH * 0.05, width * 0.035), letterSpacing: '0.14em' }}>GAME OVER</div>
          <div style={{ fontSize: Math.min(measuredH * 0.3, width * 0.115), lineHeight: 0.9, textShadow: '0 0 50px #000', marginTop: Math.round(measuredH * 0.015) }}>EMPTY NET!</div>
          <div style={{ fontSize: Math.min(measuredH * 0.13, width * 0.075), lineHeight: 1, marginTop: Math.round(measuredH * 0.06) }}>{scorer}</div>
          <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: Math.min(measuredH * 0.18, width * 0.1), textShadow: `0 0 60px ${r.accent.highlight}`, marginTop: Math.round(measuredH * 0.03) }}>{finalScore}</div>
        </div>
      )}
    </div>
  );
}
