"use client";
/**
 * VenueOS · Football celebration ribbons.
 * Same conventions as the baseball file.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/** Aspect threshold: at or above this width:height ratio we use the
 *  horizontal ribbon layout; below it (≈16:9 / squarer) we use a
 *  centered vertical scene. Default to wide before measurement. */
function isWide(width: number, height: number): boolean {
  return width > 0 ? width / Math.max(height, 1) >= 3.2 : true;
}

/** Scene-branch hero size: bounded by BOTH the box height and width so a
 *  large celebration word can never overflow a 16:9 zone on either axis. */
function sceneHero(width: number, height: number, hFactor = 0.34, wFactor = 0.13): number {
  return Math.max(8, Math.round(Math.min(height * hFactor, width * wFactor)));
}

/** Scene-branch secondary text — sized off height, clamped by width so a
 *  long label never runs past the box edges. */
function sceneText(width: number, height: number, hFactor: number, widthChars = 0): number {
  const byHeight = height * hFactor;
  // Rough width clamp: assume ~0.62em average glyph advance.
  const byWidth = widthChars > 0 ? (width * 0.92) / (widthChars * 0.62) : byHeight;
  return Math.max(8, Math.round(Math.min(byHeight, byWidth)));
}

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

interface YardLinesProps { color: string; animOn: boolean; dur: string; }
function YardLines({ color, animOn, dur }: YardLinesProps) {
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 7.03%, ${color} 7.03%, ${color} 7.14%)`,
    animation: animOn ? `celFbYardFly ${dur} linear infinite` : undefined }}/>;
}

interface ArrowsProps { color: string; count: number; animOn: boolean; dur: string; }
function Arrows({ color, count, animOn, dur }: ArrowsProps) {
  return (
    <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ position: 'absolute', top: `${(i % 3) * 25 + 10}%`, left: 0, width: '14%', height: '12%', animation: animOn ? `celFbArrowSweep ${dur} linear ${i * 0.4}s infinite` : undefined, opacity: 0.4 + (i % 3) * 0.2 }}>
          <svg viewBox="0 0 280 60" preserveAspectRatio="none" width="100%" height="100%">
            <polygon points="0,30 220,30 220,5 280,30 220,55 220,30" fill={color}/>
          </svg>
        </div>
      ))}
    </div>
  );
}

/* ════════════════ TOUCHDOWN ════════════════ */

export interface CelFootballTouchdownCfg extends BaseCfg {
  player?: string;
  distance?: string;
  score?: string;
}

export function CelFootballTouchdownWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballTouchdownCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#003594', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BARKLEY';
  const distance = c.distance ?? '67 YD';
  const score = c.score ?? '21-14';
  const sparkDur = animDurationSec(r.anim.speed, 2);
  const shakeDur = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const yardDur = `${animDurationSec(r.anim.speed, 4)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  // Two-line hero ("TOUCH"/"DOWN!") — bound so BOTH lines fit the box.
  const hero = sceneHero(width, mh, 0.30, 0.16);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celFbTdShake   { 0%, 100% { transform: translate(0,0); } 10%, 30%, 50%, 70%, 90% { transform: translate(-8px, 0); } 20%, 40%, 60%, 80% { transform: translate(8px, 0); } }
        @keyframes celFbTdSpark   { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
        @keyframes celFbYardFly   { from { transform: translateX(0); } to { transform: translateX(-100px); } }
      `}</style>}

      <YardLines color="rgba(255,255,255,0.13)" animOn={animOn} dur={yardDur} />
      <Sparkles on={animOn} count={100} color={r.accent.highlight} kf="celFbTdSpark" dur={sparkDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celFbTdShake ${shakeDur} ease-in-out 1` : undefined }}>
            <div style={{ fontSize: px(height, 0.46), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}, 0 8px 30px #000` }}>TOUCH</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.46), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}, 0 8px 30px #000`, marginTop: '2%' }}>DOWN!</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.06em' }}>+6 · {distance}</div>
            <div style={{ fontSize: px(height, 0.46), lineHeight: 1, marginTop: '2%' }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.23), fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: '2%' }}>{score}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.07, distance.length + 4), letterSpacing: '0.08em' }}>+6 · {distance}</div>
          <div style={{ marginTop: px(mh, 0.03), animation: animOn ? `celFbTdShake ${shakeDur} ease-in-out 1` : undefined }}>
            <div style={{ fontSize: hero, lineHeight: 0.86, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}, 0 8px 30px #000` }}>TOUCH</div>
            <div style={{ color: r.accent.primary, fontSize: hero, lineHeight: 0.86, letterSpacing: '-0.04em', textShadow: `0 0 80px ${r.accent.highlight}, 0 8px 30px #000` }}>DOWN!</div>
          </div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, player.length), lineHeight: 1, marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.12, score.length + 2), fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: px(mh, 0.02) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ PICK SIX ════════════════ */

export interface CelFootballPickSixCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function CelFootballPickSixWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballPickSixCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', accentColor: '#dc2626', highlightColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'RAMSEY';
  const distance = c.distance ?? '42 YD RETURN';
  const slide = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const arrowDur = `${animDurationSec(r.anim.speed, 2)}s`;
  const yardDur = `${animDurationSec(r.anim.speed, 4)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celFbP6SlideL    { 0% { transform: translateX(-30%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes celFbArrowSweep  { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }
        @keyframes celFbYardFly     { from { transform: translateX(0); } to { transform: translateX(-100px); } }
      `}</style>}

      <YardLines color={`${r.accent.primary}33`} animOn={animOn} dur={yardDur} />
      <Arrows color={r.accent.primary} count={10} animOn={animOn} dur={arrowDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celFbP6SlideL ${slide} ease-out both` : undefined }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), letterSpacing: '0.14em' }}>DEFENSIVE TD</div>
            <div style={{ fontSize: px(height, 0.58), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: `0 0 40px ${r.accent.highlight}`, marginTop: '2%' }}>PICK SIX</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.62), textShadow: `0 0 60px ${r.accent.highlight}` }}>6</div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.5), lineHeight: 1 }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), marginTop: '2%' }}>{distance}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', animation: animOn ? `celFbP6SlideL ${slide} ease-out both` : undefined }}>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.07, 12), letterSpacing: '0.12em' }}>DEFENSIVE TD</div>
          <div style={{ fontSize: hero, lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: `0 0 40px ${r.accent.highlight}`, marginTop: px(mh, 0.025) }}>PICK SIX</div>
          <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: sceneText(width, mh, 0.18, 3), textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1, marginTop: px(mh, 0.02) }}>6</div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, player.length), lineHeight: 1, marginTop: px(mh, 0.03) }}>{player}</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.06, distance.length), marginTop: px(mh, 0.015) }}>{distance}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FIELD GOAL ════════════════ */

export interface CelFootballFieldGoalCfg extends BaseCfg {
  kicker?: string;
  distance?: string;
}

export function CelFootballFieldGoalWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballFieldGoalCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a1a14', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const kicker = c.kicker ?? 'BUTKER';
  const distance = c.distance ?? '52 YD';
  const fly = `${animDurationSec(r.anim.speed, 2)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);
  const postSize = Math.max(8, Math.round(Math.min(mh * 0.30, width * 0.22)));

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celFbFgBall { 0% { offset-distance: 0%; } 100% { offset-distance: 100%; } }`}</style>}

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '40%', right: '40%', top: 0, bottom: 0 }}>
            <svg viewBox="0 0 800 480" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
              <rect x="395" y="280" width="10" height="200" fill={r.accent.primary}/>
              <rect x="200" y="100" width="10" height="200" fill={r.accent.primary}/>
              <rect x="590" y="100" width="10" height="200" fill={r.accent.primary}/>
              <rect x="200" y="100" width="400" height="10" fill={r.accent.primary}/>
              <circle r="22" fill="#8b4513">
                {animOn && <animateMotion dur={fly} repeatCount="indefinite" path="M -300 400 Q 200 -100 700 250"/>}
              </circle>
            </svg>
          </div>

          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.14em' }}>IT&apos;S GOOD!</div>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1, marginTop: '2%' }}>{kicker}</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.62), fontFamily: '"JetBrains Mono", ui-monospace, monospace', textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1 }}>+3</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), marginTop: '2%' }}>{distance}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <svg width={postSize} height={postSize * 0.6} viewBox="0 0 800 480" preserveAspectRatio="xMidYMid meet" aria-hidden style={{ opacity: 0.85 }}>
            <rect x="395" y="280" width="10" height="200" fill={r.accent.primary}/>
            <rect x="200" y="100" width="10" height="200" fill={r.accent.primary}/>
            <rect x="590" y="100" width="10" height="200" fill={r.accent.primary}/>
            <rect x="200" y="100" width="400" height="10" fill={r.accent.primary}/>
          </svg>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.08, 11), letterSpacing: '0.12em', marginTop: px(mh, 0.025) }}>IT&apos;S GOOD!</div>
          <div style={{ color: r.accent.primary, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: hero, textShadow: `0 0 60px ${r.accent.highlight}`, lineHeight: 1, marginTop: px(mh, 0.02) }}>+3</div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, kicker.length), lineHeight: 1, marginTop: px(mh, 0.03) }}>{kicker}</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.07, distance.length), marginTop: px(mh, 0.015) }}>{distance}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SACK ════════════════ */

export interface CelFootballSackCfg extends BaseCfg {
  player?: string;
  sacks?: number;
}

export function CelFootballSackWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballSackCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0d0d', accentColor: '#dc2626', highlightColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'PARSONS';
  const sacks = c.sacks ?? 9.5;
  const shake = `${animDurationSec(r.anim.speed, 0.5)}s`;
  const pulse = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);
  const starSize = Math.max(8, Math.round(Math.min(mh * 0.32, width * 0.12)));
  const seasonLabel = `${sacks} SACKS THIS SEASON`;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celFbSackShake { 0%, 100% { transform: translate(0,0); } 10%, 30%, 50%, 70%, 90% { transform: translate(-8px, 0); } 20%, 40%, 60%, 80% { transform: translate(8px, 0); } }
        @keyframes celFbSackPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      `}</style>}

      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 8px, rgba(255,255,255,0) 8px 16px)' }} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', animation: animOn ? `celFbSackShake ${shake} ease-in-out 1` : undefined }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.16em' }}>SACK!</div>
            <div style={{ fontSize: px(height, 0.5), lineHeight: 1, textShadow: `0 0 30px ${r.accent.highlight}`, marginTop: '2%' }}>QB DOWN</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', animation: animOn ? `celFbSackPulse ${pulse} ease-in-out infinite` : undefined }}>
            <svg width={height * 0.5} height={height * 0.5} viewBox="0 0 100 100">
              <polygon points="50,5 65,40 100,40 70,60 80,95 50,75 20,95 30,60 0,40 35,40" fill={r.accent.primary} stroke="#fff" strokeWidth="2"/>
            </svg>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), marginTop: '2%' }}>{seasonLabel}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <svg width={starSize} height={starSize} viewBox="0 0 100 100" aria-hidden style={{ animation: animOn ? `celFbSackPulse ${pulse} ease-in-out infinite` : undefined }}>
            <polygon points="50,5 65,40 100,40 70,60 80,95 50,75 20,95 30,60 0,40 35,40" fill={r.accent.primary} stroke="#fff" strokeWidth="2"/>
          </svg>
          <div style={{ animation: animOn ? `celFbSackShake ${shake} ease-in-out 1` : undefined, marginTop: px(mh, 0.025) }}>
            <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.09, 6), letterSpacing: '0.14em' }}>SACK!</div>
            <div style={{ fontSize: hero, lineHeight: 1, textShadow: `0 0 30px ${r.accent.highlight}`, marginTop: px(mh, 0.015) }}>QB DOWN</div>
          </div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, player.length), lineHeight: 1, marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.06, seasonLabel.length), marginTop: px(mh, 0.015) }}>{seasonLabel}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FIRST DOWN ════════════════ */

export interface CelFootballFirstDownCfg extends BaseCfg {
  distance?: string;
}

export function CelFootballFirstDownWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballFirstDownCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#003594', accentColor: '#ffd23a', highlightColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const distance = c.distance ?? '14 YD';
  const arrowDur = `${animDurationSec(r.anim.speed, 1.6)}s`;
  const yardDur = `${animDurationSec(r.anim.speed, 3)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celFbFdArrow { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }
        @keyframes celFbYardFly { from { transform: translateX(0); } to { transform: translateX(-100px); } }
        @keyframes celFbArrowSweep { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }
      `}</style>}

      <YardLines color={`${r.accent.primary}33`} animOn={animOn} dur={yardDur} />
      <Arrows color={r.accent.primary} count={8} animOn={animOn} dur={arrowDur} />

      {wide ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: r.accent.primary, fontSize: px(height, 0.58), textShadow: `0 0 60px ${r.accent.highlight}`, letterSpacing: '-0.04em', marginRight: '4%' }}>1st</div>
          <div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), letterSpacing: '0.12em' }}>DOWN</div>
            <div style={{ fontSize: px(height, 0.46), lineHeight: 1, letterSpacing: '-0.04em' }}>{distance}</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.075) }}>drive continues</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ color: r.accent.primary, fontSize: hero, textShadow: `0 0 60px ${r.accent.highlight}`, letterSpacing: '-0.04em', lineHeight: 1 }}>1st</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.09, 6), letterSpacing: '0.12em', marginTop: px(mh, 0.03) }}>DOWN</div>
          <div style={{ fontSize: sceneText(width, mh, 0.13, distance.length + 1), lineHeight: 1, letterSpacing: '-0.04em', marginTop: px(mh, 0.015) }}>{distance}</div>
          <div style={{ fontWeight: 700, fontSize: sceneText(width, mh, 0.055, 15), marginTop: px(mh, 0.02) }}>drive continues</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ INTERCEPTION ════════════════ */

export interface CelFootballInterceptionCfg extends BaseCfg {
  player?: string;
  count?: number;
}

export function CelFootballInterceptionWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballInterceptionCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0008', accentColor: '#22c55e', highlightColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'PEPPERS';
  const count = c.count ?? 5;
  const arrowDur = `${animDurationSec(r.anim.speed, 2.4)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);
  const ballW = Math.max(8, Math.round(Math.min(mh * 0.30, width * 0.13)));
  const seasonLabel = `${count} INTs THIS SEASON`;

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celFbArrowSweep { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }`}</style>}
      <Arrows color={r.accent.primary} count={6} animOn={animOn} dur={arrowDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.14em' }}>OURS!</div>
            <div style={{ fontSize: px(height, 0.54), lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: '2%' }}>INT</div>
          </div>

          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <svg width={height * 0.54} height={height * 0.42} viewBox="0 0 100 80">
              <ellipse cx="50" cy="40" rx="44" ry="22" fill="#8b4513" stroke="#fff" strokeWidth="2"/>
              <path d="M 30 40 L 70 40 M 38 35 L 38 45 M 46 35 L 46 45 M 54 35 L 54 45 M 62 35 L 62 45" stroke="#fff" strokeWidth="2"/>
            </svg>
            <div style={{ textAlign: 'center', color: r.accent.primary, fontSize: px(height, 0.075), marginTop: '2%' }}>POSSESSION CHANGE</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.46), lineHeight: 1 }}>{player}</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.1), marginTop: '2%' }}>{seasonLabel}</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.08, 7), letterSpacing: '0.14em' }}>OURS!</div>
          <div style={{ fontSize: hero, lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: px(mh, 0.02) }}>INT</div>
          <svg width={ballW} height={ballW * 0.78} viewBox="0 0 100 80" aria-hidden style={{ marginTop: px(mh, 0.025) }}>
            <ellipse cx="50" cy="40" rx="44" ry="22" fill="#8b4513" stroke="#fff" strokeWidth="2"/>
            <path d="M 30 40 L 70 40 M 38 35 L 38 45 M 46 35 L 46 45 M 54 35 L 54 45 M 62 35 L 62 45" stroke="#fff" strokeWidth="2"/>
          </svg>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.055, 16), marginTop: px(mh, 0.02) }}>POSSESSION CHANGE</div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, player.length), lineHeight: 1, marginTop: px(mh, 0.03) }}>{player}</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.06, seasonLabel.length), marginTop: px(mh, 0.015) }}>{seasonLabel}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SAFETY ════════════════ */

export interface CelFootballSafetyCfg extends BaseCfg {}

export function CelFootballSafetyWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballSafetyCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#dc2626', accentColor: '#fff', highlightColor: '#fff', ...c.style });
  const animOn = r.anim.on && live;
  const thump = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const shake = `${animDurationSec(r.anim.speed, 0.6)}s`;
  const sparkDur = animDurationSec(r.anim.speed, 2);
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`
        @keyframes celFbSafetyThump { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes celFbSafetyShake { 0%, 100% { transform: translate(0,0); } 10%, 30%, 50%, 70%, 90% { transform: translate(-8px, 0); } 20%, 40%, 60%, 80% { transform: translate(8px, 0); } }
        @keyframes celFbSafetySpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      `}</style>}

      <Sparkles on={animOn} count={80} color="#fff" kf="celFbSafetySpark" dur={sparkDur} />

      {wide ? (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 4%' }}>
          <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: px(height, 0.7), textShadow: '0 0 80px #fff', animation: animOn ? `celFbSafetyThump ${thump} ease-in-out infinite` : undefined }}>+2</div>
          <div style={{ animation: animOn ? `celFbSafetyShake ${shake} ease-in-out 2` : undefined, textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.7), lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: '0 0 60px #000' }}>SAFETY!</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.1), letterSpacing: '0.12em', marginTop: '2%' }}>D-LINE TAKEOVER · BALL BACK</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: hero, textShadow: '0 0 80px #fff', lineHeight: 1, animation: animOn ? `celFbSafetyThump ${thump} ease-in-out infinite` : undefined }}>+2</div>
          <div style={{ marginTop: px(mh, 0.03), animation: animOn ? `celFbSafetyShake ${shake} ease-in-out 2` : undefined }}>
            <div style={{ fontSize: hero, lineHeight: 0.9, letterSpacing: '-0.04em', textShadow: '0 0 60px #000' }}>SAFETY!</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: sceneText(width, mh, 0.055, 26), letterSpacing: '0.1em', marginTop: px(mh, 0.03) }}>D-LINE TAKEOVER · BALL BACK</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FUMBLE RECOVERY ════════════════ */

export interface CelFootballFumbleCfg extends BaseCfg {
  player?: string;
}

export function CelFootballFumbleRecoveryWidget({ config, live = true, height = 480 }: WidgetProps<CelFootballFumbleCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a0a', accentColor: '#22c55e', highlightColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BOSA';
  const arrowDur = `${animDurationSec(r.anim.speed, 1.8)}s`;
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const hero = sceneHero(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <style>{`@keyframes celFbArrowSweep { 0% { transform: translateX(-100%); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(700%); opacity: 0; } }`}</style>}
      <Arrows color={r.accent.primary} count={5} animOn={animOn} dur={arrowDur} />

      {wide ? (
        <>
          <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)' }}>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.11), letterSpacing: '0.14em' }}>OUR BALL!</div>
            <div style={{ fontSize: px(height, 0.54), lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: '2%' }}>FUMBLE</div>
            <div style={{ color: r.accent.primary, fontSize: px(height, 0.13), marginTop: '2%' }}>RECOVERED</div>
          </div>

          <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', textAlign: 'right' }}>
            <div style={{ fontSize: px(height, 0.42), lineHeight: 1 }}>{player}</div>
            <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.088), marginTop: '2%' }}>possession change</div>
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.08, 10), letterSpacing: '0.14em' }}>OUR BALL!</div>
          <div style={{ fontSize: hero, lineHeight: 0.95, letterSpacing: '-0.04em', marginTop: px(mh, 0.02) }}>FUMBLE</div>
          <div style={{ color: r.accent.primary, fontSize: sceneText(width, mh, 0.09, 10), marginTop: px(mh, 0.015) }}>RECOVERED</div>
          <div style={{ fontSize: sceneText(width, mh, 0.10, player.length), lineHeight: 1, marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: sceneText(width, mh, 0.06, 18), marginTop: px(mh, 0.015) }}>possession change</div>
        </div>
      )}
    </div>
  );
}
